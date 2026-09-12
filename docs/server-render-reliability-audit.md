# Server render reliability audit

Audited 2026-09-11: all 18 pages and the shared layout under `app/(app)`, their
rendered components, `lib/db/queries.ts`, the Supabase server client, blueprint
loading, and utilization reporting. Seventeen pages fetch data; onboarding has
no database/external-service reads of its own. No Gmail, Drive, Calendar, or AI
requests run during these renders: those calls belong to actions/handlers.

## Findings and changes

The `/reviews` crash mechanism is confirmed in the original source: either
`client_message_draft` or `received_review` returning an error throws from the
page. A rejected request in the unguarded `Promise.all` also aborts the route.
The same direct-throw pattern existed in billing, documents, scheduling,
retainers, leads, payment risk, and scope. Reports and blueprint loading could
throw indirectly through shared helpers.

Other shared readers logged returned errors but returned `[]`/`null`, hiding the
difference between failure and successful empty data. Rejected requests still
escaped. This could misleadingly report no work, no alerts, no connected
accounts, missing records, or incomplete metrics.

Changes:

- `lib/db/page-read.ts` provides a **render-only** boundary for individual reads.
  It catches both returned Supabase errors and rejected/thrown reads, logs a
  route/query label, and returns `{ data: null, unavailable: true }`. It preserves
  Next.js redirects/not-found/control-flow errors. Raw errors never become client
  props. Ordinary empty results remain distinguishable from failures.
- `logFailure` now retains Error stacks/causes and Supabase code/message/details/
  hint instead of reducing Error instances to their message.
- Lists default to `[]`, optional objects to `null`, and failed sections display
  a short muted message using the existing design tokens. Independent sections
  remain usable. Lookup failures use existing generic client labels.
- Shared read helpers preserve their typed data return values and propagate
  errors to their individual page boundaries. Operations also carries explicit
  availability for its three datasets. Every render caller is covered.
- Failed auth/org checks remain hard failures, with contextual server logs and
  useful exceptions. An absent session remains normal sign-out; a missing
  membership is not replaced by a default tenant. The authenticated user and org
  query reuse the same client, preserving any in-memory token refresh.
- Failed editor permission lookups deny editing. Failed scope/blueprint loads
  cannot appear as blank editable records or shipped defaults. Draft/source
  outages remove approval controls. Failed report inputs suppress the financial
  rollup, including failures after a successful pagination page, rather than
  presenting partial amounts as totals.
- Action implementations and their UI error handlers are unchanged. Blueprint
  enforcement (`contractFor`/`loadBlueprint`) remains strict outside the display
  boundary. No fallback is applied to mutations, agent enforcement, or external
  delivery. No schema, RLS, deployment, or dependency-version changes were made.

## Complete render-read inventory

All page paths below are relative to `app/(app)`. All ordinary data reads are
non-critical to rendering the route shell. Some are required for their specific
section or controls, as noted. Unless otherwise indicated, protected pages first
perform critical `auth.getUser` and `membership.org_id` checks.

| Page/component | Render reads | Classification and failure behavior |
| --- | --- | --- |
| `layout.tsx` | Auth user/email for navigation | Non-critical decoration. Omit account nav, show notice, retain children/onboarding. Pages/actions still verify access. |
| `onboarding/page.tsx` | Search params and environment flag only | No service read. Auth/email actions are unaffected. |
| `reviews/page.tsx` | `client_message_draft` review requests, `received_review`, dependent `client_contact` names | Independent sections. Keep healthy reviews/drafts; failed names use generic labels. A failed received-review list does not suppress the submission form or its action errors. |
| `billing/page.tsx` | Clients, uninvoiced `time_entry`, `invoice`, billing drafts | Independent section flags. Failed time reads do not display zero time or enable invoice creation from unloaded data; invoice/draft sections survive. |
| `documents/page.tsx` | Clients, requirements, document statuses, reminder drafts | Independent fallback. Unknown statuses display unavailable, never “not assigned.” Healthy drafts and requirement creation survive. |
| `scheduling/page.tsx` | Clients, sessions, rescheduling drafts | Independent fallback; failed client selection hides creation only. |
| `retainers/page.tsx` | Clients, retainers, renewal drafts | Independent fallback. Retainers/balances remain visible if drafts fail. Renewal previews depend on their parent retainer records. |
| `leads/page.tsx` | Prospects, reply drafts | Independent fallback. Inquiry form remains usable. |
| `risk/page.tsx` | Open risk flags, dependent client names and related drafts | Independent fallback. Do not claim no risk when flags fail; scan action remains usable. |
| `queue/page.tsx` | Commitments, failed transcripts joined to conversation, escalations joined to conversation | Three independent fallbacks. One alert query cannot remove the commitment list. |
| `queue/[commitmentId]/page.tsx` | Commitment, deliverable draft, commitment-to-conversation lookup and transcript | Record required to display this review, but failure gets an unavailable state rather than a false “not here.” Draft and source are independent display sections; approval requires both reads to succeed. Successful absent record keeps the existing not-here state. RLS remains the access boundary. |
| `tasks/page.tsx` | Task board joined to commitment/client, reminders joined to task, recurring inputs (commitments/tasks/client names) | Board, reminders, recurring suggestions degrade separately. Failed recurring inputs cannot become predictions from incomplete data. |
| `dashboard/page.tsx` | Commitments for metrics | Metrics unavailable on failure; never claim nothing overdue or nothing to measure. |
| `operations/page.tsx` | Commitments, tasks, client names | Commitment/task data required for this aggregate section. Missing names retain metrics with fallback names. |
| `ingest/page.tsx` | Client options | Disable the form on lookup failure, avoiding accidental duplicate-client creation from a falsely empty list. |
| `scope/page.tsx` | Clients, scopes, second auth read and membership role for editor | Failed client/scope data hides the editor. Secondary auth/role failure leaves loaded scopes read-only; server actions still enforce ownership. |
| `reports/page.tsx` | Paginated time and invoice rows, clients, rates | All inputs required for an accurate rollup. Every query logs its name (and offset for pagination). Suppress only the report section if any input fails. |
| `settings/page.tsx` | `connected_data_source_public` view | Hide failed connection section rather than claim integrations are disconnected. Blueprint link and OAuth success/error feedback remain. |
| `settings/blueprint/page.tsx` | Latest blueprint, second auth read and membership role | Failed blueprint hides editor/version/default badge. Auth/role failure denies editing. Never query UUID `user_id` with an empty string when auth is absent. |

Core exceptions deliberately retained: missing/invalid Supabase configuration,
failure to verify an existing session, failure to establish tenant membership,
and framework control flow. No app page contains a direct database-error throw;
critical checks and strict shared readers are handled at the appropriate boundary.

## `/reviews`: schema and RLS investigation

The checked-in queries match the checked-in schema:

| Query dependency | Migration and expectation |
| --- | --- |
| `client_message_draft` | `0012_retainers_and_documents.sql` creates `id`, `org_id`, `client_id`, `kind`, `subject`, `body`, `provider_draft_id`, `created_at`, and the SELECT policy/grants. The page selects four columns and filters/orders on the others. |
| `kind = 'review_request'` | `0016_review_requests.sql` extends the text CHECK constraint. Missing this constraint update prevents inserting that kind; the SELECT itself would normally return no rows, not fail. |
| `received_review` | `0018_review_responses.sql` creates the table, `org_id`, `created_at`, all rendered fields, SELECT policy, and grants. |
| Client names | `0001_schema_rls.sql` creates `client_contact` and org-scoped reads. Lookups now also carry explicit org filters. |
| Tenant authorization | `current_user_orgs()` resolves memberships using `auth.uid()`. Existing SELECT policies constrain `org_id`; server clients use the anon key plus the signed-in user's cookie session, not the service-role key. |

Ordinary RLS exclusion is a successful empty SELECT, not an exception. Missing
table privileges can instead yield `42501`; missing relations/columns or schema
cache differences can yield `42P01`, `42703`, or PostgREST schema errors. This is
why removing RLS or switching reads to service-role is not a justified fix.
See [Supabase RLS/grants documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

The README's 2026-09-11 deployment note says migrations `0001`–`0020` were applied
to `fauqimhboonrmjzrnkzl`, serving `conductflow-woad.vercel.app`. That is repo
documentation, **not live verification**. The connected Vercel/Supabase accounts
do not include those production projects. This checkout has no `.env.local`,
and production credentials are not present in the shell. A public web-tool read
of `/reviews` was unavailable and would not have exercised a signed-in query
anyway. Actual deployed errors/schema therefore remain unconfirmed.

## Recurring causes and confidence

1. **Confirmed: over-broad render failure boundaries.** A secondary error became
   a route failure. Fixed with per-read isolation and fallback states. Next.js
   intentionally strips server error details from production responses; its
   generic message is the symptom, not the database diagnosis. See
   [Next.js error convention](https://nextjs.org/docs/app/api-reference/file-conventions/error).
2. **Confirmed: incomplete diagnostics and false empty states.** Plain Error
   logging dropped stack/cause; several reads ignored errors; other helpers
   collapsed failure into empty data. Fixed. Logs now identify route/query and
   retain the original error fields, including transport causes.
3. **Confirmed code-level session weakness; production causality unproven.**
   `lib/db/server.ts` discards cookie writes during render, while `middleware.ts`
   only builds CSP and does not refresh/persist auth cookies. Multiple client
   instances read the same incoming session. Expiring sessions can consequently
   trigger repeated refreshes across layouts/pages/requests. This is consistent
   with intermittent auth problems, but does not prove the observed reviews
   query error. Correcting middleware session persistence is a separate auth
   change requiring expired-session tests and preservation of CSP/nonce headers;
   it has not been implemented here. Supabase documents why server renders need
   a middleware/proxy refresh path in its
   [SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
4. **Confirmed secondary auth bug:** blueprint role lookup used `user_id = ''`
   if the second auth read returned no user, an invalid UUID input. Fixed by
   skipping the query and denying editing. This explains a concrete failure
   path on blueprint, not `/reviews`.
5. **Possible deployment causes, not verified:** wrong Supabase project in a
   preview/production environment, URL/key mismatch, unapplied migrations,
   changed grants/schema cache, expired/revoked sessions, network/service errors.
   An unset URL/key is a core configuration error. The existing `requireEnv`
   already strips whitespace/BOM; that historical failure class is not newly
   assumed to be the culprit. `/reviews` does not need the AI Gateway, Google
   OAuth capabilities, or a service-role key just to render its lists.

## Read-only production confirmation

Use the **actual deployment's** Vercel runtime logs to find `/reviews:
client_message_draft review_request` or `/reviews: received_review` after this
patch is deployed, or correlate the previous Next.js error digest/timestamp.
Inspect `code`, `message`, `details`, `hint`, and nested causes. Verify that the
deployment's Supabase URL and key refer to the same intended project; don't
publish credentials in logs or compare a preview project to production by accident.

On that exact database, these read-only checks distinguish schema/grant drift:

```sql
select to_regclass('public.client_message_draft') as drafts,
       to_regclass('public.received_review') as reviews,
       to_regclass('public.client_contact') as clients;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('client_message_draft', 'received_review', 'client_contact')
order by table_name, ordinal_position;

select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('client_message_draft', 'received_review', 'client_contact');

select c.relname, c.relrowsecurity,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('client_message_draft', 'received_review', 'client_contact');

select p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'current_user_orgs';
```

Also compare the applied migration ledger with the repository (if deployments
use the CLI ledger; manual SQL application may not populate it). Then execute
the two exact page queries with the affected user's authenticated session and
org, not as service-role/admin, to exercise real RLS. A privileged SQL editor's
successful SELECT does not establish that authenticated users have access.
No live schema/RLS changes were made based on an unverified hypothesis.

## Verification

- Fault-injection render tests cover every page/layout and each data dependency,
  both returned errors and rejected requests, healthy/empty/missing data,
  independent siblings, critical auth, editor denial, later pagination failure,
  and preserving Next.js redirect/not-found behavior.
- Existing action tests run unchanged to guard error/authorization behavior.
- The local production smoke test starts the built Next.js app with a local
  read-only Supabase fixture. Nine authenticated render scenarios verify HTTP
  200, visible fallback/healthy siblings, query-specific server diagnostics, and
  no private database errors or generic RSC failure in the response. It cleans
  up both servers. Run `node tests/reliability/production-smoke.mjs` after a build.
- TypeScript and lint for app/components/changed libraries/tests pass. The
  production build uses `npm run build -- --no-lint` because repository-wide
  lint has pre-existing errors in `extension/src/{background,offscreen,popup}.ts`
  (`@ts-nocheck`, plus an offscreen unused-expression warning).
- Database-backed integration/RLS tests require a running seeded Supabase;
  this environment has no running local Supabase/Docker setup and does not
  expose the production project. Those tests were not represented as passing.
  No real email, AI requests, mutations, or database migrations are used by the
  new reliability tests.

This patch establishes graceful rendering and diagnostics, not a claim that
the underlying production Supabase error has already been fixed or identified.
