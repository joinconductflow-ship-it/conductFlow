# ConductFlow (Phases 1–5)

ConductFlow turns conversations from small client-service businesses into approved
tasks and follow-up drafts — nothing sends without you.

Phase 1 built the skeleton: seeded transcript → mock extraction → commitment queue →
draft review → promise-risk dashboard, with org isolation (RLS), an approval-gated
action chokepoint, and an append-only audit log.

Phase 2 replaces the mock with a real pipeline: paste or upload a transcript at
`/ingest`, and a schema-constrained model call extracts commitments (owner, deadline,
type, confidence, verbatim source span) and drafts a follow-up per commitment. Every
source span is verified verbatim against the transcript; an unverifiable span drops the
commitment to `low` confidence. Ingested text passes through injection sanitising and is
wrapped as data, never instructions — matches are flagged on the transcript and surfaced
in the queue and review screen.

Phase 3B closes the loop: approved commitments become cards on a task board with a real
lifecycle and a completion record, and a promise that passes its date raises an in-app
reminder.

Phase 3A/3C/3D add Google. Sign-in is Google OAuth through Supabase Auth, asking for
identity scopes only; Drive, Calendar, and Gmail are granted separately from `/settings`,
one capability at a time. Refresh tokens are sealed with envelope encryption and stored in
a table `authenticated` cannot read. Approving a commitment writes the follow-up into the
connected account's **Gmail drafts** — never sends it.

Phase 4 turns the loop into something an owner can steer. `/operations` maps how the business
actually runs — lead times, promise types, owners, delivery, client load — once there are twenty
commitments to reason about. `/settings/blueprint` is where an owner decides, per action, whether
the agent may act unattended, must ask first, or is switched off; every edit writes a new version
rather than overwriting the old one, so "what was this agent allowed to do when it did that?" stays
answerable. Conversations that mention a complaint or a legal concern, or that produce a promise
nobody owns, raise an escalation on `/queue`. Repeating promises become proposals on `/tasks`, and
exception checks flag a conversation that does not look like how this business normally works.

Phase 5 makes the blueprint real. It was advisory: a non-owner could rewrite it through PostgREST,
two action paths ignored it and used the shipped defaults, and a failed read silently substituted a
broader contract. Now writing a blueprint is an owner's privilege enforced by row-level security,
not by an application check; actions that reach someone outside the team are demoted to
approval-gated when the stored row is read, so a forged row grants nothing; every action resolves
the org's own contract; and a contract that cannot be read denies the action instead of widening it.

**Nothing sends, and that is enforced in code, not by scope.** No Google scope permits
creating a draft without also permitting send: `gmail.compose` authorizes `drafts.send`. So
`send_external_email` sits in the contract's `prohibitedActions` — denied even with
approval — `lib/gmail/client.ts` exposes exactly two endpoints, and a test
(`tests/gmail/push.test.ts`, "the no-send guarantee") fails if the word `send` appears
anywhere in that module. `npm run build` itself only runs `next build` and does not run
Vitest — the guard is enforced by `npm test`, not by the production build. Verify with
`rg -i "messages/send|drafts/send" lib/`.

## Current deployment status (updated 2026-09-11)

Live at **https://conductflow-woad.vercel.app**, on the `joinconductflow-8385` Vercel
account and the `fauqimhboonrmjzrnkzl` Supabase project (both under
`joinconductflow@gmail.com`). Google OAuth runs through a Cloud project named
`conductflow-auth`, also under that account. All 19 migrations are applied. This section
exists so nobody re-discovers these gaps from scratch — update it as items get resolved.

**Works right now, verified end-to-end with real clicks against the live deployment:**
Google sign-in, every non-AI page and action across all 10 modules (retainers, documents,
scheduling, billing incl. invoice math and **Gmail draft push**, scope of work, reviews'
request-half, leads list, reports, payment risk scanning), and the daily cron sweep.

**Blocked or unfinished — pick one up if you're able to:**

1. **AI Gateway has no payment method on file.** Every AI-drafting feature (ingest's
   commitment extraction, lead triage, review-response drafting, the meeting-assistant
   suggestions endpoint) fails with `customer_verification_required` (see
   Troubleshooting below) until a card is added under the `joinconductflow-8385` Vercel
   team's AI Gateway settings. The underlying usage is still free-tier — this is Vercel's
   identity-verification gate on a brand-new account, not an actual charge — but nobody
   has added one yet because of an explicit no-spend directive from the project owner.
   This needs a deliberate go/no-spend decision from whoever owns that account; it is not
   something to just go do.
2. **The Google OAuth app is unverified and in Testing mode.** Only accounts explicitly
   added as test users (Google Cloud Console → `conductflow-auth` project → **Google Auth
   Platform → Audience**) can sign in with the restricted Gmail scope or connect
   Gmail/Drive/Calendar at all — everyone else gets `access_denied`. Right now only
   `sai.chowdarapu09@gmail.com` is allowlisted. Before onboarding anyone outside the team,
   this needs Google's restricted-scope verification (published estimate: ~6 weeks for a
   complete submission) plus an annual third-party CASA security assessment once verified
   (cost varies by assessor — get quotes, budget it as a recurring line item, not a
   one-time fee). This is also required regardless past ~100 total users. Do not open
   public Gmail access before this path is done — that's a deliberate current gate, not an
   oversight.
3. **No UI to configure a `billing_rate`.** The table (hourly rate per client, or one
   org-wide default) has no settings page anywhere — it's currently set by hand via SQL.
   `Draft invoice` fails with "no billing rate configured for this client or organization"
   for any org that hasn't had one inserted manually. Worth a small settings page.
4. **The meeting-transcript Chrome extension (`extension/`) has never been tested in a
   real browser.** It builds cleanly and passes every static check, but nobody has done an
   actual load-unpacked + live tab-capture pass yet — see the warning banner at the top of
   `extension/README.md` for exactly what to verify, and update that banner once it's done.
5. **Legal documents are placeholders, not a reviewed contract.** `/privacy` and `/terms`
   exist and describe what the code actually does (see `lib/legal/pending.ts` for the
   shared unresolved values: legal entity, governing jurisdiction, effective date). Per
   research done 2026-09-11 (Perplexity, 30 sources) into what a solo founder needs before
   real signups:
   - **No business entity is formed yet** — `lib/legal/pending.ts` names the responsible
     party as pending. Until an LLC/corp exists, the founder is personally the contracting
     party; form an entity before real money or real client data from strangers flows
     through this product.
   - **No lawyer has reviewed `/terms` or `/privacy`.** Both pages say so plainly. Get a
     review before linking either from anywhere a non-test customer can reach — this
     product handles client communications data and acts on users' behalf via Gmail/Drive/
     Calendar, which raises the bar above a typical SaaS template.
   - **No Data Processing Addendum (DPA) exists.** B2B customers with their own privacy
     obligations will likely need one before they can use this product lawfully themselves.
   - **No account-deletion job exists.** The privacy policy's retention section says so
     explicitly — build the actual deletion mechanism before promising a retention window.
   - **No incident-response/breach-notification plan exists.** Every US state has a breach
     notification law regardless of company size; have a plan — data map, decision owner,
     notification procedure — before it's needed, not after.
   - CCPA/CPRA and most state comprehensive privacy laws have revenue/volume thresholds
     (commonly $25M revenue or 100k+ consumers/households) this product likely does not
     meet yet, but that is not a blanket exemption from security, breach-notice, or
     contractual obligations to B2B customers — revisit as the user base grows.

## Prerequisites

- Node.js 22+ — the `ai` and `@supabase/supabase-js` versions locked in `package-lock.json`
  declare `engines.node: >=22`; Node 20 will pull the same packages but is not what they
  were tested against.
- [Supabase CLI](https://supabase.com/docs/guides/cli) (installed as a dev dependency)
- Postgres + Auth to run against — pick one:
  - **Option A — Docker.** The Supabase CLI shells out to Docker to run the local
    stack (Postgres, Auth, Storage, Studio). Confirm `docker info` succeeds first.
  - **Option B — hosted Supabase project, no Docker.** A free project at
    [supabase.com](https://supabase.com) supplies Postgres and Auth over the network;
    nothing runs on your machine except the Next.js dev server. See below.

## Local

### Option A — Docker (local Supabase stack)

1. `cp .env.local.example .env.local` and fill in the values printed by `supabase start`
   (`API_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`).
2. Set `AI_GATEWAY_API_KEY` in `.env.local` for extraction — it resolves
   `openai/gpt-oss-120b` through the Vercel AI Gateway. `vercel env pull` also
   works: the `VERCEL_OIDC_TOKEN` it writes authenticates the gateway on its own, but
   it expires every 12 hours. `npm test` does not need either; tests inject a mock model.
3. `npx supabase start` then `npm run db:reset` (applies migrations `0001`–`0011` + seed).
4. `npm run dev` → http://localhost:3000
5. Open `/onboarding`. Google OAuth sign-in shipped in Phase 3A and works once the
   credentials in **Google setup** below are in place. **Continue as demo owner** is the
   local shortcut: a dev-only button that mints a session for the seeded `owner@demo.test`
   through the admin API. There is no password field, and it renders only when
   `NODE_ENV` is not `production` *and* the Supabase URL is loopback.

### Option B — hosted Supabase project (no Docker)

Postgres, Auth, and Storage run on Supabase's infrastructure instead of in local
containers, so nothing here shells out to Docker.

1. Create a free project at [supabase.com](https://supabase.com/dashboard) and note its
   project ref (the `xxxxxxxx` in `https://xxxxxxxx.supabase.co`).
2. `npx supabase link --project-ref <ref>` — prompts for the database password you set
   when creating the project. This does not start any local service.
3. `npm run db:push` — applies `supabase/migrations/0001`–`0011` directly to the hosted
   database over its Postgres connection. No shadow database, no containers.
4. Seed the demo data: grab the connection string from the dashboard
   (**Project Settings → Database → Connection string**, "URI" tab) and run
   `psql "<connection-string>" -f supabase/seed.sql`.
5. `cp .env.local.example .env.local` and fill it from **Project Settings → API**:
   `NEXT_PUBLIC_SUPABASE_URL` (Project URL), `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`. Add `AI_GATEWAY_API_KEY` as in Option A step 2 if you
   need extraction; `npm test` doesn't.
6. `npm run dev` → http://localhost:3000.
7. **The demo sign-in button will not work here, by design** — `app/actions/dev-auth.ts`
   refuses to mint a session unless `NEXT_PUBLIC_SUPABASE_URL` is loopback, specifically so
   a typo can't mint free admin sessions against a real project. Use Google OAuth sign-in
   instead (**Google setup** below), pointing the Google Cloud Console redirect URI at
   `https://<ref>.supabase.co/auth/v1/callback` and enabling the Google provider under
   **Authentication → Providers** in the dashboard — `supabase/config.toml`'s
   `[auth.external.google]` block only applies to `supabase start`, not a linked project.
   Separately, add `http://localhost:3000/auth/callback` (or your deployed origin's
   `/auth/callback`) to **Authentication → URL Configuration → Redirect URLs** in the same
   dashboard — `app/auth/signin/route.ts` sends Supabase Auth's `signInWithOAuth` back to
   that app-side URL after Google redirects to Supabase, and it's a separate allowlist from
   the Google Cloud Console one; missing it fails the sign-in with a redirect error after
   Google's own consent screen succeeds.
8. To run the stack-backed tests (see **Test** below) against this project instead of a
   local one, export before `npm test`:
   ```
   export SUPABASE_URL=https://<ref>.supabase.co
   export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   export SUPABASE_ANON_KEY=<anon key from Project Settings → API>
   export SUPABASE_SERVICE_ROLE_KEY=<service role key, same place>
   export SUPABASE_JWT_SECRET=<Project Settings → API → JWT Settings → Legacy JWT secret>
   ```
   Without these, `vitest.config.ts` defaults to `http://127.0.0.1:54321` and the
   stack-backed tests fail to connect.

`db:reset` (`supabase db reset`) is Docker-only — it rebuilds the *local* stack from
scratch and doesn't apply to a linked hosted project. On Option B, re-running
`npm run db:push` picks up new migrations; there's no destructive one-command reset for a
hosted database, which is the point.

### Screens

| Route | What it shows |
| --- | --- |
| `/` | Marketing hero |
| `/onboarding` | Sign-in: Google OAuth, email sign-in (`/auth/email`), and the dev-only demo session |
| `/ingest` | Paste or upload a transcript; extraction produces reviewable commitments |
| `/queue` | Commitment queue — confidence chip + status dot per promise, needs-attention strip |
| `/queue/[commitmentId]` | Draft review: draft surface, provenance, flagged-source banner, write/rewrite draft, approval bar |
| `/tasks` | Task board: open / in progress / delivered, plus the overdue reminder strip |
| `/dashboard` | Promise risk: overdue, owner+deadline coverage, approved share |
| `/operations` | Operations map: lead times, promise types, owners, delivery, client load, weekly volume — needs 20 commitments |
| `/settings` | Google connections — grant one capability at a time; disconnecting revokes the whole connected account, not a single capability |
| `/settings/blueprint` | The agent blueprint: per-action unattended / ask-first / off. Owner-only, append-only versions |

Approving writes an `approval_event`, a `task`, and an `audit_event`, and flips the
commitment to `tasked`. Discarding writes a `rejected` approval event plus its audit row.

Drafts are written during ingest, one model call per commitment. A draft call can fail on
its own — free-tier rate limits do it routinely — so the review screen carries **Write the
draft** for a commitment that has none and **Rewrite draft** to replace one. Generation
happens before the write, so a failed rewrite leaves the existing draft untouched.

Marking a task delivered stamps who completed it and when, flips its commitment to `done`,
and resolves the open reminder. Reopening returns the commitment to `tasked`. Nothing here
notifies anyone outside the app — a reminder is an in-app nudge, never an email.

The overdue sweep raises at most one open reminder per task, so running it repeatedly is
safe. It runs daily from `/api/cron/reminders` (declared in `vercel.json`), and on demand
from **Check for overdue** on the board. The cron route refuses every request unless
`Authorization: Bearer $CRON_SECRET` matches, and refuses all of them when `CRON_SECRET` is
unset — set it in Vercel's project env before relying on the schedule.

Uploads accept `.txt`, `.md`, and `.vtt` up to 250,000 characters; VTT keeps speaker
labels because owner attribution depends on them. Files are parsed in the action and
never stored. A transcript is persisted before the model runs, so a failed extraction
keeps what was said — `/queue` lists it under **Needs attention** with a Retry that
re-runs extraction against the saved text.

## Design system

Screens compose tokens and primitives; they do not invent colours, type sizes, or spacing.

- `app/globals.css` — the tokens. Three surface levels (`--canvas`, `--surface`, `--raised`),
  a 1.25 type scale capped at 30px, spacing and radius scales, motion timing, and the global
  `:focus-visible` ring. That ring lives here because inline styles cannot express focus
  states, which is how it went missing everywhere before.
- `components/ui/primitives.tsx` — `PageHeader`, `Card`, `CardTitle`, `Badge`, `StatusPill`,
  `EmptyState`, `Skeleton`, `buttonStyle`, `fieldStyle`, `labelStyle`, `proseStyle`.

Rules that hold across every screen:

- **Status is never colour alone.** A dot always ships with its text label, so the UI
  survives a monochrome screen and a colour-blind reader.
- **Empty states carry the next action.** A new customer's first view of most screens is the
  empty one; "no data" teaches them nothing.
- **Async controls reserve their width** and set `aria-busy`, so a label swapping to
  "Saving…" cannot shift the layout under a cursor.
- Dark, high-contrast, serious. The product handles client commitments; trust is the sell.

## Test

`npm test` — no API key and no Google credentials required anywhere in the suite. Google
clients are injected, so Drive, Calendar, and Gmail are tested against fakes. Most of the
suite needs no live service at all, but `tests/rls.test.ts`, `tests/ingest/*`,
`tests/drafts/*`, `tests/reminders/sweep.test.ts`, `tests/tasks/update.test.ts`,
`tests/agent/blueprint-store.test.ts`, `tests/auth/bootstrap.test.ts`, and
`tests/google/tokens.test.ts` talk to the running local (or linked hosted, see **Option B**
above) Supabase stack over the network, so `supabase start` and `npm run db:reset` — or a
`db:push` against a hosted project — must have succeeded first; without either, those files
fail with `fetch failed` rather than a useful assertion. The suite covers
cross-org denial, anonymous denial, audit append-only enforcement, the deny-by-default
chokepoint, injection flagging, schema validation, span verification, deadline resolution, the
extraction retry, transcript parsing, the ingest write sequence, task transitions, the idempotent
overdue sweep, and metrics.

Phase 5 adds the enforcement tests: a seeded member is refused an `agent_blueprint` insert
(`42501`), an owner is refused one granting an unattended external action (`23514`), a forged row
granting `push_email_draft` unattended still resolves to an approval-gated contract, a blueprint
that cannot be read denies rather than widening, and two source assertions — one failing if the
SQL action lists drift from `lib/agent/blueprint.ts`, one failing if `firstAgentContract` is
imported anywhere under `app/` or `lib/` outside `lib/agent/contract.ts`.

Those stack-backed tests write rows and never delete them — nothing in this product may
delete a task. They claim the next free blueprint version rather than a literal one, so the
suite can run twice without a reset. Run `npm run db:reset` when the local board gets noisy
with fixtures.

## Eval

`npm run eval` scores extraction against five labelled transcripts (tutoring,
consulting, coaching, agency, injection) using the real model. It needs a gateway
credential — `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, read from `.env.local` — and
costs money. Without either, every case skips, so it is safe in CI but scores nothing.
Run it whenever you change a prompt in `lib/agent/prompts.ts`, and investigate a FAIL
row before editing the prompt further. Last full run: **5/5 pass**, every source span
verbatim, injection fixture flagged.

### Model choice

`EXTRACTION_MODEL` is `openai/gpt-oss-120b`. `anthropic/claude-sonnet-5` is the better
model for this job, but free-tier gateway credit cannot reach it — the call fails with
`RestrictedModelsError`. Free tier also rate-limits the models it does allow to roughly
one request per minute, which is why the eval paces itself (`EVAL_PACE_MS`, default 45s)
and takes several minutes. On paid credit, drop `EVAL_PACE_MS` to `0` and consider
switching the model back; the eval expectations were met by gpt-oss and should hold or
improve.

## Google setup

Everything except live Google calls works without any of this — local dev keeps the demo
sign-in button, and an org that has connected nothing simply gets plainer drafts.

1. Create an OAuth client (Web application) in Google Cloud Console. Authorized redirect
   URIs: `http://localhost:54321/auth/v1/callback` for Supabase Auth sign-in, and
   `http://localhost:3000/auth/google/connect/callback` for capability grants.
2. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env.local`, set
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` to the same secret, and flip
   `[auth.external.google] enabled = true` in `supabase/config.toml`.
3. Generate `DATA_SOURCE_KEK`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Without it, connecting a data source fails and everything else keeps working.
4. In the same Google Cloud project as the OAuth client, enable Google Drive API and
   Google Picker API. Go to **APIs & Services > Credentials > Create Credentials > API key**
   and set `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` in `.env.local` to that key. Restrict the key
   to **Google Picker API** and **Websites**: your site's origins (for example,
   `http://localhost:3000/*` and `https://your-site.example/*`) plus `https://docs.google.com/*`
   for the Picker iframe. This browser key is public; it is separate from the OAuth secret.
   Set `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` to the project's numeric **Project number** from
   the Cloud Console dashboard. Picker requires it to grant access under `drive.file`.
   Restart local dev or rebuild your deployment after setting these public variables.
   See [Google's Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker).
5. Connect **Use our Drive templates** in Settings, then click **Choose template files**.
   Select one or more Google Docs or text files with `template` in the name. Picker grants
   access to those files; the existing template matching uses them on the next draft.
   Without `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` (or the project number), the button shows an
   inline setup error instead of crashing.
6. Restricted Gmail scopes need Google verification plus a CASA assessment before more
   than 100 users can consent. Fine for a pilot; plan for it before launch.

## Troubleshooting

- **`exec format error` from a Supabase container (Option A only).** A cached image layer
  is corrupt. `docker image rm -f <image>` and re-run `supabase start`; the CLI names the
  offending image in its error. Studio and postgres-meta are dashboard-only — if they stay
  broken, `npx supabase start -x studio,postgres-meta` runs everything the app and tests
  need. Doesn't apply to Option B — there's no local container to go stale.
- **`permission denied for table …` (SQLSTATE 42501).** The role lacks a `GRANT`, which
  is checked before RLS. Grants live at the end of `supabase/migrations/0001_schema_rls.sql`.
- **Actions fail with "commitment not found" after `db:reset`.** The reset recreated
  `auth.users`, so the browser session is stale. Sign in again at `/onboarding`.
- **Ingest fails with a gateway error.** Check the gateway credential. The transcript is
  still saved: `/queue` shows it under **Needs attention** with a Retry button.
- **`customer_verification_required` (HTTP 403) from the gateway.** Authentication
  succeeded; the Vercel account has no payment method, so AI Gateway refuses every
  request. Add a card under the team's AI settings — no code change helps.
- **`RestrictedModelsError` (HTTP 403).** The model is paid-credit only. Either top up
  gateway credit or point `EXTRACTION_MODEL` at a model free tier allows.
- **`GatewayRateLimitError`.** Free-tier throttling, not a bug. Space the calls out
  (`EVAL_PACE_MS`) or top up. Ingest retries twice and then leaves the transcript in
  **Needs attention**, so nothing is lost.
- **`new row violates check constraint "agent_blueprint_no_unattended_external"`.** The
  blueprint tried to grant `push_email_draft` or `edit_crm` unattended. Those reach someone
  outside the team and always need a human click — set them to **ask first** instead. The
  editor refuses this before the database does; seeing the constraint name means something
  wrote the row directly.
- **`42501` inserting an `agent_blueprint` row.** Only an owner may change the blueprint.
  Members read it and see the editor read-only.
- **"Couldn't confirm what the agent is allowed to do."** The org's blueprint could not be
  read, so the action was denied rather than run under a guessed contract. The denial is in
  `audit_event` with a `:contract_unavailable` target. Check the database connection and retry;
  nothing was written.

## Deploy

Vercel project + Supabase hosted project with migrations `0001`–`0019` applied
(`npx supabase db push`, or apply each file's SQL directly through the Supabase
Management API's `database/query` endpoint if the CLI's own auth token lacks project-admin
scope — see git history around 2026-09-10/11 for how this deployment's migrations were
applied that way). `SUPABASE_SERVICE_ROLE_KEY` is server-only — it is never imported into
a client component. The hosted database has no seed data, so `/ingest` starts with no
clients there — use **Add a new client**.

Env vars actually required in production, beyond the three Supabase ones already named
throughout this file:

- `SITE_ORIGIN` — this deployment's own origin, e.g. `https://your-app.vercel.app`. See
  the comment above `siteOrigin()` in `lib/http/site-origin.ts`: without it, redirect
  targets and OAuth callbacks trust the `Host`/`X-Forwarded-Host` headers instead, which
  is an open-redirect risk. Set this in every deployed environment.
- `DATA_SOURCE_KEK` — generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Without
  it, connecting Gmail/Drive/Calendar fails outright (`DATA_SOURCE_KEK is not set`);
  everything else keeps working.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from the Google Cloud OAuth client used
  for the app's own Drive/Gmail/Calendar *connect* flow (`/auth/google/connect/callback`).
  This is separate from Supabase's own Google provider config (which takes the same
  client's ID/secret, registered at `<project>.supabase.co/auth/v1/callback` — a second,
  different redirect URI on the *same* OAuth client covers both).
- `CRON_SECRET` — required for the scheduled sweep in `vercel.json` (`/api/cron/reminders`,
  daily) to authenticate; without it every scheduled run gets a 401 and nothing runs.
  Vercel's Cron feature sends this automatically once the env var exists — generate any
  random string, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
- `AI_GATEWAY_API_KEY` — only needed if not deploying on Vercel itself (Vercel's own AI
  Gateway auto-authenticates deployed projects via OIDC with no key required). See
  "Current deployment status" above for the payment-method gate this hits regardless.
