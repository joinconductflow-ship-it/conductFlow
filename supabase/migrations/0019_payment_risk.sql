-- Payment Risk Detector: correlates unresolved operational signals with open invoices so
-- owners can intervene before a payment becomes overdue. It only records evidence and
-- drafts a check-in; delivery remains an explicit owner action in the existing workflows.

create table payment_risk_flag (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid not null references client_contact(id),
  invoice_id uuid references invoice(id),
  signal text not null check (signal in
    ('unsent_change_order','missing_document','delivery_overdue','invoice_due_quiet')),
  evidence text not null,
  related_draft_id uuid references client_message_draft(id),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz default now());

-- One open flag per (org, client, signal, the record that triggered it). The sweep also
-- checks existing open state before writing; this index is the concurrent-run backstop.
create unique index payment_risk_flag_open_unique on payment_risk_flag
  (org_id, client_id, signal, coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'),
   coalesce(related_draft_id, '00000000-0000-0000-0000-000000000000'))
  where status = 'open';

alter table client_message_draft drop constraint client_message_draft_kind_check;
alter table client_message_draft add constraint client_message_draft_kind_check
  check (kind in ('retainer_renewal','document_reminder','reschedule_offer','invoice',
    'collections_reminder','change_order','review_request','payment_risk_checkin'));

do $$ begin
  alter table payment_risk_flag enable row level security;
end $$;

do $$ begin
  create policy sel_payment_risk_flag on payment_risk_flag for select
    using (org_id in (select current_user_orgs()));
  create policy ins_payment_risk_flag on payment_risk_flag for insert
    with check (org_id in (select current_user_orgs()));
  create policy upd_payment_risk_flag on payment_risk_flag for update
    using (org_id in (select current_user_orgs()));
end $$;

do $$ begin
  grant select, insert, update on payment_risk_flag to authenticated, service_role;
end $$;
