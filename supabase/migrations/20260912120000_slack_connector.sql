-- Slack bot tokens reuse the existing sealed-token columns and metadata view.
alter table connected_data_source drop constraint connected_data_source_provider_check;
alter table connected_data_source add constraint connected_data_source_provider_check
  check (provider in ('google', 'slack'));

-- Composite foreign keys prevent mappings across organizations, even through service role.
alter table connected_data_source add constraint connected_data_source_org_id_id_key unique (org_id, id);
alter table client_contact add constraint client_contact_org_id_id_key unique (org_id, id);

create table slack_channel_mapping (
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

alter table slack_channel_mapping enable row level security;
create policy sel_slack_channel_mapping on slack_channel_mapping for select
  using (org_id in (select current_user_orgs()));
create policy ins_slack_channel_mapping on slack_channel_mapping for insert
  with check (org_id in (select current_user_orgs()) and exists (
    select 1 from connected_data_source where id = connected_data_source_id
      and connected_data_source.org_id = slack_channel_mapping.org_id and provider = 'slack'));
create policy upd_slack_channel_mapping on slack_channel_mapping for update
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()) and exists (
    select 1 from connected_data_source where id = connected_data_source_id
      and connected_data_source.org_id = slack_channel_mapping.org_id and provider = 'slack'));
create policy del_slack_channel_mapping on slack_channel_mapping for delete
  using (org_id in (select current_user_orgs()));
revoke all on slack_channel_mapping from anon, authenticated, service_role;
grant select, insert, update, delete on slack_channel_mapping to authenticated, service_role;
-- No base-table columns were added: connected_data_source_public and its grants stay valid.
