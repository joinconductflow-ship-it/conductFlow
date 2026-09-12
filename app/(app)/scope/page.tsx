import Link from "next/link";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery, readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { ScopeOfWork, type ScopeOfWorkProps } from "@/components/scope/ScopeOfWork";
import { MAX_SCOPE_SUMMARY_CHARS } from "@/lib/agent/schema";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ScopeOfWorkPage() {
  const orgId = await getCurrentOrgId("/scope");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Scope of work" />
      <EmptyState
        title="Sign in to manage scope of work"
        body="Describe the agreed work for each client as the baseline for scope reviews."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  // This second auth read only controls editor affordances. Failed reads deny editing.
  const auth = await readPageData("/scope: editor auth", () => getCurrentUser("/scope", db));
  const [clients, scopes, membership] = await Promise.all([
    readPageQuery("/scope: client_contact", () => db.from("client_contact").select("id,name").eq("org_id", orgId).order("name")),
    readPageQuery("/scope: scope_of_work", () => db.from("scope_of_work").select("client_id,summary").eq("org_id", orgId).order("client_id")),
    auth.data ? readPageQuery("/scope: membership role", () => db.from("membership").select("role")
      .eq("org_id", orgId).eq("user_id", auth.data!.id).maybeSingle()) : { data: null, unavailable: true },
  ]);

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Scope of work" lede="Describe the agreed work for each client as the baseline for scope reviews." />
        {membership.unavailable && <Unavailable section="Editing permissions are" />}
        {clients.unavailable || scopes.unavailable ? <Unavailable section="Scope of work is" /> : <ScopeOfWork
          clients={(clients.data ?? []) as ScopeOfWorkProps["clients"]}
          scopes={(scopes.data ?? []) as ScopeOfWorkProps["scopes"]}
          canEdit={membership.data?.role === "owner"} maxSummaryChars={MAX_SCOPE_SUMMARY_CHARS}
        />}
      </div>
    </main>
  );
}
