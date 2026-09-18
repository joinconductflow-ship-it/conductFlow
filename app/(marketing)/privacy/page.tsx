import Link from "next/link";
import type { Metadata } from "next";
import { Card, SectionLabel } from "@/components/ui/primitives";
import { HARD_PROHIBITED } from "@/lib/agent/blueprint";
import { LEGAL_PENDING } from "@/lib/legal/pending";

/**
 * The privacy policy, written from what the code does rather than from a template.
 * Every factual claim below is enforced somewhere in this repository, and the ones that
 * are worth checking name the file that enforces them — a policy a reader can verify is
 * worth more than one that merely sounds thorough.
 *
 * The remaining unresolved facts — legal entity, governing jurisdiction, effective date,
 * and retention window — are business or engineering decisions this codebase cannot make,
 * and live in the shared `LEGAL_PENDING` constant (`lib/legal/pending.ts`, imported here as
 * `PENDING`) rather than scattered through the prose, so Terms and Privacy never drift out
 * of sync. Fill them in before this page is linked from anywhere a customer can reach —
 * they are deliberately conspicuous: a policy that quietly ships with an invented
 * retention period or a fictional entity name is worse than one that admits what has not
 * been decided.
 */

export const metadata: Metadata = {
  title: "Privacy — ConductFlow",
  description: "What ConductFlow stores, who else can see it, and what it will never do.",
};

/**
 * Rendered per request so the CSP nonce is real.
 *
 * A prerendered page is HTML written once at build time, and the nonce in middleware.ts is
 * minted once per request. Cache the HTML and the two disagree on the very first request:
 * the header carries a nonce that appears nowhere in the document, so every inline script
 * Next emits is refused and the page never hydrates. Caching this response anywhere — a
 * CDN included — reintroduces exactly that bug, which is why there is no Cache-Control
 * here to go with it. The page is a few hundred bytes of static prose; rendering it per
 * request costs less than the workaround would.
 */
export const dynamic = "force-dynamic";

const PENDING = LEGAL_PENDING;

const shell: React.CSSProperties = {
  maxWidth: 960, marginInline: "auto", paddingInline: "var(--space-5)",
};

/** The mono-label-in-the-margin spine the landing page uses. Same rhythm, same reasons. */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)",
      alignItems: "baseline" }}>
      <span className="mono" style={{ flex: "0 0 9ch", color: "var(--faint)",
        fontSize: "var(--text-xs)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div style={{ flex: "1 1 34ch", minWidth: 0, maxWidth: "62ch" }}>{children}</div>
    </div>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>{children}</p>;
}

function Heading({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ marginBottom: "var(--space-5)" }}>
      <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "34ch" }}>{children}</h2>
      {note ? (
        <p style={{ color: "var(--faint)", marginTop: "var(--space-2)", maxWidth: "56ch",
          lineHeight: 1.6, fontSize: "var(--text-sm)" }}>{note}</p>
      ) : null}
    </div>
  );
}

/** What the product holds, grouped by how it got there — which is what decides who owns it. */
const COLLECTED = [
  {
    label: "account",
    title: "Your account",
    body: "Your name and email address, and the name and timezone of your organisation. Google sign-in asks for identity scopes only; if you sign in by emailed link instead, we hold the address you typed. No password exists anywhere in this system — there is no password field to store.",
  },
  {
    label: "input",
    title: "What you paste in",
    body: "The transcripts and notes you bring, exactly as you submit them, together with everything derived from them: the commitments extracted, the sentence each one came from, the follow-up drafts, tasks, and their completion records. A transcript is whatever you paste — if your conversation touched on health, money, or anything else sensitive, that text is stored as-is.",
  },
  {
    label: "clients",
    title: "The people you work with",
    body: "Names and email addresses of clients and prospects, the enquiries prospects send you, and the record of what was promised to whom. You enter this, and it describes people who are not our customers — which is why the section below on responsibility matters.",
  },
  {
    label: "business",
    title: "How your business runs",
    body: "Retainers and their usage, scope-of-work records, time entries, billing rates and invoices, scheduled sessions and no-show policy, document requirements, and review requests. This is the material the operations view reasons over.",
  },
  {
    label: "google",
    title: "Google access, if you grant it",
    body: "Drive, Calendar, and Gmail are each granted separately, from Settings, one capability at a time — never bundled into sign-in. If you connect one, we store a refresh token for it and references to the specific files you pick. We do not copy your Drive.",
  },
  {
    label: "audit",
    title: "The record of what happened",
    body: "Every action the agent takes is written to an append-only audit log: who or what acted, what kind of action it was, and what it touched. This is the thing that lets you answer 'what was it allowed to do on the day it did that?' — so it is deliberately hard to erase.",
  },
];

/** Everyone outside this codebase that data reaches, and the reason it reaches them. */
const PROCESSORS = [
  {
    name: "Supabase",
    role: "Database and authentication",
    detail: "Stores everything above. Your rows are isolated from other organisations' rows by row-level security in the database itself, not by application code that could forget to check.",
  },
  {
    name: "Vercel",
    role: "Hosting",
    detail: "Runs the application and serves every page. Sees request metadata — IP address, timing — as any web host does.",
  },
  {
    name: "Vercel AI Gateway",
    role: "The model call",
    detail: "Transcript text is sent through the gateway to the model that extracts commitments and writes drafts. The model in use is gpt-oss-120b, an open-weights model, not a personal assistant account tied to you.",
  },
  {
    name: "Google",
    role: "Sign-in, and any capability you connect",
    detail: "Identity for sign-in. If you connect Gmail, approved drafts are written into your own drafts folder. If you connect Drive or Calendar, we read what you point us at.",
  },
];

/** Plain English for the actions the contract denies outright, even with approval. */
const NEVER: Record<string, string> = {
  send_external_email: "send an email to anyone",
  change_scope: "change what was agreed",
  change_pricing: "change a price",
  sign_contract: "sign anything",
  take_payment: "take a payment",
  delete_record: "delete a record",
};

export default function Privacy() {
  const denied = HARD_PROHIBITED.filter((a) => a in NEVER).map((a) => NEVER[a]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>

      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ ...shell, display: "flex", alignItems: "center",
          justifyContent: "space-between", minHeight: 56, gap: "var(--space-4)" }}>
          <Link href="/product" style={{ fontWeight: 600, fontSize: "var(--text-md)",
            letterSpacing: "-0.02em", color: "var(--text)", textDecoration: "none" }}>
            ConductFlow
          </Link>
          <Link href="/onboarding" style={{ fontSize: "var(--text-base)" }}>Sign in</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        <section style={{ ...shell, paddingTop: "var(--space-7)",
          paddingBottom: "var(--space-6)" }}>
          <SectionLabel>Privacy</SectionLabel>
          <h1 style={{
            fontSize: "clamp(var(--text-xl), 3vw, var(--text-2xl))",
            letterSpacing: "-0.03em", lineHeight: 1.1, textWrap: "balance", maxWidth: "24ch",
          }}>
            What we hold, and what we will not do with it.
          </h1>
          <p style={{ fontSize: "var(--text-md)", lineHeight: 1.6,
            marginTop: "var(--space-4)", maxWidth: "52ch" }}>
            This product reads conversations you had with your clients. That is about as
            sensitive as business software gets, so this page is specific rather than
            reassuring.
          </p>
          <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
            marginTop: "var(--space-5)" }}>
            last updated {PENDING.updated} · {PENDING.entity}
          </p>
        </section>

        {/* The summary anyone will actually read, before the sections nobody does. */}
        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Card tone="neutral">
            <h2 style={{ fontSize: "var(--text-md)", marginBottom: "var(--space-4)" }}>
              The short version
            </h2>
            <ul style={{ display: "grid", gap: "var(--space-3)", margin: 0,
              paddingLeft: "var(--space-4)", color: "var(--muted)", lineHeight: 1.7 }}>
              <li>
                Nothing is sent to anyone on your behalf. Approving a follow-up puts it in
                your own Gmail drafts, unsent. This is enforced in code, not in a setting.
              </li>
              <li>
                Nothing of ours joins your calls. There is no meeting bot and no recording.
                You bring the transcript afterwards.
              </li>
              <li>
                Your transcripts are sent to a language model so it can extract commitments
                and write drafts. That is the core of the product and there is no way to use
                it without that happening.
              </li>
              <li>
                We do not sell your data, and we do not use your transcripts to train models.
              </li>
              <li>
                Another organisation cannot read your rows. That is enforced by the database,
                not by application code.
              </li>
            </ul>
          </Card>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading note="Grouped by how it got here, because that decides who is responsible for it.">
            What is stored
          </Heading>
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            {COLLECTED.map((c) => (
              <Rail key={c.label} label={c.label}>
                <h3 style={{ fontSize: "var(--text-base)", marginBottom: "var(--space-2)" }}>
                  {c.title}
                </h3>
                <Prose>{c.body}</Prose>
              </Rail>
            ))}
          </div>
        </section>

        {/* The part most policies skip, and the part that actually matters to the people
            whose words end up in a transcript. */}
        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>Who is responsible for your clients&apos; data</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              Your clients are your clients. When you paste a transcript, you decide what goes
              in, what it is used for, and how long you keep it. In data-protection terms you
              are the controller and we are your processor: we handle that material on your
              instructions and for no purpose of our own.
            </Prose>
            <Prose>
              That has a practical consequence worth stating plainly. The people in your
              transcripts did not sign up here and mostly do not know this product exists.
              Telling them how you handle their information, and having a lawful basis for
              putting it in here, is your responsibility, not ours. If one of them asks you to
              delete what you hold about them, we will help you do it.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading note="Everyone outside this codebase that your data reaches, and why.">
            Who else processes it
          </Heading>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {PROCESSORS.map((p) => (
              <Card key={p.name} tone="neutral">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)",
                  alignItems: "baseline", justifyContent: "space-between" }}>
                  <h3 style={{ fontSize: "var(--text-base)" }}>{p.name}</h3>
                  <span className="mono" style={{ color: "var(--faint)",
                    fontSize: "var(--text-xs)" }}>{p.role}</span>
                </div>
                <p style={{ color: "var(--muted)", lineHeight: 1.7,
                  marginTop: "var(--space-3)", maxWidth: "62ch" }}>{p.detail}</p>
              </Card>
            ))}
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading note="Claims worth checking. Each is enforced in a named file, not in a policy document.">
            What it cannot do
          </Heading>
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <Rail label="sending">
              <Prose>
                The assistant cannot {denied[0] ?? "send an email to anyone"}. No Google scope
                permits creating a draft without also permitting send, so the guarantee is not
                bought with scopes — it is built. The Gmail module exposes exactly two
                endpoints, and a test fails the build if the word &ldquo;send&rdquo; appears
                anywhere in it.
              </Prose>
            </Rail>
            <Rail label="denied">
              <Prose>
                Beyond sending, these are refused outright, even if you approve them:{" "}
                {denied.slice(1).join(", ")}. They sit in the contract&apos;s prohibited list,
                which no setting can override.
              </Prose>
            </Rail>
            <Rail label="isolation">
              <Prose>
                Every table carries an organisation id and a row-level security policy that
                ties reads and writes to the organisations you belong to. A request for
                another org&apos;s row returns nothing, because the database refuses it rather
                than because a function remembered to filter.
              </Prose>
            </Rail>
            <Rail label="tokens">
              <Prose>
                Google refresh tokens are sealed with envelope encryption and stored in a table
                the ordinary logged-in database role cannot read at all. Each ciphertext is
                bound to the row it belongs to, so a token copied to another row fails to
                decrypt rather than working somewhere it should not.
              </Prose>
            </Rail>
            <Rail label="prompts">
              <Prose>
                Transcript text is wrapped as data, never as instructions, and passages that
                look like an attempt to give the model orders are flagged on the transcript and
                surfaced to you. A transcript is something someone else wrote; it is not
                treated as trusted input.
              </Prose>
            </Rail>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>Keeping it, and getting rid of it</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              Your data stays while your account is open. You can delete individual
              transcripts, commitments, and drafts from the product as you go.
            </Prose>
            <Prose>
              When an account closes, its data is removed within {PENDING.retention}. The audit
              log is the exception: it is append-only by design, because a record that can be
              quietly rewritten is not a record. Disconnecting a Google capability in Settings
              revokes and deletes the stored token for it immediately.
            </Prose>
            <Prose>
              Depending on where you live you may have statutory rights to a copy of your data,
              to correct it, or to have it erased — {PENDING.jurisdiction} governs which apply.
              Write to {PENDING.contact} and we will action it.
            </Prose>
          </div>
        </section>

        <section style={{ borderTop: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingTop: "var(--space-7)",
            paddingBottom: "var(--space-6)" }}>
            <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "28ch" }}>
              Something here look wrong?
            </h2>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "54ch",
              lineHeight: 1.7 }}>
              This page describes a system that changes. If you find a claim on it that the
              product does not honour, that is a bug worth hearing about — write to{" "}
              {PENDING.contact}.
            </p>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ ...shell, paddingBlock: "var(--space-5)", display: "flex",
          justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap",
          alignItems: "baseline" }}>
          <Link href="/product" style={{ fontWeight: 600, fontSize: "var(--text-base)",
            color: "var(--text)", textDecoration: "none" }}>
            ConductFlow
          </Link>
          <span style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
            alignItems: "baseline" }}>
            <Link href="/terms" style={{ fontSize: "var(--text-xs)" }}>Terms</Link>
            <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
              privacy
            </span>
          </span>
        </div>
      </footer>
    </>
  );
}
