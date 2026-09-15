create table integration_unmatched_source (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  provider text not null check (provider in ('google', 'slack')),
  source_type text not null check (source_type in ('email', 'channel')),
  source_key text not null,
  source_name text not null,
  source_label text,
  connected_data_source_id uuid,
  channel_id text,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'linked', 'ignored')),
  client_contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, source_type, source_key),
  foreign key (org_id, connected_data_source_id) references connected_data_source(org_id, id),
  foreign key (org_id, client_contact_id) references client_contact(org_id, id)
);

create index integration_unmatched_source_queue_idx
  on integration_unmatched_source (org_id, status, last_seen_at desc);

alter table integration_unmatched_source enable row level security;

create policy sel_integration_unmatched_source on integration_unmatched_source for select
  using (org_id in (select current_user_orgs()));
create policy ins_integration_unmatched_source on integration_unmatched_source for insert
  with check (org_id in (select current_user_orgs()));
create policy upd_integration_unmatched_source on integration_unmatched_source for update
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

revoke all on integration_unmatched_source from anon, authenticated, service_role;
grant select on integration_unmatched_source to authenticated;
grant select, insert, update, delete on integration_unmatched_source to service_role;
