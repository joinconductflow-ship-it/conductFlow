import Link from "next/link";
import { getCurrentOrgId } from "@/lib/db/queries";
import { getServerClient } from "@/lib/db/server";
import { readPageQuery } from "@/lib/db/page-read";
import { DocumentChecklist, type DocumentChecklistProps } from "@/components/documents/DocumentChecklist";
import { PageHeader, EmptyState, buttonStyle, pageStyle, columnStyle } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function DocumentChecklistPage() {
  const orgId = await getCurrentOrgId("/documents");
  if (!orgId) return (
    <main style={pageStyle}>
      <PageHeader title="Documents" />
      <EmptyState
        title="Sign in to manage documents"
        body="Track required documents for each client and review reminder drafts."
        action={<Link href="/onboarding" className="cf-btn"
          style={buttonStyle("primary")}>Sign in</Link>}
      />
    </main>);

  const db = await getServerClient();
  const [clients, requirements, documents, drafts] = await Promise.all([
    readPageQuery("/documents: client_contact", () => db.from("client_contact").select("id,name").eq("org_id", orgId).order("name")),
    readPageQuery("/documents: document_requirement", () => db.from("document_requirement").select("id,name,description").eq("org_id", orgId).order("created_at")),
    readPageQuery("/documents: client_document", () => db.from("client_document").select("id,client_id,requirement_id,status").eq("org_id", orgId).order("id")),
    readPageQuery("/documents: client_message_draft document_reminder", () => db.from("client_message_draft").select("id,client_id,subject,body")
      .eq("org_id", orgId).eq("kind", "document_reminder").is("provider_draft_id", null).order("created_at")),
  ]);

  return (
    <main style={pageStyle}>
      <div style={columnStyle}>
        <PageHeader title="Documents" lede="Track required documents for each client and review reminder drafts." />
        <DocumentChecklist
          unavailable={{ clients: clients.unavailable, requirements: requirements.unavailable,
            documents: documents.unavailable, drafts: drafts.unavailable }}
          clients={(clients.data ?? []) as DocumentChecklistProps["clients"]}
          requirements={(requirements.data ?? []) as DocumentChecklistProps["requirements"]}
          documents={(documents.data ?? []) as DocumentChecklistProps["documents"]}
          drafts={(drafts.data ?? []) as DocumentChecklistProps["drafts"]}
        />
      </div>
    </main>
  );
}
