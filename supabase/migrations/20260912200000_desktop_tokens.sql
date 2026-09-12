-- Desktop client authentication.
--
-- Every mutation in this product is a Next.js server action, bound to Next's internal
-- RPC protocol and unreachable from anything that is not this web app. The macOS
-- menu-bar client therefore had no way in, and shipped carrying its own model
-- credentials — which made the packaged build useless to anyone but the person who
-- built it. This table is what lets an external client authenticate as a real member
-- of a real org instead.
--
-- Only a SHA-256 hash of the token is stored. The token itself is shown once, at mint
-- time, and is not recoverable afterwards — losing it means minting another. That is
-- deliberate: a leaked row must not be a leaked credential.

create table desktop_token (id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  user_id uuid not null references app_user(id),
  token_hash text not null unique,
  label text not null,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked_at timestamptz);

-- Every verification looks a token up by hash, on every request.
create index desktop_token_hash on desktop_token (token_hash) where revoked_at is null;
create index desktop_token_org on desktop_token (org_id);

alter table desktop_token enable row level security;

-- A member may see and revoke their org's tokens. Nobody may write one through
-- PostgREST: minting goes through the server action, which is the only place the
-- plaintext half exists. Verification runs as service_role, since the caller has no
-- Supabase session — that is the whole point of the token.
create policy sel_desktop_token on desktop_token for select
  using (org_id in (select current_user_orgs()));
create policy upd_desktop_token on desktop_token for update
  using (org_id in (select current_user_orgs()));

grant select, update on desktop_token to authenticated;
grant select, insert, update on desktop_token to service_role;

-- The hash column is never useful to a browser and there is no reason to ship it to
-- one. Members read the metadata view instead.
create or replace view desktop_token_public
  with (security_invoker = true) as
  select id, org_id, user_id, label, created_at, last_used_at, revoked_at
  from desktop_token;

grant select on desktop_token_public to authenticated, service_role;
