import Link from "next/link";
import type { Metadata } from "next";
import { Card, SectionLabel } from "@/components/ui/primitives";
import { LEGAL_PENDING } from "@/lib/legal/pending";

/**
 * Terms of service. Written the same way privacy/page.tsx is: specific to what this
 * product actually does, not a template with the product name swapped in. Sections that
 * describe behavior name the mechanism behind it so a reader can check the claim, the same
 * discipline the privacy page holds itself to.
 *
 * This page is a placeholder scaffold, not a substitute for legal review. Perplexity
 * research (2026-09-11) into what a solo founder needs before real signups flagged that a
 * SaaS handling client communications data, acting on users' behalf via Gmail/Drive/
 * Calendar, and using restricted Google scopes should have a lawyer review this document
 * before it is linked from anywhere a real customer can reach — see the "Before you rely
 * on this" note below and the outstanding-work list in README.md.
 */

export const metadata: Metadata = {
  title: "Terms — ConductFlow",
  description: "The agreement between you and ConductFlow, in plain terms.",
};

/** Same per-request rendering as privacy/page.tsx, and for the same CSP-nonce reason. */
export const dynamic = "force-dynamic";

const PENDING = LEGAL_PENDING;

const shell: React.CSSProperties = {
  maxWidth: 960, marginInline: "auto", paddingInline: "var(--space-5)",
};

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

export default function Terms() {
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
          <SectionLabel>Terms</SectionLabel>
          <h1 style={{
            fontSize: "clamp(var(--text-xl), 3vw, var(--text-2xl))",
            letterSpacing: "-0.03em", lineHeight: 1.1, textWrap: "balance", maxWidth: "24ch",
          }}>
            The agreement, in the same voice as the product.
          </h1>
          <p style={{ fontSize: "var(--text-md)", lineHeight: 1.6,
            marginTop: "var(--space-4)", maxWidth: "52ch" }}>
            This is what you agree to by creating an account. Read{" "}
            <Link href="/privacy">the privacy policy</Link> too — it covers what is stored
            and who else processes it; this page covers the relationship itself.
          </p>
          <p className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
            marginTop: "var(--space-5)" }}>
            last updated {PENDING.updated} · {PENDING.entity}
          </p>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Card tone="warn">
            <h2 style={{ fontSize: "var(--text-md)", marginBottom: "var(--space-3)" }}>
              Before you rely on this
            </h2>
            <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>
              This page is a scaffold written from the product&apos;s actual behavior, not a
              lawyer-reviewed contract. It should not be linked from anywhere a paying,
              non-test customer can reach until a lawyer has reviewed it and the placeholders
              above are resolved. See the outstanding-work list in this repository&apos;s
              README for what that involves.
            </p>
          </Card>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>What the service does</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              ConductFlow reads a transcript or note you paste in, extracts the commitments it
              finds, and drafts a follow-up for each one. You review and approve every draft.
              If you connect Gmail, an approved draft is written into your own Gmail drafts
              folder — unsent. Nothing leaves your Gmail account without you clicking send
              yourself; that guarantee is enforced in the code that talks to Google&apos;s
              API, not by a setting you could accidentally change.
            </Prose>
            <Prose>
              Retainers, documents, scheduling, billing, scope-of-work tracking, review and
              lead-response drafting, and the payment-risk view are the same shape: the
              product observes what you tell it and drafts the next step. It never acts on a
              client, sends a message, changes a price, or takes a payment without your
              explicit approval — see the &ldquo;What it cannot do&rdquo; section of{" "}
              <Link href="/privacy">the privacy policy</Link> for exactly what is refused
              outright and how.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading note="You bring your clients' information into this product. That comes with responsibility this agreement does not take off you.">
            Your responsibilities
          </Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              You must have the lawful right to put a client or prospect&apos;s information —
              names, emails, transcripts, anything they told you — into this product. If your
              own work is covered by a confidentiality duty, a professional-conduct rule, or a
              law like HIPAA, FERPA, or GLBA, it is your responsibility to confirm that using
              this product does not put you in breach of it. ConductFlow does not review what
              you paste in for legal compliance.
            </Prose>
            <Prose>
              You are responsible for what you approve. The product drafts; you decide whether
              a draft is accurate before it goes anywhere. Approving a follow-up you have not
              read is the same as writing it yourself.
            </Prose>
            <Prose>
              You will not use the service to harass, defraud, or deceive anyone, or to send
              content you do not have the right to send. You are responsible for keeping your
              account credentials to yourself and for what happens under your account.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>Google account access</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              Connecting Gmail, Drive, or Calendar grants ConductFlow&apos;s use of Google
              user data under{" "}
              <a href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank" rel="noopener noreferrer">
                Google&apos;s API Services User Data Policy
              </a>
              , including its Limited Use requirements: that data is used only to provide the
              feature you connected it for, is never sold, and is never used to serve
              advertising. You can revoke any Google capability from Settings at any time,
              which deletes the stored access token for it immediately.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>Account, suspension, and termination</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              You may stop using the service and close your account at any time. We may
              suspend or terminate an account that violates this agreement, that we
              reasonably believe is being used for a harmful or unlawful purpose, or where
              required by law. Where practical, we will tell you why.
            </Prose>
            <Prose>
              What happens to your data when an account closes is covered in{" "}
              <Link href="/privacy">the privacy policy</Link>.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>No warranty, and the limits of liability</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              The service is provided as-is. A drafted commitment, invoice line, or reply is a
              suggestion built from what you pasted in — it can be wrong, and you are
              responsible for checking it before you approve it. We do not warrant that the
              service will be uninterrupted, error-free, or fit for a particular purpose.
            </Prose>
            <Prose>
              To the extent the law allows, ConductFlow is not liable for indirect,
              incidental, or consequential damages arising from your use of the service, and
              total liability for any claim is limited to the amount you paid for the service
              in the twelve months before the claim arose. This paragraph is a placeholder for
              language a lawyer should set for {PENDING.jurisdiction} — do not rely on it as
              final.
            </Prose>
          </div>
        </section>

        <section style={{ ...shell, paddingBottom: "var(--space-7)" }}>
          <Heading>Changes to these terms</Heading>
          <div style={{ display: "grid", gap: "var(--space-4)", maxWidth: "62ch" }}>
            <Prose>
              We may update this agreement as the product changes. Material changes will be
              posted here with an updated date; continuing to use the service after a change
              takes effect means you accept it. This agreement is governed by the laws of{" "}
              {PENDING.jurisdiction}, without regard to conflict-of-laws principles.
            </Prose>
          </div>
        </section>

        <section style={{ borderTop: "1px solid var(--border)" }}>
          <div style={{ ...shell, paddingTop: "var(--space-7)",
            paddingBottom: "var(--space-6)" }}>
            <h2 style={{ fontSize: "var(--text-lg)", maxWidth: "28ch" }}>
              Questions about this agreement?
            </h2>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-3)", maxWidth: "54ch",
              lineHeight: 1.7 }}>
              Write to {PENDING.contact}.
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
            <Link href="/privacy" style={{ fontSize: "var(--text-xs)" }}>Privacy</Link>
            <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
              terms
            </span>
          </span>
        </div>
      </footer>
    </>
  );
}
