"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanGmailNow } from "@/app/actions/gmail-watch";
import { Card, buttonStyle } from "@/components/ui/primitives";

function summarize(result: Awaited<ReturnType<typeof scanGmailNow>>): string {
  if (result.connectionsScanned === 0) {
    return "Gmail isn't connected for watching yet — turn it on in Settings.";
  }
  if (result.ingested === 0 && result.skippedUnmatchedSender === 0) {
    return "Checked your inbox — nothing new since the last scan.";
  }
  const parts: string[] = [];
  if (result.ingested > 0) {
    parts.push(`pulled ${result.ingested} conversation${result.ingested === 1 ? "" : "s"} into the queue`);
  }
  if (result.skippedUnmatchedSender > 0) {
    parts.push(`skipped ${result.skippedUnmatchedSender} from senders you don't have as clients yet`);
  }
  return `Scanned your inbox — ${parts.join(", ")}.`;
}

/**
 * The manual half of the Gmail watcher: /api/cron/gmail-scan runs this once a day for
 * every org automatically, but the demo moment is clicking this and watching the queue
 * below fill in from real mail, not waiting for tomorrow's cron.
 */
export function GmailScanButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function scan() {
    setError(null); setNote(null);
    startTransition(async () => {
      try {
        const result = await scanGmailNow();
        setNote(summarize(result));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work.");
      }
    });
  }

  return (
    <Card style={{ marginBottom: "var(--space-4)", display: "flex", alignItems: "center",
      gap: "var(--space-4)", flexWrap: "wrap" }}>
      <button type="button" disabled={isPending} onClick={scan} style={buttonStyle("secondary", isPending)}>
        {isPending ? "Scanning Gmail…" : "Scan Gmail for new commitments"}
      </button>
      <p style={{ color: error ? "var(--danger-text)" : "var(--muted)", fontSize: "var(--text-sm)",
        margin: 0 }}>
        {error ?? note ?? "Reads mail from your known clients since the last scan. Runs automatically once a day too."}
      </p>
    </Card>
  );
}
