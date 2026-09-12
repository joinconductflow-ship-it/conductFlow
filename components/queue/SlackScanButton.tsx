"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanSlackNow } from "@/app/actions/slack-watch";
import { buttonStyle } from "@/components/ui/primitives";

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
    <div className="queue-sync-control">
      <button type="button" disabled={pending} aria-busy={pending} onClick={scan}
        style={buttonStyle("secondary", pending)}>
        {pending ? "Syncing Slack…" : "Slack · Sync now"}
      </button>
      <p role={error ? "alert" : "status"} className="queue-sync-status"
        style={{ color: error ? "var(--danger-text)" : "var(--muted)" }}>
        {error ? `${note ?? ""} ${error}` : note ?? "Mapped client channels"}
      </p>
    </div>
  );
}
