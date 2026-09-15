-- Local-only regression script, after applying migrations to a disposable local database:
-- psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f tests/integrations/scan-safety.sql
-- Every fixture is rolled back. No provider calls or credentials are involved.
begin;
do $$
declare
  org_a uuid := gen_random_uuid(); org_b uuid := gen_random_uuid();
  client_a uuid := gen_random_uuid(); client_b uuid := gen_random_uuid();
  connection_a uuid := gen_random_uuid(); connection_b uuid := gen_random_uuid();
  source_id uuid; linked uuid; before_count bigint; result_count bigint; budget_user uuid := gen_random_uuid();
begin
  insert into public.organization(id,name) values(org_a,'scan-test-a'),(org_b,'scan-test-b');
  insert into public.client_contact(id,org_id,name,email) values
    (client_a,org_a,'Alpha',' Customer_1@Example.COM '), (client_b,org_b,'Alpha','customer_1@example.com');
  assert (select count(*) = 0 from public.match_gmail_client(org_a,'customer%1@example.com')), 'Percent is not a wildcard';
  assert (select count(*) = 0 from public.match_gmail_client(org_a,'customer__@example.com')), 'Underscore is not a wildcard';
  assert (select id = client_a from public.match_gmail_client(org_a,' customer_1@EXAMPLE.com ')), 'Normalized exact match';
  insert into public.client_contact(org_id,name,email)
    select org_a,'Alpha ' || n,'alpha' || n || '@example.com' from generate_series(1,100) n;
  assert (select count(*) = 20 from public.search_unmatched_clients(org_a,'Al')), 'Search response cap';
  assert (select bool_and(org_id = org_a) from public.search_unmatched_clients(org_a,'Al')), 'Search tenant boundary';
  assert (select count(*) = 0 from public.search_unmatched_clients(org_a,'A%')), 'Literal wildcard search';
  assert (select count(*) = 0 from public.search_unmatched_clients(org_a,'A')), 'Short search rejected';
  insert into public.connected_data_source(id,org_id,provider,account_email,external_account_id,scopes,token_sealed,dek_sealed)
    values(connection_a,org_a,'google','a@example.com','a',array['https://www.googleapis.com/auth/gmail.readonly'],'fixture','fixture'),
          (connection_b,org_a,'google','b@example.com','b',array['https://www.googleapis.com/auth/gmail.readonly'],'fixture','fixture');
  assert public.record_unmatched_source(org_a,'google','email','alias@example.com','Alias',null,connection_a,null,now()), 'New source counted';
  assert not public.record_unmatched_source(org_a,'google','email','alias@example.com','Alias',null,connection_a,null,now()), 'Repeat not newly opened';
  select id into source_id from public.integration_unmatched_source where org_id = org_a and source_key = 'alias@example.com';
  assert (select occurrence_count = 2 from public.integration_unmatched_source where id = source_id), 'Atomic increment';
  perform public.resolve_unmatched_source(org_a,source_id,'link',client_a);
  assert (select id = client_a from public.match_gmail_client(org_a,'alias@example.com')), 'Alias drives future scans';
  assert (select email = ' Customer_1@Example.COM ' from public.client_contact where id = client_a), 'Primary email preserved';
  begin
    perform public.resolve_unmatched_source(org_a,source_id,'ignore');
    raise exception 'TEST FAILED: resolved source transitioned again';
  exception when raise_exception then
    if sqlerrm <> 'Source is no longer open' then raise; end if;
  end;
  perform public.record_unmatched_source(org_a,'google','email','ignored@example.com','Ignored',null,connection_a,null,now());
  select id into source_id from public.integration_unmatched_source where org_id = org_a and source_key = 'ignored@example.com';
  perform public.resolve_unmatched_source(org_a,source_id,'ignore');
  assert not public.record_unmatched_source(org_a,'google','email','ignored@example.com','Ignored',null,connection_a,null,now()), 'Ignored source stays closed';
  assert (select status = 'ignored' from public.integration_unmatched_source where id = source_id), 'No automatic reopening';
  perform public.record_unmatched_source(org_a,'google','email','new@example.com','New',null,connection_a,null,now());
  select id into source_id from public.integration_unmatched_source where org_id = org_a and source_key = 'new@example.com';
  linked := public.resolve_unmatched_source(org_a,source_id,'create',null,'New Client');
  assert (select id = linked from public.match_gmail_client(org_a,'new@example.com')), 'Create and alias atomic';
  -- A downstream constraint violation rolls back the client insertion as well.
  insert into public.integration_unmatched_source(org_id,provider,source_type,source_key,source_name)
    values(org_a,'slack','channel','C-broken','Broken') returning id into source_id;
  select count(*) into before_count from public.client_contact where org_id = org_a;
  begin
    perform public.resolve_unmatched_source(org_a,source_id,'create',null,'Must roll back');
    raise exception 'TEST FAILED: invalid Slack connection accepted';
  exception when raise_exception then
    if sqlerrm <> 'Slack connection unavailable' then raise; end if;
  end;
  assert (select count(*) = before_count from public.client_contact where org_id = org_a), 'No orphan client';
  begin
    insert into public.client_email_alias(org_id,email,client_contact_id) values(org_a,'foreign@example.com',client_b);
    raise exception 'TEST FAILED: cross-tenant alias accepted';
  exception when foreign_key_violation then null; end;
  assert (select count(*) = 1 from public.claim_integration_scan('google',org_a)), 'One connection claimed';
  assert (select count(*) = 1 from public.claim_integration_scan('google',org_a)), 'Another non-overlapping connection claimed';
  assert (select count(*) = 0 from public.claim_integration_scan('google',org_a)), 'Both leased connections excluded';
  assert not has_table_privilege('authenticated','public.integration_unmatched_source','DELETE'), 'No authenticated delete';
  assert not has_table_privilege('authenticated','public.client_email_alias','INSERT'), 'Alias write restricted';
  assert not has_table_privilege('authenticated','public.integration_scan_state','SELECT'), 'Private scheduler state';
  assert not has_function_privilege('authenticated','public.resolve_unmatched_source(uuid,uuid,text,uuid,text)','EXECUTE'), 'Resolution is server-only';
  assert not has_function_privilege('anon','public.consume_copilot_budget(uuid)','EXECUTE'), 'Anonymous budget access denied';
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.client_email_alias'::regclass,
    'public.integration_scan_state'::regclass,'public.gmail_scan_pending'::regclass,'public.slack_scan_pending'::regclass)), 'RLS enabled';
  insert into auth.users(id) values(budget_user);
  for result_count in 1..10 loop assert public.consume_copilot_budget(budget_user), 'Within budget'; end loop;
  assert not public.consume_copilot_budget(budget_user), 'Eleventh request rejected';
  update public.copilot_request_budget set window_start = now() - interval '2 minutes' where user_id = budget_user;
  assert public.consume_copilot_budget(budget_user), 'Budget resets';
end;
$$;
-- No JWT/membership: even an authenticated role cannot see another tenant's rows.
set local role authenticated;
do $$ begin
  assert (select count(*) = 0 from public.client_email_alias), 'Alias RLS';
  assert (select count(*) = 0 from public.integration_unmatched_source), 'Unmatched RLS';
end $$;
reset role;
rollback;
