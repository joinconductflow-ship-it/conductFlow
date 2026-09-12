import Link from "next/link";
import { getCurrentOrgId, getCurrentUser } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery, readPageData } from "@/lib/db/page-read";
import { Unavailable } from "@/components/ui/Unavailable";
import { loadBlueprint } from "@/lib/agent/blueprint-store";
import { EDITABLE_ACTIONS } from "@/lib/agent/blueprint";
import { BlueprintEditor } from "@/components/settings/BlueprintEditor";
import {
  PageHeader, Badge, BackLink, EmptyState, buttonStyle, pageStyle,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function BlueprintPage() {
  const orgId = await getCurrentOrgId("/settings/blueprint");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Agent blueprint" />
      <EmptyState
        title="Sign in to read the blueprint"
        body="It sets out exactly what the assistant may do on your behalf, and what it can never do."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [blueprintResult, auth] = await Promise.all([
    readPageData("/settings/blueprint: agent_blueprint latest", () => loadBlueprint(db, orgId)),
    readPageData("/settings/blueprint: editor auth", () => getCurrentUser("/settings/blueprint", db)),
  ]);
  const membership = auth.data ? await readPageQuery("/settings/blueprint: membership role", () => db.from("membership")
    .select("role").eq("org_id", orgId).eq("user_id", auth.data!.id).maybeSingle())
    : { data: null, unavailable: true };
  const blueprint = blueprintResult.data;

  return (
    <main style={{ ...pageStyle, maxWidth: 820 }}>
      <BackLink href="/settings">Settings</BackLink>

      <PageHeader
        title="Agent blueprint"
        lede="Exactly what the assistant is allowed to do on your behalf. Every change is saved as a new version, so what it was permitted to do on any given day stays answerable."
        actions={
          blueprint && <Badge tone={blueprint.version === 0 ? "neutral" : "accent"}>
            {blueprint.version === 0 ? "shipped defaults" : `version ${blueprint.version}`}
          </Badge>
        }
      />

      {membership.unavailable && <Unavailable section="Editing permissions are" />}
      {!blueprint ? <Unavailable section="The agent blueprint is" /> : <BlueprintEditor view={{
        version: blueprint.version,
        permitted: blueprint.permitted_actions,
        gated: blueprint.required_approvals,
        successMetric: blueprint.success_metric,
        expiresInMinutes: blueprint.expires_in_minutes,
        editable: EDITABLE_ACTIONS,
        canEdit: membership.data?.role === "owner",
      }} />}
    </main>
  );
}
