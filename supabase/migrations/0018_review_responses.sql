-- Review Response Drafter: completes the review-request workflow by recording reviews an
-- owner pastes from third-party platforms, flagging serious feedback, and saving a reply
-- draft for the owner to copy. There is no platform monitoring or external delivery here.

create table received_review (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  client_id uuid references client_contact(id),
  source text check (source in ('google','yelp','facebook','other')),
  reviewer_name text,
  rating integer check (rating between 1 and 5),
  raw_review text not null,
  sentiment text not null default 'neutral' check (sentiment in ('positive','neutral','negative')),
  urgency text not null default 'low' check (urgency in ('low','medium','high')),
  drafted_response text,
  status text not null default 'new' check (status in ('new','responded','dismissed')),
  created_at timestamptz default now());

do $$ begin
  alter table received_review enable row level security;
end $$;

do $$ begin
  create policy sel_received_review on received_review for select
    using (org_id in (select current_user_orgs()));
  create policy ins_received_review on received_review for insert
    with check (org_id in (select current_user_orgs()));
  create policy upd_received_review on received_review for update
    using (org_id in (select current_user_orgs()));
end $$;

do $$ begin
  grant select, insert, update on received_review to authenticated, service_role;
end $$;
