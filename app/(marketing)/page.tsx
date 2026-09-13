import Link from "next/link";
import Image from "next/image";
import { Badge, buttonStyle, Card, SectionLabel, StatusPill } from "@/components/ui/primitives";

import { HARD_PROHIBITED } from "@/lib/agent/blueprint";
import type { Viewport } from "next";

/** Published as a GitHub release asset: ~96 MB is too large for the repo or a Vercel
 *  deploy, and a release gives the file a stable URL and a place to state the
 *  unsigned/Apple-Silicon caveats in full.
 *
 *  The filename carries no version on purpose. It used to, and the first release that
 *  bumped the version turned this link into a 404 — /releases/latest/download resolves
 *  the tag for you but not the asset name. */
const DESKTOP_DOWNLOAD_URL =
  "https://github.com/joinconductflow-ship-it/conductFlow/releases/latest/download/conductFlow-arm64.dmg";

/**
 * One argument, in order: here is a promise you made, here is the evidence it came from,
 * here is the line the product cannot cross, and here is what it is bad at. No
 * testimonials, logos, or metrics; none exist yet, and inventing them on a page a real
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

/** Apple's mark, inline so the strict CSP does not need a new image source. */
function AppleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 384 512" width="15" height="15" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
    </svg>
  );
}

type Service = "gmail" | "drive" | "calendar";

function ServiceMark({ service }: { service: Service }) {
  if (service === "gmail") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="marketing-service-mark">
        <rect x="2.5" y="4" width="19" height="16" rx="3" fill="#fff" stroke="#EA4335" />
        <path d="m4 7 8 6 8-6" fill="none" stroke="#EA4335" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (service === "drive") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="marketing-service-mark">
        <path d="m8.2 3 4.1 0 7.3 12.5-4.1 0L8.2 3Z" fill="#F4B400" />
        <path d="M8.2 3 4.4 9.5 8 15.7l3.9-6.5L8.2 3Z" fill="#0F9D58" />
        <path d="M4.4 9.5 2.2 13.3A3.2 3.2 0 0 0 5 18h10.5l2.3-4H7.2L4.4 9.5Z" fill="#4285F4" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="marketing-service-mark">
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#4285F4" />
      <path d="M3 9h18" stroke="#fff" strokeWidth="2" />
      <path d="M7 3v4M17 3v4" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
      <text x="12" y="17" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">31</text>
    </svg>
  );
}

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

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#F6F2E9",
};

const shell: React.CSSProperties = {
  maxWidth: 1120, marginInline: "auto", paddingInline: "var(--space-5)",
};

/**
 * The page's spine: a mono label in the margin, prose beside it. Mono is the machine's
 * side of the product: file names, action ids, timestamps; the sans column is the
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
    <div className="marketing-page">
      {/* Same affordance the signed-in app gives a keyboard user, for the same reason. */}
      <a href="#main" className="skip-link">Skip to content</a>

      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ ...shell, display: "flex", alignItems: "center",
          justifyContent: "space-between", minHeight: 56, gap: "var(--space-4)" }}>
          <Link href="/" aria-label="ConductFlow home" className="marketing-brand">
            <span className="marketing-logo-frame">
              <Image src="/ConductFlowLogo.png" alt="" width={32} height={32}
                priority className="marketing-logo" />
            </span>
            <span>ConductFlow</span>
          </Link>
          <nav className="marketing-header-nav" aria-label="Homepage sections">
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <a href="#principles">Principles</a>
            <a href="#desktop">Mac app</a>
          </nav>
          <Link href="/onboarding" style={{ fontSize: "var(--text-base)" }}>Sign in</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        <section className="marketing-hero" style={{ ...shell, maxWidth: 1400,
          gap: "clamp(var(--space-6), 6vw, 88px)", alignItems: "center",
          paddingTop: "clamp(var(--space-7), 10vw, 112px)", paddingBottom: "clamp(var(--space-7), 10vw, 112px)" }}>
          <div className="marketing-hero-copy" style={{ minWidth: 0 }}>
            <div className="mono marketing-hero-eyebrow">AI-powered follow-through</div>
            <h1 style={{
              fontSize: "clamp(54px, 6.8vw, 92px)",
              letterSpacing: "-0.065em", lineHeight: 0.92, textWrap: "balance",
              maxWidth: "none",
            }}>
              Spend half the time on follow-ups.<br />
              <span className="marketing-hero-title-accent">Never let one slip.</span>
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "var(--text-md)", lineHeight: 1.6,
              marginTop: "var(--space-5)", marginInline: "auto", maxWidth: "54ch" }}>
              ConductFlow finds commitments in your calls, emails, slack, drafts the next step,
              and tracks the administrative work.
            </p>
            <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column",
              alignItems: "center" }}>
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap",
                justifyContent: "center" }}>
                <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
                  fontSize: "var(--text-md)", height: 48, padding: "0 24px" }}>
                  Start with one call <span aria-hidden>→</span>
                </Link>
                <a href={DESKTOP_DOWNLOAD_URL}
                  style={{ ...buttonStyle("secondary"), fontSize: "var(--text-md)",
                    height: 48, padding: "0 20px", display: "inline-flex",
                    alignItems: "center", gap: 8 }}>
                  <AppleMark /> Download for macOS
                </a>
              </div>
              <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                marginTop: "var(--space-3)", opacity: 0.72 }}>
                google sign-in · name and email only · mac app is apple silicon, unsigned
              </p>
            </div>
          </div>

          <figure className="marketing-demo" style={{ minWidth: 0, width: "min(100%, 1040px)",
            margin: 0, textAlign: "left" }}>
            <figcaption className="mono" style={{ color: "var(--faint)",
              fontSize: "var(--text-xs)", letterSpacing: "0.06em", textTransform: "uppercase",
              marginBottom: "var(--space-3)" }}>
              Example · tuesday-check-in.vtt · 00:38:12
            </figcaption>

            <div className="marketing-demo-transcript" style={{ borderLeft: "1px solid var(--border-strong)",
              paddingLeft: "var(--space-4)" }}>
              <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
                01 · transcript
              </div>
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
                matched word for word
              </span>
            </div>

            <Card>
              <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
                letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
                02 · extracted commitment
              </div>
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
                <StatusPill tone="warn" label="Waiting for approval" />
              </div>
              <div style={{ borderTop: "1px solid var(--border)", marginTop: "var(--space-4)",
                paddingTop: "var(--space-4)" }}>
                <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
                  letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  03 · follow-up draft
                </div>
                <p style={{ color: "var(--muted)", lineHeight: 1.6, marginTop: "var(--space-2)" }}>
                  Hi, sharing Mia&apos;s revised practice set, as promised.
                </p>
              </div>
            </Card>
          </figure>
        </section>

        <section id="how-it-works" className="marketing-flow" style={{ borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "clamp(var(--space-6), 7vw, var(--space-7))" }}>
            <SectionLabel>After</SectionLabel>
            <h2 style={{ fontSize: "clamp(var(--text-xl), 3vw, 36px)", maxWidth: "24ch" }}>
              From conversation to follow-through.
            </h2>
            <div className="marketing-flow-steps" style={{ marginTop: "var(--space-6)" }}>
              <div className="marketing-step">
                <div className="marketing-step-header">
                  <span className="mono marketing-step-number">01</span>
                  <h3>Extract the commitment</h3>
                </div>
                <p className="marketing-step-description">Find the promise in the transcript.</p>
                <div className="marketing-flow-excerpt">
                  <div className="mono marketing-flow-excerpt-label">meeting transcript · 00:38:12</div>
                  <p className="marketing-transcript-line">
                    <span className="mono">You</span>{" "}
                    I&apos;ll get Mia&apos;s revised practice set over to you by Friday.
                  </p>
                </div>
              </div>
              <div className="marketing-step">
                <div className="marketing-step-header">
                  <span className="mono marketing-step-number">02</span>
                  <h3>Review the follow-up</h3>
                </div>
                <p className="marketing-step-description">Approve the words before they leave drafts.</p>
                <div className="marketing-flow-excerpt">
                  <div className="mono marketing-flow-excerpt-label">dashboard · open commitment</div>
                  <div className="marketing-review-title">
                    <span>Send Mia&apos;s revised practice set</span>
                    <Badge tone="ok">high confidence</Badge>
                  </div>
                  <div className="mono marketing-review-meta">owner: you · due Fri 14 Mar</div>
                  <div className="marketing-review-status">
                    <StatusPill tone="warn" label="Waiting for approval" />
                  </div>
                </div>
              </div>
              <div className="marketing-step">
                <div className="marketing-step-header">
                  <span className="mono marketing-step-number">03</span>
                  <h3>Do the follow-up</h3>
                </div>
                <p className="marketing-step-description">Keep the final send in your hands.</p>
                <div className="marketing-flow-excerpt marketing-follow-up-excerpt">
                  <div className="mono marketing-flow-excerpt-label">next step · ready in your tools</div>
                  <div className="marketing-service-list">
                    {(["gmail", "drive", "calendar"] as const).map((service) => (
                      <div className="marketing-service-item" key={service}>
                        <ServiceMark service={service} />
                        <span>{service === "gmail" ? "Gmail" : service === "drive" ? "Google Drive" : "Google Calendar"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mono marketing-follow-up-note">draft · file · event</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="marketing-product-system" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "clamp(var(--space-6), 7vw, var(--space-7))" }}>
            <SectionLabel>Product system</SectionLabel>
            <h2 style={{ fontSize: "clamp(var(--text-xl), 3vw, 36px)", maxWidth: "24ch" }}>
              Every commitment gets a path to done.
            </h2>
            <p className="marketing-system-lede">
              ConductFlow keeps the original words, the owner, the deadline, and the follow-up
              connected from the moment the promise is made.
            </p>

            <div className="marketing-system-flow" aria-label="Commitment workflow">
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">01 · input</div>
                <h3>Call / transcript</h3>
                <p>Bring the conversation in.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">02 · extract</div>
                <h3>Commitment extracted</h3>
                <p>Keep the original words.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">03 · assign</div>
                <h3>Owner + due date</h3>
                <p>Make the next step clear.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">04 · draft</div>
                <h3>Follow-up drafted</h3>
                <p>Start from the evidence.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">05 · review</div>
                <h3>User approval</h3>
                <p>You decide what goes out.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">06 · close</div>
                <h3>Completion tracked</h3>
                <p>See whether it got done.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-metrics" aria-label="ConductFlow metrics">
          <div style={{ ...shell, paddingBlock: "var(--space-6)" }}>
            <div className="marketing-metric-grid">
              <div className="marketing-metric">
                <strong>10+</strong>
                <span>Organizations piloting</span>
              </div>
              <div className="marketing-metric">
                <strong>100+</strong>
                <span>Workflows run</span>
              </div>
              <div className="marketing-metric">
                <strong>40–70%</strong>
                <span>Less follow-up time</span>
              </div>
            </div>
          </div>
        </section>

        <section id="principles" className="marketing-trust marketing-dark-section" style={{ background: "var(--surface)",
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

        <section id="desktop" style={{ ...shell, paddingBlock: "var(--space-7)",
          borderTop: "1px solid var(--border)" }}>
          <SectionLabel>Desktop</SectionLabel>
          <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "30ch" }}>
            Capture a call without opening a tab
          </h2>
          <p style={{ color: "var(--muted)", lineHeight: 1.7, maxWidth: "58ch",
            marginTop: "var(--space-4)" }}>
            A menu-bar app for Mac. Copy the notes from a call, press{" "}
            <kbd style={{ font: "inherit", fontSize: "0.92em", border: "1px solid var(--border)",
              borderRadius: 4, padding: "1px 5px" }}>⌘⇧I</kbd>, and the commitments land in
            your queue as proposals. It reads your clipboard when you ask it to, and nothing
            else. Nothing sends — you still approve every draft here.
          </p>

          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center",
            flexWrap: "wrap", marginTop: "var(--space-5)" }}>
            <a
              href={DESKTOP_DOWNLOAD_URL}
              className="cf-btn"
              style={buttonStyle("primary")}
            >
              Download for Mac
            </a>
            <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Apple Silicon · 97 MB · requires a workspace token
            </span>
          </div>

          {/* Said here rather than discovered at the Gatekeeper dialog. An unsigned
              build reads as broken software if the page does not warn about it. */}
          <p style={{ color: "var(--muted)", fontSize: "var(--text-sm)", lineHeight: 1.7,
            maxWidth: "58ch", marginTop: "var(--space-4)" }}>
            This build is not notarised by Apple, so the first launch needs a right-click →
            Open instead of a double-click. It runs on Apple Silicon only. Create a token
            under Settings → Desktop app once you have signed in.
          </p>
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

      <section className="marketing-final-cta" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="marketing-final-cta-inner" style={{ ...shell, paddingTop: "var(--space-7)",
          paddingBottom: "var(--space-6)", display: "flex", flexDirection: "column",
          alignItems: "center", textAlign: "center" }}>
          <h2 style={{ fontSize: "var(--text-xl)", maxWidth: "22ch" }}>
            Try it on the call you had yesterday.
          </h2>
          <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "52ch",
            lineHeight: 1.7 }}>
            Paste the notes in and read what comes back. If none of it is worth approving, you
            have lost about four minutes and nothing has left the building.
          </p>
          <Link href="/onboarding" style={{ ...buttonStyle("primary"), color: "#fff",
            fontSize: "var(--text-lg)", height: 60, minWidth: 300, padding: "0 36px",
            marginTop: "var(--space-5)" }}>
            Start with one call
          </Link>
          </div>
        </section>
      </main>

      <footer className="marketing-footer" style={{ borderTop: "1px solid var(--border)" }}>
        <div style={{ ...shell, paddingBlock: "var(--space-5)", display: "flex",
          justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap",
          alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>ConductFlow</span>
          <span style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
            alignItems: "baseline" }}>
            <Link href="/privacy" style={{ fontSize: "var(--text-xs)" }}>Privacy</Link>
            <Link href="/terms" style={{ fontSize: "var(--text-xs)" }}>Terms</Link>
            <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
              for tutors, consultants, coaches and agencies of two to twenty
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
