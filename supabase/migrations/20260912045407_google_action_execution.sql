-- Persist review inputs, provider execution state, and the resulting Google resource.
-- Only server-side code may mutate these fields: authenticated users still read their
-- org's suggestions through RLS, while server actions re-check that same access before
-- switching to the service role for provider work.
alter table commitment_action_suggestion
  add column input_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_data) = 'object'),
  add column preview_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preview_data) = 'object'),
  add column execution_state text not null default 'proposed'
    check (execution_state in (
      'proposed', 'ready', 'needs_info', 'schedule_conflict', 'executing',
      'created', 'failed', 'blocked', 'reconnect_google'
    )),
  add column external_id text,
  add column external_url text,
  add column last_error text,
  add column executing_at timestamptz,
  add column executed_at timestamptz,
  add column updated_at timestamptz not null default now();

create index commitment_action_suggestion_execution_idx
  on commitment_action_suggestion (org_id, execution_state, updated_at desc);

-- The application performs a read first to avoid noisy duplicate writes, but only this
-- database constraint makes approval audit rows idempotent under concurrent requests.
create unique index approval_event_one_action_approval
  on approval_event (org_id, subject_id)
  where subject_type = 'commitment_action_suggestion'
    and state = 'approved';

revoke insert, update on commitment_action_suggestion from authenticated;
grant select on commitment_action_suggestion to authenticated;
grant select, insert, update on commitment_action_suggestion to service_role;

-- Calendar and Drive writes can never run unattended. Keep historical blueprint rows
-- immutable by appending a new version for each org whose current blueprint predates
-- these actions.
alter table agent_blueprint drop constraint agent_blueprint_no_unattended_external;
alter table agent_blueprint add constraint agent_blueprint_no_unattended_external check (
  not (permitted_actions && array[
    'push_email_draft', 'create_calendar_event', 'create_drive_document', 'edit_crm'
  ])
);

with latest as (
  select distinct on (org_id) *
  from agent_blueprint
  order by org_id, version desc
)
insert into agent_blueprint (
  org_id, version, allowed_sources, permitted_actions, required_approvals,
  escalation_conditions, success_metric, expires_in_minutes, updated_by
)
select
  org_id,
  version + 1,
  allowed_sources,
  permitted_actions,
  array(
    select distinct action
    from unnest(required_approvals || array[
      'create_calendar_event', 'create_drive_document'
    ]) as action
  ),
  escalation_conditions,
  success_metric,
  expires_in_minutes,
  null
from latest
where not (required_approvals @> array[
  'create_calendar_event', 'create_drive_document'
]);
