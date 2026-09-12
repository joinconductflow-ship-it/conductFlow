"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateDraft } from "@/app/actions/drafts";
import { buttonStyle } from "@/components/ui/primitives";

export function GenerateDraftButton({ commitmentId, hasDraft }:
  { commitmentId: string; hasDraft: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const idle = hasDraft ? "Rewrite draft" : "Write the draft";

  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
        flexWrap: "wrap" }}>
        <button
          disabled={isPending}
          aria-busy={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const result = await regenerateDraft(commitmentId);
                if (result.ok) router.refresh();
                else setError(result.message ?? "The draft could not be written. Try again.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Drafting failed.");
              }
            });
          }}
          // Fixed width: the label swaps while it runs, and the row must not jump.
          style={{ ...buttonStyle("secondary", isPending), minWidth: 132,
            justifyContent: "center" }}>
          {isPending ? "Writing…" : idle}
        </button>
        {/* A rewrite discards the current text, so say so before it is clicked, not after. */}
        <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
          {hasDraft
            ? "Replaces the text above. Still never sends."
            : "Nothing is sent — this only fills the draft."}
        </span>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-2)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
