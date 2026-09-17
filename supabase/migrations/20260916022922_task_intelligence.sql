-- Task Intelligence V1: latest derived reasoning per commitment or task subject.
-- This migration is intentionally additive. Canonical task/commitment/source rows remain
-- authoritative and intelligence writes are restricted to the service role.

-- These composite keys add no new task semantics (the ID is already unique); they let the
-- intelligence table enforce that its organization and referenced records are the same.
alter table public.commitment
  add constraint commitment_org_id_id_key unique (org_id, id);
alter table public.task
  add constraint task_org_id_id_key unique (org_id, id);
alter table public.task
  add constraint task_commitment_org_fk
  foreign key (org_id, commitment_id) references public.commitment(org_id, id);

create table public.task_intelligence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  subject_type text not null check (subject_type in ('commitment', 'task')),
  subject_id uuid not null,
  commitment_id uuid not null references public.commitment(id) on delete cascade,
  task_id uuid references public.task(id) on delete cascade,
  generation_version text not null,
  input_fingerprint text not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'ready', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  claim_token uuid,
  context jsonb,
  why_it_matters jsonb,
  recommendation jsonb,
  useful_existing_action jsonb,
  attention_reason jsonb,
  source jsonb,
  source_facts jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  error_code text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_intelligence_commitment_org_fk
    foreign key (org_id, commitment_id) references public.commitment(org_id, id),
  constraint task_intelligence_task_org_fk
    foreign key (org_id, task_id) references public.task(org_id, id),
  constraint task_intelligence_subject_shape check (
    (subject_type = 'commitment' and task_id is null and subject_id = commitment_id)
    or
    (subject_type = 'task' and task_id is not null and subject_id = task_id)
  ),
  unique (org_id, subject_type, subject_id)
);

create index task_intelligence_org_queue_idx
  on public.task_intelligence (org_id, state, available_at, lease_expires_at);
create index task_intelligence_org_commitment_idx
  on public.task_intelligence (org_id, commitment_id);
create index task_intelligence_org_task_idx
  on public.task_intelligence (org_id, task_id)
  where task_id is not null;

alter table public.task_intelligence enable row level security;

create policy sel_task_intelligence on public.task_intelligence
  for select to authenticated
  using (org_id in (select public.current_user_orgs()));

revoke all on public.task_intelligence from public, anon, authenticated, service_role;
grant select on public.task_intelligence to authenticated;
grant select, insert, update on public.task_intelligence to service_role;

-- Enqueueing is idempotent for a subject/fingerprint pair. An active worker keeps
-- its lease and snapshot; a later open will enqueue the newer fingerprint after the
-- stale lease expires instead of allowing two generations to race over one row.
create or replace function public.enqueue_task_intelligence(
  p_org_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_commitment_id uuid,
  p_task_id uuid,
  p_generation_version text,
  p_input_fingerprint text,
  p_force_retry boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  result_id uuid;
begin
  insert into public.task_intelligence (
    org_id, subject_type, subject_id, commitment_id, task_id,
    generation_version, input_fingerprint, state, available_at
  ) values (
    p_org_id, p_subject_type, p_subject_id, p_commitment_id, p_task_id,
    p_generation_version, p_input_fingerprint, 'pending', now()
  )
  on conflict (org_id, subject_type, subject_id) do update set
    commitment_id = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.commitment_id else excluded.commitment_id end,
    task_id = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.task_id else excluded.task_id end,
    generation_version = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.generation_version else excluded.generation_version end,
    input_fingerprint = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.input_fingerprint else excluded.input_fingerprint end,
    state = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.state
      when public.task_intelligence.state = 'ready'
        and public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
      then 'ready'
      when public.task_intelligence.state = 'failed'
        and public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then 'failed'
      else 'pending' end,
    attempts = case
      when public.task_intelligence.state = 'failed'
        and public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.attempts
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
      then public.task_intelligence.attempts else 0 end,
    available_at = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.available_at
      when public.task_intelligence.state in ('ready', 'failed')
        and public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.available_at
      else now() end,
    lease_expires_at = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.lease_expires_at else null end,
    claim_token = case
      when public.task_intelligence.state = 'processing'
        and public.task_intelligence.lease_expires_at > now()
      then public.task_intelligence.claim_token else null end,
    error_code = case
      when public.task_intelligence.state = 'failed'
        and public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.error_code else null end,
    generated_at = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.generated_at else null end,
    context = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.context else null end,
    why_it_matters = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.why_it_matters else null end,
    recommendation = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.recommendation else null end,
    useful_existing_action = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.useful_existing_action else null end,
    attention_reason = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.attention_reason else null end,
    source = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.source else null end,
    source_facts = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.source_facts else '[]'::jsonb end,
    inferences = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.inferences else '[]'::jsonb end,
    provenance = case
      when public.task_intelligence.input_fingerprint = excluded.input_fingerprint
        and public.task_intelligence.generation_version = excluded.generation_version
        and not p_force_retry
      then public.task_intelligence.provenance else '{}'::jsonb end,
    updated_at = now()
  returning id into result_id;
  return result_id;
end;
$$;

-- A bounded SKIP LOCKED claim keeps concurrent cron invocations from processing
-- the same row. Expired leases are recoverable by the next worker.
create or replace function public.claim_task_intelligence_jobs(
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.task_intelligence
language sql
security invoker
set search_path = public, extensions
as $$
  with candidates as (
    select id
    from public.task_intelligence
    where (state = 'pending' and available_at <= now())
       or (state = 'processing' and lease_expires_at <= now())
    order by available_at asc, id asc
    limit least(greatest(coalesce(p_limit, 10), 1), 20)
    for update skip locked
  ), claimed as (
    update public.task_intelligence as ti
    set state = 'processing',
        attempts = ti.attempts + 1,
        claim_token = extensions.gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 300)),
        updated_at = now()
    from candidates
    where ti.id = candidates.id
    returning ti.*
  )
  select * from claimed;
$$;

revoke all on function public.enqueue_task_intelligence(uuid, text, uuid, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.claim_task_intelligence_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_task_intelligence(uuid, text, uuid, uuid, uuid, text, text, boolean)
  to service_role;
grant execute on function public.claim_task_intelligence_jobs(integer, integer)
  to service_role;
