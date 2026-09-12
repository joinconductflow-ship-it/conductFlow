"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanGmailNow } from "@/app/actions/gmail-watch";
import { buttonStyle } from "@/components/ui/primitives";

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
    <div className="queue-sync-control">
      <button type="button" className="queue-sync-button" disabled={isPending} aria-busy={isPending} onClick={scan}
        style={{ ...buttonStyle("secondary", isPending), minWidth: 148 }}>
        <Image src="/integrations/gmail.webp" alt="" width={20} height={20} className="queue-sync-mark" />
        <span>Gmail</span>
        <span className="queue-sync-action">{isPending ? "Syncing…" : "Sync"}</span>
      </button>
      <p role={error ? "alert" : "status"} className="queue-sync-status"
        style={{ color: error ? "var(--danger-text)" : "var(--muted)" }}>
        {error ?? note ?? "Known-client mail"}
      </p>
    </div>
  );
}
