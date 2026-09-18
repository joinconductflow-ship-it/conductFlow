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

export interface NavGroup {
  label: string;
  /** Where the tab itself goes: the group's first destination. */
  href: string;
  items: NavItem[];
  isCurrent: boolean;
}

/**
 * Thirteen destinations, seven tabs.
 *
 * They used to be a flat list where the first five were visible and the other eight lived
 * under "More". That ordering was not a judgement about importance, it was just the order
 * they were built in, so Payment Risk and Leads were equally buried and the menu had no
 * theme you could learn. A tab bar that hides most of the product behind one word teaches
 * nobody where anything is.
 *
 * Grouping by the question being asked instead: what needs doing (Queue), what is
 * scheduled (Tasks), who the work is for (Clients), what is owed (Billing), what was
 * produced (Documents), how it went (Reports), and how it behaves (Settings). Every
 * destination sits under the question it answers, and the group's members appear as a
 * second row once you are inside it.
 *
 * No route moved. Each of these URLs is exactly where it was.
 */
const GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: "Queue", items: [{ href: "/queue", label: "Queue" }] },
  { label: "Tasks", items: [
    { href: "/tasks", label: "Tasks" },
    { href: "/scheduling", label: "Scheduling" },
  ] },
  { label: "Clients", items: [
    { href: "/leads", label: "Leads" },
    { href: "/retainers", label: "Retainers" },
    { href: "/scope", label: "Scope of work" },
    { href: "/reviews", label: "Reviews & referrals" },
  ] },
  { label: "Billing", items: [
    { href: "/billing", label: "Billing" },
    { href: "/risk", label: "Payment Risk" },
  ] },
  { label: "Documents", items: [{ href: "/documents", label: "Documents" }] },
  { label: "Reports", items: [
    { href: "/reports", label: "Reports" },
    { href: "/roi", label: "ROI" },
  ] },
  { label: "Settings", items: [{ href: "/settings", label: "Settings" }] },
];

/** A nested route belongs to its parent: reviewing a draft at /queue/<id> is still Queue. */
function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Pure so it can be tested without a DOM. A group is current when any destination inside
 * it is, which is what lets the tab stay lit while the second row says which one.
 */
export function navGroups(pathname: string): NavGroup[] {
  return GROUPS.map((group) => {
    const items = group.items.map((item) => ({ ...item, isCurrent: matches(pathname, item.href) }));
    return {
      label: group.label,
      href: group.items[0].href,
      items,
      isCurrent: items.some((item) => item.isCurrent),
    };
  });
}

/** Every destination, flattened, in tab order. */
export function navItems(pathname: string): NavItem[] {
  return navGroups(pathname).flatMap((group) => group.items);
}

/**
 * Ingest is a primary action, not a destination, so it sits apart from the links and
 * is styled as a button. Leaving it out entirely was the other option, but then an owner
 * standing on /tasks or /dashboard has no way to add a conversation without going back to
 * the queue first — and adding a conversation is the one thing the product exists to start.
 */
export function AppNav({ email }: { email: string | null }) {
  const pathname = usePathname() ?? "";
  const groups = navGroups(pathname);
  // Only a group with somewhere else to go earns a second row; Queue, Documents and
  // Settings are one destination each and a sub-nav of one is just a repeated title.
  const openGroup = groups.find((group) => group.isCurrent && group.items.length > 1);

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
            {groups.map((group) => (
              <li key={group.label}>
                {/*
                  The skin lives in globals.css keyed off aria-current, so the pill an eye
                  sees and the state a screen reader hears cannot drift apart. Weight and
                  fill carry it as well as colour does, for a monochrome screen.
                */}
                <Link href={group.href} className="cf-nav-link"
                  aria-current={group.isCurrent ? "page" : undefined}>
                  {group.label}
                </Link>
              </li>
            ))}
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

      {/*
        The group's own destinations. This is where the thirteen went: not into a menu that
        hides them behind one word, but onto a row that only appears where it is relevant
        and names the section you are standing in. aria-label repeats the group name so a
        screen reader reaching this list is told what it is a list of.
      */}
      {openGroup && (
        <div className="cf-subnav">
          <ul aria-label={openGroup.label} style={{ maxWidth: "var(--shell)", margin: "0 auto",
            padding: "0 var(--gutter)", display: "flex", listStyle: "none", gap: 1,
            flexWrap: "wrap", minHeight: 40, alignItems: "center" }}>
            {openGroup.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="cf-subnav-link"
                  aria-current={item.isCurrent ? "page" : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
