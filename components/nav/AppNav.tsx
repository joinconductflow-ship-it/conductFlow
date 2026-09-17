"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";
import { buttonStyle } from "@/components/ui/primitives";

export interface NavItem {
  href: string;
  label: string;
  isCurrent: boolean;
}

const DESTINATIONS: { href: string; label: string }[] = [
  { href: "/queue", label: "Queue" },
  { href: "/tasks", label: "Tasks" },
  { href: "/roi", label: "ROI" },
  { href: "/settings", label: "Settings" },
  { href: "/retainers", label: "Retainers" },
  { href: "/documents", label: "Documents" },
  { href: "/scheduling", label: "Scheduling" },
  { href: "/billing", label: "Billing" },
  { href: "/risk", label: "Payment Risk" },
  { href: "/scope", label: "Scope of work" },
  { href: "/reviews", label: "Reviews & referrals" },
  { href: "/leads", label: "Leads" },
  { href: "/reports", label: "Reports" },
];

/**
 * Pure so it can be tested without a DOM. A nested route marks its parent current:
 * reviewing a draft at /queue/<id> is still being in the queue.
 */
export function navItems(pathname: string): NavItem[] {
  return DESTINATIONS.map((d) => ({
    ...d,
    isCurrent: pathname === d.href || pathname.startsWith(`${d.href}/`),
  }));
}

/**
 * Ingest is a primary action, not a destination, so it sits apart from the links and
 * is styled as a button. Leaving it out entirely was the other option, but then an owner
 * standing on /tasks or /dashboard has no way to add a conversation without going back to
 * the queue first — and adding a conversation is the one thing the product exists to start.
 */
export function AppNav({ email }: { email: string | null }) {
  const pathname = usePathname() ?? "";
  const items = navItems(pathname);
  const moreItems = items.slice(5);
  const currentMore = moreItems.find((item) => item.isCurrent);

  return (
    // Sticky, and sharing the page frame's width and gutter, so the wordmark sits directly
    // above the first character of every screen's heading.
    <nav aria-label="Main" className="cf-nav">
      <div style={{ maxWidth: "var(--shell)", margin: "0 auto", padding: "0 var(--gutter)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-5)", minHeight: 64, flexWrap: "wrap" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", minWidth: 0, flexWrap: "wrap" }}>
          <Link href="/queue" style={{ color: "var(--text)", fontWeight: 650,
            fontSize: "17px", letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>
            ConductFlow
          </Link>

          <ul style={{ display: "flex", listStyle: "none", padding: 0, margin: 0, gap: 1, flexWrap: "wrap" }}>
            {items.slice(0, 5).map((item) => (
              <li key={item.href}>
                {/*
                  The skin lives in globals.css keyed off aria-current, so the pill an eye
                  sees and the state a screen reader hears cannot drift apart. Weight and
                  fill carry it as well as colour does, for a monochrome screen.
                */}
                <Link href={item.href} className="cf-nav-link"
                  aria-current={item.isCurrent ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
            <li style={{ position: "relative" }}>
              <details key={pathname} onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}>
                <summary className={`cf-nav-link${currentMore ? " cf-nav-more-current" : ""}`} style={{ cursor: "pointer",
                  fontWeight: currentMore ? 600 : undefined }}>
                  {currentMore ? `More · ${currentMore.label}` : "More"}
                </summary>
                <ul style={{ position: "absolute", right: 0, minWidth: "max-content",
                  listStyle: "none", margin: "var(--space-2) 0 0", padding: "var(--space-2)",
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                  {moreItems.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="cf-nav-link"
                        aria-current={item.isCurrent ? "page" : undefined}
                        onClick={(event) => {
                          const disclosure = event.currentTarget.closest("details");
                          if (disclosure) disclosure.open = false;
                        }}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          </ul>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
          <Link href="/ingest" className="cf-btn"
            style={{ ...buttonStyle("primary"), color: "#fff", height: 36,
              fontSize: "var(--text-sm)" }}>
            Add transcript
          </Link>
          {email && (
            <span className="mono" title={email} style={{ color: "var(--faint)",
              fontSize: "var(--text-xs)", paddingInline: "var(--space-2)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 180 }}>
              {email}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}
