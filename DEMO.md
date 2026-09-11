# Demo script

A step-by-step walkthrough for recording a live product demo of ConductFlow.
Everything below was tested against the real production deployment on 2026-09-11,
including the live AI calls — not a scripted mock.

- **Live app:** https://conductflow-woad.vercel.app
- **GitHub repo:** https://github.com/joinconductflow-ship-it/conductFlow
- **Sign-in:** Google OAuth ("Continue with Google") or the email sign-in link. The
  account already used for testing (`sai.chowdarapu09@gmail.com`) is allowlisted for the
  Gmail-connected demo — use that account if you want the live Gmail draft moment to work
  without extra setup.
- **Demo persona:** a solo math tutor ("Tutor") with one client, **Priya Sharma**. All
  seeded data (retainer, invoice, scheduled session, document) already uses this persona —
  don't introduce a different business type mid-demo, the numbers won't line up.

Total run time: roughly 6–8 minutes if you follow every section; 3–4 minutes for just
sections 1–3 if you're short on time.

---

## Before you hit record

1. Open https://conductflow-woad.vercel.app/queue and sign in once so the session is warm
   — the first Google OAuth redirect is not something you want live on camera.
2. Look at the queue. You should see 4 items ("send the invoice", "schedule the makeup
   session", "send a progress note" — marked overdue, "email you the revised practice
   set"). That overdue one is real and expected — leave it, it's a good talking point for
   the payment-risk / promise-risk story in section 4.
3. Have a transcript ready to paste (section 1 gives you one). Don't type it live letter by
   letter on camera — paste it.
4. **AI Gateway note:** extraction and drafting calls cost a fraction of a cent each and
   draw against a $5/month spend cap already set on the account. Don't run the same
   extraction more than 2–3 times in a row while testing — space repeated calls out by a
   minute if you need to retry, or you may see a rate-limit message (harmless, just wait
   and click Retry).

---

## 1. The core moment: transcript → tracked commitments → drafted follow-up

This is the headline feature. Everything else in the product hangs off this loop.

1. Click **Add transcript** (top right, always visible).
2. Client is already defaulted to **Priya Sharma** — leave it.
3. Conversation title: type `Weekly check-in`.
4. Paste this into the transcript box:

   ```
   Priya: Thanks for the update. Can you send over the revised practice set by Friday like we discussed?
   Tutor: Absolutely. I'll email you the revised practice set by Friday, and I'll also send a progress note this evening summarizing today's session. One more thing — I'll schedule the makeup session for next Tuesday since we missed one last week.
   Priya: Perfect, that works. Also, can you invoice me for this month once the sessions wrap up?
   Tutor: Yes, I'll send the invoice by the end of the month.
   ```

5. Click **Find the promises**. Say out loud while it's thinking (2–5 seconds): *"It's
   reading the transcript and pulling out every commitment — who owes it, when it's due,
   and the exact words it came from."*
6. You land on **Queue** with 4 new commitments extracted from that one paste — each with
   an owner, a due date, and a confidence level. Point out: **nothing has been sent to
   anyone yet.** This is the core promise of the product.
7. Click into one commitment (e.g. "send a progress note"). Show:
   - The drafted follow-up email, written in the tutor's voice.
   - The **"read: transcript · client record"** line — what the model was allowed to read.
   - The **"never auto-sends"** badge.
8. Click **Approve & create task**. Narrate: *"Approving does two things — it creates a
   task on the board, and if Gmail is connected, it places the exact draft you just saw
   into the user's real Gmail drafts folder. It never sends. The person still has to open
   Gmail and hit send themselves."*
9. Optional but strong if Gmail is connected on the signed-in account: switch to a Gmail
   tab and show the actual draft sitting there, unsent, addressed to Priya's email,
   subject "Progress Note Confirmation" or similar. This is the moment that proves the
   no-send guarantee isn't just a claim in the UI copy.

---

## 2. Task board and dashboard: what happens after approval

1. Click **Tasks** in the nav. Show the approved commitment now sitting as a card in
   **Open**, tied to Priya Sharma, with its due date.
2. Click **Dashboard**. This is the "promise risk" view — say: *"This is drawn from every
   commitment the assistant has ever extracted, not a separate report someone has to
   build."* Point out the **Past their date** count (1 — the overdue "send a progress
   note" item) and the **100% owned and dated** stat.

---

## 3. A second live AI moment: reviews or leads

Pick whichever fits the story better — both are genuinely live AI calls, not canned demo
data. Leads is slightly more impressive because it's the "growing the business" side
rather than the "delivering the work" side.

### Option A — Leads (inbound inquiry triage)

1. Click **More → Leads**.
2. Paste into "Inquiry text":

   ```
   Hi, I saw your tutoring website. My son is in 8th grade and struggling with algebra. Do you have any openings for weekly sessions? We're hoping to start before his midterms next month.
   ```

3. Click **Triage inquiry**. In a few seconds you get: a title, urgency tag (**high**),
   sentiment, and a ready-to-send reply draft — plus a new prospect card below.
4. Say: *"Same idea as the transcript flow — paste in raw, messy real-world text, and the
   assistant turns it into something the owner can act on in one click, without writing
   the reply from scratch."*

### Option B — Reviews & referrals (reply drafting)

1. Click **More → Reviews & referrals**.
2. Paste a short positive review, fill in a reviewer name, click **Draft response**.
3. Show the sentiment tags (**positive**, **low urgency**) and the drafted reply.

---

## 4. Round out the story: billing, payment risk, scope

Quick hits — 20–30 seconds each, no need to click into detail:

- **More → Billing**: show the existing draft invoice for Priya Sharma ($225, from logged
  time), and that invoice numbers are short human-readable codes, not raw database IDs.
- **More → Payment Risk**: click **Scan now**. Say: *"This correlates open invoices
  against everything else going on with a client — a missed session, an overdue
  commitment — to flag payment risk before an invoice actually goes overdue."*
- **More → Scope of work**: show the saved scope text for Priya Sharma. Say: *"This is the
  guardrail — if a client asks for something outside the agreed scope, the assistant can
  check it against this instead of just agreeing to everything."*

---

## 5. Settings: the trust story

This is worth 30 seconds near the end, not the beginning — it lands better after they've
seen the product work.

1. Click **Settings**.
2. Point at the three Google capabilities (Drive, Calendar, Gmail), each with its own
   narrow scope shown as a raw URL, and each independently connectable/revocable.
3. Say: *"Nothing is bundled. Connecting Gmail only ever grants draft-writing — the scope
   itself, `gmail.compose`, does not include send. That's not a policy choice in this
   app's code, it's enforced by which OAuth scope Google hands out."*

---

## If something goes wrong live

- **"Extraction failed" / a rate-limit message.** Click **Retry**. If it fails twice in a
  row, wait about 60 seconds before the next attempt — see README.md's Troubleshooting
  section ("GatewayRateLimitError") for why. This is a spend-cap safety measure, not a
  broken feature.
- **A queue item doesn't disappear after Discard.** This was a real bug, fixed 2026-09-11
  (see README.md "Resolved" section) — if you're on the deployment described in this file
  it's already fixed. If you somehow hit it again, refresh the page.
- **Nothing extracts at all / a 500 error.** Check `vercel logs
  https://conductflow-woad.vercel.app` — most likely cause is the AI Gateway budget
  lapsing (`vercel ai-gateway budgets list` should show a non-zero team budget).
