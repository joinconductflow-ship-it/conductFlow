"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanSlackNow } from "@/app/actions/slack-watch";
import { Card, buttonStyle } from "@/components/ui/primitives";

export function SlackScanButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function scan() {
    setError(null); setNote(null);
    startTransition(async () => {
      try {
        const result = await scanSlackNow();
        setNote(result.ingested
          ? `Pulled ${result.ingested} Slack conversation${result.ingested === 1 ? "" : "s"} into the queue.`
          : result.channelsScanned ? "Checked mapped Slack channels — no new conversations."
          : "No Slack channels were scanned. Check your mappings in Settings.");
        if (result.errors) setError(`${result.errors} Slack scan${result.errors === 1 ? "" : "s"} failed. Please retry.`);
        router.refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to scan Slack."); }
    });
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)", display: "flex", alignItems: "center",
      gap: "var(--space-4)", flexWrap: "wrap" }}>
      <button type="button" disabled={pending} aria-busy={pending} onClick={scan} style={buttonStyle("secondary", pending)}>
        {pending ? "Scanning Slack…" : "Scan Slack for new commitments"}
      </button>
      <p role={error ? "alert" : "status"} style={{ color: error ? "var(--danger-text)" : "var(--muted)",
        fontSize: "var(--text-sm)", margin: 0 }}>
        {error ? `${note ?? ""} ${error}` : note ?? "Reads new messages from channels mapped to your clients."}
      </p>
    </Card>
  );
}
