-- Microsoft 365 reuses the existing encrypted grant and atomic scan lease.
set lock_timeout = '5s';
alter table connected_data_source drop constraint connected_data_source_provider_check;
alter table connected_data_source add constraint connected_data_source_provider_check
  check (provider in ('google', 'slack', 'microsoft'));
alter table connected_data_source add column outlook_last_scanned_at timestamptz;
grant select (id, org_id, provider, account_email, scopes, state,
  access_token_expires_at, connected_by, created_at, updated_at, gmail_last_scanned_at, outlook_last_scanned_at)
  on connected_data_source to authenticated;
create or replace view connected_data_source_public
  with (security_invoker = true) as
  select id, org_id, provider, account_email, scopes, state,
    access_token_expires_at, connected_by, created_at, updated_at, gmail_last_scanned_at, outlook_last_scanned_at
  from connected_data_source;
grant select on connected_data_source_public to authenticated, service_role;
alter table integration_unmatched_source drop constraint integration_unmatched_source_provider_check;
alter table integration_unmatched_source add constraint integration_unmatched_source_provider_check
  check (provider in ('google', 'slack', 'microsoft'));

-- channel_id stores teamId:channelId (split at the first colon only).
create table teams_channel_mapping (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  connected_data_source_id uuid not null,
  channel_id text not null,
  channel_name text not null,
  client_contact_id uuid not null,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, connected_data_source_id) references connected_data_source(org_id, id),
  foreign key (org_id, client_contact_id) references client_contact(org_id, id),
  unique (connected_data_source_id, channel_id)
);

alter table teams_channel_mapping enable row level security;
create policy sel_teams_channel_mapping on teams_channel_mapping for select
  using (org_id in (select current_user_orgs()));
create policy ins_teams_channel_mapping on teams_channel_mapping for insert
  with check (org_id in (select current_user_orgs()) and exists (
    select 1 from connected_data_source where id = connected_data_source_id
      and connected_data_source.org_id = teams_channel_mapping.org_id and provider = 'microsoft'));
create policy upd_teams_channel_mapping on teams_channel_mapping for update
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()) and exists (
    select 1 from connected_data_source where id = connected_data_source_id
      and connected_data_source.org_id = teams_channel_mapping.org_id and provider = 'microsoft'));
create policy del_teams_channel_mapping on teams_channel_mapping for delete
  using (org_id in (select current_user_orgs()));
revoke all on teams_channel_mapping from anon, authenticated, service_role;
grant select, insert, update, delete on teams_channel_mapping to authenticated, service_role;

alter table public.teams_channel_mapping
  add column scan_until timestamptz,
  add column scan_cursor text,
  add column scan_listed boolean not null default false,
  add column scan_attempted_at timestamptz not null default '-infinity';
create index teams_mapping_scan_order_idx on public.teams_channel_mapping(connected_data_source_id,scan_attempted_at,id);
create table public.teams_scan_pending (
  mapping_id uuid not null references public.teams_channel_mapping(id) on delete cascade,
  message_ts numeric not null, message jsonb not null,
  primary key(mapping_id,message_ts)
);
alter table public.teams_scan_pending enable row level security;
revoke all on public.teams_scan_pending from public,anon,authenticated;
grant all on public.teams_scan_pending to service_role;

alter table public.integration_scan_state
  add column outlook_until timestamptz,
  add column outlook_cursor text,
  add column outlook_listed boolean not null default false,
  add column teams_cursor text not null default '';
create table public.outlook_scan_pending (
  connection_id uuid not null references public.connected_data_source(id) on delete cascade,
  message_id text not null, received_at timestamptz not null,
  primary key(connection_id,message_id)
);
create index outlook_scan_pending_order_idx on public.outlook_scan_pending(connection_id,received_at,message_id);
alter table public.outlook_scan_pending enable row level security;
revoke all on public.outlook_scan_pending from public,anon,authenticated;
grant all on public.outlook_scan_pending to service_role;

create or replace function public.resolve_unmatched_source(p_org uuid, p_source uuid, p_action text,
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
  elsif source.provider = 'microsoft' and source.source_type = 'email' then
    insert into public.client_email_alias(org_id,email,client_contact_id)
      values(p_org,lower(btrim(source.source_key)),client_id)
      on conflict (org_id,email) do update set client_contact_id = excluded.client_contact_id;
  elsif source.provider = 'microsoft' and source.source_type = 'channel' then
    if not exists(select 1 from public.connected_data_source where id = source.connected_data_source_id
      and org_id = p_org and provider = 'microsoft' and state = 'active') then raise exception 'Microsoft connection unavailable'; end if;
    insert into public.teams_channel_mapping(org_id,connected_data_source_id,channel_id,channel_name,client_contact_id)
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

-- claim_integration_scan already accepts microsoft; retain its existing signature and Google scope gate.
reset lock_timeout;
