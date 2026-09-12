-- The Gmail inbox watcher (lib/gmail/watch.ts) needs to know where it left off per
-- connection, so a scan never re-ingests a message it already turned into a commitment.
alter table connected_data_source
  add column gmail_last_scanned_at timestamptz;

-- Same treatment as the other operational metadata columns: a signed-in org member may see
-- when their own connection was last scanned, never the sealed token material.
grant select (id, org_id, provider, account_email, scopes, state,
  access_token_expires_at, connected_by, created_at, updated_at, gmail_last_scanned_at)
  on connected_data_source to authenticated;

create or replace view connected_data_source_public
  with (security_invoker = true) as
  select id, org_id, provider, account_email, scopes, state,
    access_token_expires_at, connected_by, created_at, updated_at, gmail_last_scanned_at
  from connected_data_source;

grant select on connected_data_source_public to authenticated, service_role;
-- service_role already holds a blanket update grant on the base table from migration 0005.
