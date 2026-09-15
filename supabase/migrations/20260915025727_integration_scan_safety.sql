-- Local migration only. Run both unmatched-source migrations before deploying consumers.
-- Fail quickly on a busy database rather than waiting indefinitely for index DDL locks.
set lock_timeout = '5s';

create index client_contact_org_email_exact_idx on public.client_contact (org_id, lower(btrim(email)));
create index client_contact_org_name_prefix_idx on public.client_contact (org_id, lower(name) text_pattern_ops);
create index client_contact_org_email_prefix_idx on public.client_contact (org_id, lower(email) text_pattern_ops);

create table public.client_email_alias (
  org_id uuid not null references public.organization(id),
  email text not null check (email = lower(btrim(email)) and email <> ''),
  client_contact_id uuid not null,
  primary key (org_id, email),
  foreign key (org_id, client_contact_id) references public.client_contact(org_id, id)
);
alter table public.client_email_alias enable row level security;
create policy read_alias on public.client_email_alias for select to authenticated
  using (org_id in (select public.current_user_orgs()));
revoke all on public.client_email_alias from public, anon, authenticated;
grant select on public.client_email_alias to authenticated;
grant all on public.client_email_alias to service_role;

-- Aliases take precedence: the human explicitly resolved this exact address.
create function public.match_gmail_client(p_org uuid, p_email text)
returns table(id uuid, name text) language sql stable security invoker set search_path = '' as $$
  select c.id, c.name from public.client_contact c
  join public.client_email_alias a on a.org_id = c.org_id and a.client_contact_id = c.id
  where a.org_id = p_org and a.email = lower(btrim(p_email))
  union all
  select c.id, c.name from public.client_contact c
  where c.org_id = p_org and lower(btrim(c.email)) = lower(btrim(p_email))
    and not exists (select 1 from public.client_email_alias a where a.org_id = p_org and a.email = lower(btrim(p_email)))
  limit 2;
$$;
revoke all on function public.match_gmail_client(uuid,text) from public, anon, authenticated;
grant execute on function public.match_gmail_client(uuid,text) to service_role;

-- Prefix search, not an unindexable short substring search. Each branch stops at 20.
create function public.search_unmatched_clients(p_org uuid, p_query text)
returns setof public.client_contact language plpgsql stable security invoker set search_path = '' as $$
declare pattern text;
begin
  if length(btrim(p_query)) < 2 or length(p_query) > 120 then return; end if;
  pattern := replace(replace(replace(lower(btrim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  -- EXECUTE USING replans with the concrete prefix, avoiding a generic LIKE plan
  -- that cannot derive text_pattern_ops index bounds. No user text enters SQL syntax.
  return query execute $query$ select hits.* from (
    (select c.* from public.client_contact c where c.org_id = $1 and lower(c.name) like $2 escape '\' limit 20)
    union
    (select c.* from public.client_contact c where c.org_id = $1 and lower(c.email) like $2 escape '\' limit 20)
  ) hits order by hits.name, hits.id limit 20 $query$ using p_org, pattern;
end;
$$;
revoke all on function public.search_unmatched_clients(uuid,text) from public, anon;
grant execute on function public.search_unmatched_clients(uuid,text) to authenticated;

-- Watcher-only atomic aggregation. Returns true ONLY on first insertion.
create function public.record_unmatched_source(p_org uuid, p_provider text, p_type text, p_key text,
  p_name text, p_label text, p_connection uuid, p_channel text, p_seen timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.integration_unmatched_source(org_id,provider,source_type,source_key,source_name,source_label,connected_data_source_id,channel_id,last_seen_at)
  values(p_org,p_provider,p_type,p_key,p_name,p_label,p_connection,p_channel,p_seen)
  on conflict (org_id,provider,source_type,source_key) do nothing;
  if found then return true; end if;
  update public.integration_unmatched_source set occurrence_count = occurrence_count + 1,
    source_name = p_name, source_label = p_label, connected_data_source_id = p_connection,
    channel_id = p_channel, last_seen_at = greatest(last_seen_at,p_seen), updated_at = now()
  where org_id = p_org and provider = p_provider and source_type = p_type and source_key = p_key;
  return false;
end;
$$;
revoke all on function public.record_unmatched_source(uuid,text,text,text,text,text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_unmatched_source(uuid,text,text,text,text,text,uuid,text,timestamptz) to service_role;

-- Server verifies membership and Slack channel access before this service-only transaction.
-- The row lock makes concurrent link/create/ignore attempts mutually exclusive.
create function public.resolve_unmatched_source(p_org uuid, p_source uuid, p_action text,
  p_client uuid default null, p_name text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare source public.integration_unmatched_source; client_id uuid := p_client;
begin
  select * into source from public.integration_unmatched_source
    where id = p_source and org_id = p_org and status = 'open' for update;
  if not found then raise exception 'Source is no longer open'; end if;
  if p_action = 'ignore' then
    update public.integration_unmatched_source set status = 'ignored', updated_at = now() where id = source.id;
    return null;
  end if;
  if p_action = 'create' then
    if p_name is null or length(btrim(p_name)) not between 1 and 160 then raise exception 'Invalid client name'; end if;
    insert into public.client_contact(org_id,name) values(p_org,btrim(p_name)) returning id into client_id;
  elsif p_action <> 'link' then raise exception 'Invalid action'; end if;
  if not exists(select 1 from public.client_contact where id = client_id and org_id = p_org) then
    raise exception 'Client not in workspace';
  end if;
  if source.provider = 'google' and source.source_type = 'email' then
    insert into public.client_email_alias(org_id,email,client_contact_id)
      values(p_org,lower(btrim(source.source_key)),client_id)
      on conflict (org_id,email) do update set client_contact_id = excluded.client_contact_id;
  elsif source.provider = 'slack' and source.source_type = 'channel' then
    if not exists(select 1 from public.connected_data_source where id = source.connected_data_source_id
      and org_id = p_org and provider = 'slack' and state = 'active') then raise exception 'Slack connection unavailable'; end if;
    insert into public.slack_channel_mapping(org_id,connected_data_source_id,channel_id,channel_name,client_contact_id)
      values(p_org,source.connected_data_source_id,source.channel_id,source.source_name,client_id)
      on conflict (connected_data_source_id,channel_id) do update set client_contact_id = excluded.client_contact_id;
  else raise exception 'Invalid source type'; end if;
  update public.integration_unmatched_source set status = 'linked',client_contact_id = client_id,updated_at = now()
    where id = source.id;
  return client_id;
end;
$$;
revoke all on function public.resolve_unmatched_source(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_unmatched_source(uuid,uuid,text,uuid,text) to service_role;
drop policy if exists del_integration_unmatched_source on public.integration_unmatched_source;
revoke insert,update,delete on public.integration_unmatched_source from authenticated;

-- Private durable scheduler state: never expose credentials or operational cursors to clients.
create table public.integration_scan_state (
  connection_id uuid primary key references public.connected_data_source(id) on delete cascade,
  attempted_at timestamptz not null default '-infinity',
  lease_token uuid, locked_until timestamptz,
  gmail_until timestamptz, gmail_cursor text, gmail_listed boolean not null default false,
  slack_cursor text not null default ''
);
alter table public.integration_scan_state enable row level security;
revoke all on public.integration_scan_state from public,anon,authenticated;
grant all on public.integration_scan_state to service_role;
create table public.gmail_scan_pending (
  connection_id uuid not null references public.connected_data_source(id) on delete cascade,
  message_id text not null, received_at timestamptz not null,
  primary key(connection_id,message_id)
);
create index gmail_scan_pending_order_idx on public.gmail_scan_pending(connection_id,received_at,message_id);
alter table public.gmail_scan_pending enable row level security;
revoke all on public.gmail_scan_pending from public,anon,authenticated;
grant all on public.gmail_scan_pending to service_role;

-- One connection per invocation, oldest attempt first; manual and cron share this lease.
create function public.claim_integration_scan(p_provider text,p_org uuid default null)
returns table(id uuid,org_id uuid,scopes text[],gmail_last_scanned_at timestamptz,lease_token uuid)
language plpgsql security invoker set search_path = '' as $$
declare chosen uuid; token uuid := gen_random_uuid();
begin
  -- Lock the chosen connection itself, so first-time state creation is also race safe.
  select c.id into chosen from public.connected_data_source c
    left join public.integration_scan_state s on s.connection_id = c.id
    where c.provider = p_provider and c.state = 'active' and (p_org is null or c.org_id = p_org)
      and (p_provider <> 'google' or 'https://www.googleapis.com/auth/gmail.readonly' = any(c.scopes))
      and (s.locked_until is null or s.locked_until < now())
    order by coalesce(s.attempted_at,'-infinity'::timestamptz),c.id
    limit 1 for update of c skip locked;
  if chosen is null then return; end if;
  insert into public.integration_scan_state(connection_id,attempted_at,lease_token,locked_until)
    values(chosen,now(),token,now() + interval '15 minutes')
    on conflict(connection_id) do update set attempted_at = now(),lease_token = token,locked_until = now() + interval '15 minutes';
  return query select c.id,c.org_id,c.scopes,c.gmail_last_scanned_at,token from public.connected_data_source c where c.id = chosen;
end;
$$;
revoke all on function public.claim_integration_scan(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_integration_scan(text,uuid) to service_role;

-- Distributed per-user budget, not a per-process map that resets on every cold start.
create table public.copilot_request_budget (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null, requests integer not null
);
alter table public.copilot_request_budget enable row level security;
revoke all on public.copilot_request_budget from public,anon,authenticated;
grant all on public.copilot_request_budget to service_role;
create function public.consume_copilot_budget(p_user uuid) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare allowed boolean;
begin
  insert into public.copilot_request_budget(user_id,window_start,requests) values(p_user,now(),1)
  on conflict(user_id) do update set
    requests = case when copilot_request_budget.window_start <= now() - interval '1 minute' then 1 else copilot_request_budget.requests + 1 end,
    window_start = case when copilot_request_budget.window_start <= now() - interval '1 minute' then now() else copilot_request_budget.window_start end
  returning requests <= 10 into allowed;
  return allowed;
end;
$$;
revoke all on function public.consume_copilot_budget(uuid) from public,anon,authenticated;
grant execute on function public.consume_copilot_budget(uuid) to service_role;
alter table public.slack_channel_mapping
  add column scan_until timestamptz,
  add column scan_cursor text,
  add column scan_listed boolean not null default false,
  add column scan_attempted_at timestamptz not null default '-infinity';
create index slack_mapping_scan_order_idx on public.slack_channel_mapping(connected_data_source_id,scan_attempted_at,id);
create table public.slack_scan_pending (
  mapping_id uuid not null references public.slack_channel_mapping(id) on delete cascade,
  message_ts numeric not null, message jsonb not null,
  primary key(mapping_id,message_ts)
);
alter table public.slack_scan_pending enable row level security;
revoke all on public.slack_scan_pending from public,anon,authenticated;
grant all on public.slack_scan_pending to service_role;
reset lock_timeout;
