import Link from "next/link";
import { Badge, buttonStyle, Card, SectionLabel, StatusPill } from "@/components/ui/primitives";
import { HARD_PROHIBITED } from "@/lib/agent/blueprint";

/**
 * One argument, in order: here is a promise you made, here is the evidence it came from,
 * here is the line the product cannot cross, and here is what it is bad at. No
 * testimonials, logos, or metrics — none exist yet, and inventing them on a page a real
 * customer reads would be a lie.
 */

/** Plain English for the limits enforced in code, not in settings. */
const NEVER: Record<string, string> = {
  send_external_email: "Send an email to anyone",
  change_scope: "Change what was agreed",
  change_pricing: "Change a price",
  sign_contract: "Sign anything",
  take_payment: "Take a payment",
  delete_record: "Delete a record",
};

/** The one prohibition worth arguing in full. The rest read faster as a list. */
const HEADLINE_DENIAL = "send_external_email";
const REST_DENIED = HARD_PROHIBITED.filter((a) => a !== HEADLINE_DENIAL);

/** The things an owner would otherwise discover in week two. */
const LIMITS = [
  {
    label: "the call",
    body: "Nothing of ours joins your call. There is no bot in the meeting and no recording. You bring the transcript afterwards, or just the notes you typed while you talked.",
  },
  {
    label: "nudges",
    body: "An overdue promise shows up on your board the next time you open it. Nobody gets emailed about it, and that includes you.",
  },
  {
    label: "mistakes",
    body: "Extraction is a language model reading a transcript, and it misreads things. That is why every promise arrives with the sentence it came from, and why one whose words cannot be found in your transcript is marked low confidence instead of passed off as certain. You are checking evidence, not trusting a summary.",
  },
  {
    label: "the map",
    body: "The operations view stays quiet until there are about twenty commitments in it. Before that there is not enough there to say anything honest about your lead times.",
  },
];

/**
 * Rendered per request, for the CSP nonce. See the note in privacy/page.tsx: prerendered
 * HTML carries a nonce baked at build time, the header carries one minted per request, and
 * a mismatch blocks every inline script Next emits. Do not add Cache-Control to this route
 * without removing the nonce from the policy first.
 */
export const dynamic = "force-dynamic";

const shell: React.CSSProperties = {
  maxWidth: 960, marginInline: "auto", paddingInline: "var(--space-5)",
};

/**
 * The page's spine: a mono label in the margin, prose beside it. Mono is the machine's
 * side of the product — file names, action ids, timestamps — and the sans column is the
 * human's. It wraps to stacked rather than needing a media query inline styles can't write.
 */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)",
      alignItems: "baseline" }}>
      <span className="mono" style={{ flex: "0 0 9ch", color: "var(--faint)",
        fontSize: "var(--text-xs)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div style={{ flex: "1 1 34ch", minWidth: 0, maxWidth: "60ch" }}>{children}</div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Same affordance the signed-in app gives a keyboard user, for the same reason. */}
      <a href="#main" className="skip-link">Skip to content</a>

      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ ...shell, display: "flex", alignItems: "center",
          justifyContent: "space-between", minHeight: 56, gap: "var(--space-4)" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-md)", letterSpacing: "-0.02em" }}>
            ConductFlow
          </span>
          <Link href="/onboarding" style={{ fontSize: "var(--text-base)" }}>Sign in</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        {/* Copy left, evidence right, and the evidence dropped half a step so the two
            columns don't read as a matched pair. */}
        <section style={{ ...shell, display: "flex", flexWrap: "wrap",
          gap: "var(--space-7)", alignItems: "flex-start",
          paddingTop: "var(--space-7)", paddingBottom: "var(--space-7)" }}>
          <div style={{ flex: "1 1 400px", minWidth: 0 }}>
            <h1 style={{
              // Derived from the scale; the ops-tool cap of 30px is deliberate inside the
              // app, but a landing headline earns more room.
              fontSize: "clamp(var(--text-xl), 3.4vw, calc(var(--text-2xl) * 1.2))",
              letterSpacing: "-0.035em", lineHeight: 1.08, textWrap: "balance",
            }}>
              You said you&apos;d send it by Friday.
            </h1>
            <p style={{ fontSize: "var(--text-md)", lineHeight: 1.6,
              marginTop: "var(--space-4)", maxWidth: "40ch" }}>
              That was minute thirty-eight of a Tuesday call. It is not in your inbox, it is
              not on a list, and the parent is going to remember it.
            </p>
            <p style={{ color: "var(--muted)", lineHeight: 1.7,
              marginTop: "var(--space-4)", maxWidth: "44ch" }}>
              ConductFlow reads the transcript and pulls out what you committed to, with the
              sentence you said it in still attached. Then it writes you a follow-up to approve
              or throw away. Approving one puts the reply in your own Gmail drafts, unsent.
            </p>
            <div style={{ marginTop: "var(--space-6)" }}>
              <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
                padding: "10px 18px" }}>
                Start with one call
              </Link>
              <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                marginTop: "var(--space-3)" }}>
                google sign-in · name and email only
              </p>
            </div>
          </div>

          <figure style={{ flex: "1 1 300px", minWidth: 0, margin: 0,
            marginTop: "var(--space-6)" }}>
            <figcaption className="mono" style={{ color: "var(--faint)",
              fontSize: "var(--text-xs)", letterSpacing: "0.06em", textTransform: "uppercase",
              marginBottom: "var(--space-3)" }}>
              Example · tuesday-check-in.vtt · 00:38:12
            </figcaption>

            <div style={{ borderLeft: "1px solid var(--border-strong)",
              paddingLeft: "var(--space-4)" }}>
              <p style={{ lineHeight: 1.7 }}>
                <span className="mono" style={{ color: "var(--faint)",
                  fontSize: "var(--text-sm)" }}>You</span>{" "}
                Yeah, that&apos;s fine.{" "}
                {/* The one accent above the fold. Tint plus a rule under it, so the
                    highlight survives a monochrome screen. */}
                <mark style={{ background: "var(--accent-quiet)", color: "var(--text)",
                  boxShadow: "inset 0 -1px 0 var(--accent)" }}>
                  I&apos;ll get Mia&apos;s revised practice set over to you by Friday.
                </mark>
              </p>
              <p style={{ lineHeight: 1.7, color: "var(--muted)",
                marginTop: "var(--space-2)" }}>
                <span className="mono" style={{ color: "var(--faint)",
                  fontSize: "var(--text-sm)" }}>Parent</span>{" "}
                Perfect. She&apos;ll be pleased.
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
              paddingLeft: "var(--space-4)", paddingBlock: "var(--space-3)" }}>
              <span aria-hidden style={{ width: 1, height: "var(--space-5)",
                background: "var(--border-strong)", flexShrink: 0 }} />
              <span className="mono" style={{ color: "var(--faint)",
                fontSize: "var(--text-xs)" }}>
                matched word for word in the transcript
              </span>
            </div>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between",
                gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
                  Send Mia&apos;s revised practice set
                </span>
                <Badge tone="ok">high confidence</Badge>
              </div>
              <div className="mono" style={{ color: "var(--muted)",
                fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
                owner: you · due Fri 14 Mar
              </div>
              <div style={{ marginTop: "var(--space-3)" }}>
                <StatusPill tone="warn" label="Waiting for your approval" />
              </div>
              <p style={{ borderTop: "1px solid var(--border)", marginTop: "var(--space-3)",
                paddingTop: "var(--space-3)", color: "var(--muted)", lineHeight: 1.6 }}>
                The draft is already written. Approving it puts the reply in your Gmail drafts.
                Sending it is still your job.
              </p>
            </Card>

            <p style={{ color: "var(--faint)", fontSize: "var(--text-sm)", lineHeight: 1.6,
              marginTop: "var(--space-4)" }}>
              Paste the notes, or upload the .vtt. Speaker labels are kept, because that is how
              it knows the promise was yours and not theirs.
            </p>
          </figure>
        </section>

        {/* A thin band on purpose: the page shouldn't be four tall sections in a row. */}
        <section style={{ borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "var(--space-5)" }}>
            <Rail label="after">
              <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
                An approved promise becomes a card on a board with an owner and a date. Marking
                it delivered stamps who finished it and when, so a month later you can still
                answer whether that practice set actually went out.
              </p>
            </Rail>
          </div>
        </section>

        <section style={{ background: "var(--surface)",
          borderBottom: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "var(--space-7)" }}>
            <SectionLabel>The floor</SectionLabel>
            <h2 style={{ fontSize: "var(--text-xl)", maxWidth: "24ch" }}>
              Six things it cannot do, whatever anyone sets
            </h2>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "58ch",
              lineHeight: 1.7 }}>
              These are refused by the code that runs before any action, not by a preference
              somebody could change on a bad afternoon. There is no switch in settings for them,
              and no support ticket that makes an exception.
            </p>

            {/* One denial carries the whole pitch, so it gets the weight and the proof; the
                other five are a list, not five more cards. */}
            <div style={{ marginTop: "var(--space-5)", background: "var(--raised)",
              borderLeft: "2px solid var(--danger)", borderRadius: "var(--radius-sm)",
              padding: "var(--space-5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: "var(--text-lg)" }}>{NEVER[HEADLINE_DENIAL]}</h3>
                <span className="mono" style={{ color: "var(--danger)",
                  fontSize: "var(--text-xs)", letterSpacing: "0.08em",
                  textTransform: "uppercase" }}>
                  refused in code
                </span>
              </div>
              <div className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-sm)",
                marginTop: "var(--space-2)" }}>
                {HEADLINE_DENIAL}
              </div>
              <p style={{ marginTop: "var(--space-4)", maxWidth: "58ch", lineHeight: 1.7,
                color: "var(--muted)" }}>
                Not to your client, and not even with your approval. The Gmail module has two
                calls in it and neither one sends. A test reads that file and fails the build if
                the word turns up there at all. What approving does is write the follow-up into
                your own Gmail drafts, where it waits until you open Gmail and send it yourself.
              </p>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-5) 0 0" }}>
              {REST_DENIED.map((action) => (
                <li key={action} style={{ display: "flex", justifyContent: "space-between",
                  gap: "var(--space-4)", flexWrap: "wrap", paddingBlock: "var(--space-3)",
                  borderTop: "1px solid var(--border)" }}>
                  <span>{NEVER[action] ?? action}</span>
                  <span className="mono" style={{ color: "var(--faint)",
                    fontSize: "var(--text-sm)" }}>{action}</span>
                </li>
              ))}
            </ul>

            <p style={{ color: "var(--muted)", marginTop: "var(--space-5)", maxWidth: "58ch",
              lineHeight: 1.7 }}>
              Everything above that floor is yours to set: what the assistant may do on its own,
              and what it has to ask you about first. Each change writes a new version instead of
              overwriting the last one, so what it was allowed to do on the day it did something
              stays answerable.
            </p>
          </div>
        </section>

        <section style={{ ...shell, paddingBlock: "var(--space-7)" }}>
          <SectionLabel>Limits</SectionLabel>
          <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "30ch" }}>
            What you would find out in week two
          </h2>
          <div style={{ display: "grid", gap: "var(--space-5)", marginTop: "var(--space-5)" }}>
            {LIMITS.map((l) => (
              <Rail key={l.label} label={l.label}>
                <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>{l.body}</p>
              </Rail>
            ))}
          </div>
        </section>

        <section style={{ borderTop: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingTop: "var(--space-7)",
            paddingBottom: "var(--space-6)" }}>
            <h2 style={{ fontSize: "var(--text-xl)", maxWidth: "22ch" }}>
              Try it on the call you had yesterday.
            </h2>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "52ch",
              lineHeight: 1.7 }}>
              Paste the notes in and read what comes back. If none of it is worth approving, you
              have lost about four minutes and nothing has left the building.
            </p>
            <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
              padding: "10px 18px", marginTop: "var(--space-5)" }}>
              Start with one call
            </Link>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ ...shell, paddingBlock: "var(--space-5)", display: "flex",
          justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap",
          alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>ConductFlow</span>
          <span style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
            alignItems: "baseline" }}>
            <Link href="/privacy" style={{ fontSize: "var(--text-xs)" }}>Privacy</Link>
            <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
              for tutors, consultants, coaches and agencies of two to twenty
            </span>
          </span>
        </div>
      </footer>
    </>
  );
}
