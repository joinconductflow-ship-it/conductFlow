import Link from "next/link";
import Image from "next/image";
import { buttonStyle, SectionLabel } from "@/components/ui/primitives";
import HeroExample from "@/components/marketing/HeroExample";
import ControlLayer from "@/components/marketing/ControlLayer";


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


const INTEGRATIONS = [
  {
    name: "Gmail",
    description: "Draft follow-ups from the conversation behind them.",
    logo: "/integrations/gmail.webp",
  },
  {
    name: "Google Calendar",
    description: "Turn promised meetings and deadlines into scheduled events.",
    logo: "/integrations/google-calendar.svg",
  },
  {
    name: "Google Drive",
    description: "Create and organize documents tied to the work.",
    logo: "/integrations/google-drive.svg",
  },
  {
    name: "Slack",
    description: "Capture internal follow-through and client-channel commitments.",
    logo: "/integrations/slack.webp",
  },
  {
    name: "DocuSign",
    description: "Route agreements and signature steps into the workflow.",
    logo: "/integrations/docusign.svg",
  },
  {
    name: "Stripe",
    description: "Track payment follow-ups and billing-related commitments.",
    logo: "/integrations/stripe.svg",
  },
] as const;

/** Apple's mark, inline so the strict CSP does not need a new image source. */
function AppleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 384 512" width="15" height="15" fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
    </svg>
  );
}

/**
 * Rendered per request, for the CSP nonce. See the note in privacy/page.tsx: prerendered
 * HTML carries a nonce baked at build time, the header carries one minted per request, and
 * a mismatch blocks every inline script Next emits. Do not add Cache-Control to this route
 * without removing the nonce from the policy first.
 */
const shell: React.CSSProperties = {
  maxWidth: 1120, marginInline: "auto", paddingInline: "var(--space-5)",
};

/**
 * The page's spine: a mono label in the margin, prose beside it. Mono is the machine's
 * side of the product: file names, action ids, timestamps; the sans column is the
 * human's. It wraps to stacked rather than needing a media query inline styles can't write.
 */
/**
 * The landing page, rendered at two URLs with two audiences.
 *
 * /product is public and sells: it offers sign-in and treats the reader as someone who
 * has not committed. / is the signed-in home, rendered inside the app layout with the real
 * nav above it, so every "sign in" affordance here would be dead weight at best and
 * confusing at worst. `signedIn` swaps those three places rather than forking the file,
 * because the prose is the same pitch either way and two copies would drift.
 */
export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="marketing-page">
      {/* Same affordance the signed-in app gives a keyboard user, for the same reason. */}
      <a href="#main" className="skip-link">Skip to content</a>

      <header style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ ...shell, display: "flex", alignItems: "center",
          justifyContent: "space-between", minHeight: 56, gap: "var(--space-4)" }}>
          <Link href={signedIn ? "/" : "/product"} aria-label="ConductFlow home" className="marketing-brand">
            <span className="marketing-logo-frame">
              <Image src="/ConductFlowLogo.png" alt="" width={32} height={32}
                priority className="marketing-logo" />
            </span>
            <span>ConductFlow</span>
          </Link>
          <nav className="marketing-header-nav" aria-label="Homepage sections">
            <a href="#product">Product</a>
            <a href="#product">How it works</a>
            <a href="#principles">Principles</a>
            <a href="#desktop">Mac app</a>
          </nav>
          {signedIn
            ? <Link href="/queue" style={{ fontSize: "var(--text-base)" }}>Go to queue</Link>
            : <Link href="/onboarding" style={{ fontSize: "var(--text-base)" }}>Sign in</Link>}
        </div>
      </header>

      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        <section className="marketing-hero" style={{ ...shell, maxWidth: 1400,
          gap: "clamp(var(--space-6), 6vw, 88px)", alignItems: "center",
          paddingTop: "clamp(var(--space-7), 10vw, 112px)", paddingBottom: "clamp(var(--space-7), 10vw, 112px)" }}>
          <div className="marketing-hero-copy" style={{ minWidth: 0 }}>
            <div className="mono marketing-hero-eyebrow">AI-POWERED ORCHESTRATION</div>
            <h1 style={{
              fontSize: "clamp(54px, 6.8vw, 92px)",
              letterSpacing: "-0.065em", lineHeight: 0.92, textWrap: "balance",
              maxWidth: "none",
            }}>
              <span className="marketing-hero-title-accent">AI orchestration</span> that turns<br />
              CRM workflows into one click.
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "var(--text-md)", lineHeight: 1.6,
              marginTop: "var(--space-5)", marginInline: "auto", maxWidth: "54ch" }}>
              ConductFlow extracts commitments from calls, email, and Slack, prepares the next
              actions across your tools, and tracks execution to completion.
            </p>
            <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column",
              alignItems: "center" }}>
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap",
                justifyContent: "center" }}>
                <Link href={signedIn ? "/queue" : "/onboarding"}
                  style={{ ...buttonStyle("primary"), color: "#fff",
                  fontSize: "var(--text-md)", height: 48, padding: "0 24px" }}>
                  {signedIn ? "Open your queue" : "Start with one conversation"} <span aria-hidden>→</span>
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
                google sign-in · name and email only
              </p>
            </div>
          </div>

          <HeroExample />
        </section>

        <section id="product" className="marketing-product-system" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingBlock: "clamp(var(--space-6), 7vw, var(--space-7))" }}>
            <SectionLabel>Product system</SectionLabel>
            <h2 style={{ fontSize: "clamp(var(--text-xl), 3vw, 36px)", maxWidth: "24ch" }}>
              Every commitment gets a path to done.
            </h2>
            <p className="marketing-system-lede">
              ConductFlow brings in conversations, prepares the next steps, and tracks the work
              through completion.
            </p>

            <div className="marketing-system-flow" aria-label="Commitment workflow">
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">01 · CAPTURE</div>
                <h3>Capture</h3>
                <p>Bring in calls, emails, and messages.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">02 · UNDERSTAND</div>
                <h3>Understand</h3>
                <p>Identify the commitment, owner, and due date.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">03 · EXECUTE</div>
                <h3>Execute</h3>
                <p>Prepare follow-ups and actions across your tools.</p>
              </div>
              <div className="marketing-system-step">
                <div className="mono marketing-system-label">04 · TRACK</div>
                <h3>Track</h3>
                <p>Review, approve, and track work through completion.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="marketing-integrations" aria-labelledby="platform-integrations-title">
          <div style={{ ...shell, paddingBlock: "clamp(var(--space-7), 8vw, 96px)" }}>
            <div className="marketing-integrations-heading">
              <div className="mono marketing-integrations-eyebrow">PLATFORM INTEGRATIONS</div>
              <h2 id="platform-integrations-title">
                Works with the tools your team already uses.
              </h2>
              <p>
                ConductFlow turns commitments into actions across your calendar, inbox, files,
                messages, signatures, and payments.
              </p>
            </div>

            <div className="marketing-integrations-grid">
              {INTEGRATIONS.map((integration) => (
                <article className="marketing-integration-card" key={integration.name}>
                  <div className="marketing-integration-icon">
                    <Image
                      src={integration.logo}
                      alt=""
                      width={32}
                      height={32}
                      className="marketing-integration-logo"
                      unoptimized
                    />
                  </div>
                  <h3>{integration.name}</h3>
                  <p>{integration.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <ControlLayer />

        <section id="desktop" className="marketing-desktop-app"
          style={{ borderTop: "1px solid var(--border)" }}>
          <div style={shell}>
            <div className="marketing-desktop-layout">
              <div className="marketing-desktop-copy">
              <SectionLabel>Desktop app</SectionLabel>
              <h2>Capture a call without opening another tab.</h2>
              <p>
                Press{" "}
                <kbd className="marketing-desktop-hotkey">⌘⇧I</kbd>, send the conversation to
                ConductFlow, and turn it into proposed work for your queue.
              </p>
              <p className="marketing-desktop-trust">Nothing executes until you approve it.</p>

              <div className="marketing-desktop-actions">
                <a href={DESKTOP_DOWNLOAD_URL} className="cf-btn" style={buttonStyle("primary")}>
                  Download for macOS
                </a>
                <span className="marketing-desktop-requirements">Apple Silicon · macOS 11+</span>
              </div>

              <details className="marketing-install-notes">
                <summary>Install notes</summary>
                <p>
                  The build is unsigned, so first launch requires right-click → Open. Create a
                  workspace token in Settings → Desktop app after signing in.
                </p>
              </details>
              </div>

              <div className="marketing-desktop-feature" aria-label="Desktop app workflow">
              <div className="marketing-desktop-flow" role="list">
                <div className="marketing-desktop-step" role="listitem">
                  <span className="mono marketing-desktop-step-key">⌘⇧I</span>
                  <span className="marketing-desktop-step-label">Capture notes</span>
                </div>
                <span className="marketing-desktop-connector" aria-hidden="true">→</span>
                <div className="marketing-desktop-step" role="listitem">
                  <span className="mono marketing-desktop-step-key">Extract</span>
                  <span className="marketing-desktop-step-label">Find commitments</span>
                </div>
                <span className="marketing-desktop-connector" aria-hidden="true">→</span>
                <div className="marketing-desktop-step" role="listitem">
                  <span className="mono marketing-desktop-step-key">Queue</span>
                  <span className="marketing-desktop-step-label">Review proposed work</span>
                </div>
              </div>
              </div>
            </div>
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
          <Link href={signedIn ? "/ingest" : "/onboarding"}
            style={{ ...buttonStyle("primary"), color: "#fff",
            fontSize: "var(--text-lg)", height: 60, minWidth: 300, padding: "0 36px",
            marginTop: "var(--space-5)" }}>
            {signedIn ? "Add a conversation" : "Start with one call"}
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
