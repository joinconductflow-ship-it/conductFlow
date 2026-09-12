-- Suggested actions are analysis results, not authorization or execution records.
-- They let a later review UI show why an email, calendar event, Drive document, or
-- internal task makes sense without coupling ingestion to external provider writes.
create table commitment_action_suggestion (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  commitment_id uuid not null references commitment(id) on delete cascade,
  action_type text not null check (action_type in (
    'gmail_draft', 'calendar_event', 'drive_document', 'internal_task'
  )),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rationale text not null check (length(trim(rationale)) > 0),
  required_data jsonb not null default '[]'::jsonb check (jsonb_typeof(required_data) = 'array'),
  missing_data jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_data) = 'array'),
  created_at timestamptz not null default now(),
  unique (commitment_id, action_type)
);

create index commitment_action_suggestion_org_commitment_idx
  on commitment_action_suggestion (org_id, commitment_id);

alter table commitment_action_suggestion enable row level security;

create policy sel_commitment_action_suggestion on commitment_action_suggestion for select
  using (org_id in (select current_user_orgs()));

create policy ins_commitment_action_suggestion on commitment_action_suggestion for insert
  with check (org_id in (select current_user_orgs()));

create policy upd_commitment_action_suggestion on commitment_action_suggestion for update
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

grant select, insert, update on commitment_action_suggestion to authenticated, service_role;
