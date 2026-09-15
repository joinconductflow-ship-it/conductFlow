"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanGmailNow } from "@/app/actions/gmail-watch";
import { buttonStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

function summarize(result: Awaited<ReturnType<typeof scanGmailNow>>): string {
  if (result.reconnectRequired) {
    return "Gmail needs to be reconnected before ConductFlow can scan mail. Reconnect Google in Settings.";
  }
  if (result.connectionsScanned === 0) {
    return "No Gmail batch available. A scan may already be running; check the connection in Settings.";
  }
  if (result.errors) return "Gmail scan paused after an error. Pending messages were retained; retry the next batch.";
  if (result.ingested === 0 && result.skippedUnmatchedSender === 0) {
    return "Gmail batch checked. Listing and backlog processing may need another batch.";
  }
  const parts: string[] = [];
  if (result.ingested > 0) {
    parts.push(`pulled ${result.ingested} conversation${result.ingested === 1 ? "" : "s"} into the queue`);
  }
  if (result.unmatchedSourcesRecorded > 0) {
    parts.push(`opened ${result.unmatchedSourcesRecorded} new unmatched source${result.unmatchedSourcesRecorded === 1 ? "" : "s"} for review`);
  }
  return parts.length ? `Processed a Gmail batch — ${parts.join(", ")}.` : "Processed a Gmail batch; existing unmatched sources remain unchanged.";
}

/**
 * The manual half of the Gmail watcher: /api/cron/gmail-scan runs this once a day as a bounded batch automatically, but the demo moment is clicking this and watching the queue
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
        setError(presentError(e, {
          fallback: "Couldn't scan Gmail right now. Try again.",
          authentication: "Please sign in again to scan Gmail.",
        }));
      }
    });
  }

  return (
    <div className="queue-sync-control">
      <button type="button" className="queue-sync-button" disabled={isPending} aria-busy={isPending} onClick={scan}
        style={{ ...buttonStyle("secondary", isPending), minWidth: 148 }}>
        <Image src="/integrations/gmail.webp" alt="" width={20} height={20} className="queue-sync-mark" />
        <span>Gmail</span>
        <span className="queue-sync-action">{isPending ? "Syncing…" : "Sync"}</span>
      </button>
      <p role={error ? "alert" : "status"} className="queue-sync-status"
        style={{ color: error ? "var(--danger-text)" : "var(--muted)" }}>
        {error ?? note ?? "Daily scheduled batches · known-client mail"}
      </p>
    </div>
  );
}
