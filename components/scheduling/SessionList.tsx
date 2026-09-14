"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { createScheduledSession, markScheduledSession, pushSchedulingDraft } from "@/app/actions/scheduling";
import type { ScheduledSession } from "@/lib/scheduling/no-show";
import { presentError } from "@/lib/errors/presentation";
import {
  Card, CardTitle, Badge, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle,
} from "@/components/ui/primitives";

export interface SessionListProps {
  unavailable?: Partial<Record<"clients" | "sessions" | "drafts", boolean>>;
  clients: { id: string; name: string }[];
  sessions: ScheduledSession[];
  drafts: { id: string; source_id: string; client_id: string; subject: string | null; body: string }[];
  nowIso: string;
}

export function SessionList({ clients, sessions, drafts, nowIso, unavailable = {} }: SessionListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(Date.parse(nowIso));

  // Keep attendance controls available as sessions start, without changing hydration markup.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setNote(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update scheduling right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {note && <p role="status" style={{ color: "var(--muted)" }}>{note}</p>}
      {unavailable.clients ? <Unavailable section="Clients are" /> : clients.length === 0 ? (
        <EmptyState title="No clients yet" body="Add a client when adding a transcript, then schedule their session here." />
      ) : (
        <Card>
          <CardTitle>Schedule a session</CardTitle>
          <form onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            run("create", async () => {
              // datetime-local has no offset; resolve it in the browser's timezone.
              const startsAt = new Date(String(data.get("startsAt")));
              if (!Number.isFinite(startsAt.getTime())) throw new Error("Choose a valid start time.");
              data.set("startsAt", startsAt.toISOString());
              await createScheduledSession(data); form.reset(); setNote("Session scheduled.");
            });
          }}>
            <label style={labelStyle}>Client
              <select name="clientId" required defaultValue="" disabled={isPending} style={fieldStyle}>
                <option value="" disabled>Choose a client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Start time (your local time)
              <input name="startsAt" type="datetime-local" required disabled={isPending} style={fieldStyle} />
            </label>
            <button disabled={isPending} aria-busy={isPending && busyKey === "create"}
              style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
              {isPending && busyKey === "create" ? "Scheduling…" : "Schedule session"}
            </button>
          </form>
        </Card>
      )}
      {unavailable.sessions ? <Unavailable section="Sessions are" /> : sessions.length === 0 && <EmptyState title="No sessions yet" body="Schedule a session above to track attendance and rescheduling offers." />}
      {sessions.map((session) => (
        <Card key={session.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <CardTitle>{clients.find((client) => client.id === session.client_id)?.name ?? "Unknown client"}</CardTitle>
            <Badge tone={session.status === "completed" ? "ok" : session.status === "no_show" ? "warn" : "neutral"}>
              {session.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="mono" style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
            <time dateTime={session.starts_at}>{new Date(session.starts_at).toISOString().slice(0, 16).replace("T", " ")} UTC</time>
          </p>
          {session.status === "scheduled" && Date.parse(session.starts_at) <= Math.max(now, Date.parse(nowIso)) && (
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
              {([ ["completed", "Mark completed"], ["no_show", "Mark no-show"], ["cancelled", "Mark cancelled"] ] as const).map(([status, label]) => (
                <button key={status} disabled={isPending} aria-busy={isPending && busyKey === `${session.id}:${status}`}
                  onClick={() => run(`${session.id}:${status}`, async () => {
                    const result = await markScheduledSession(session.id, status);
                    setNote(`Session marked ${result.status.replaceAll("_", " ")}.${result.rescheduleDrafted ? " Reschedule draft ready below." : ""}`);
                  })} style={buttonStyle("secondary", isPending)}>
                  {isPending && busyKey === `${session.id}:${status}` ? "Saving…" : label}
                </button>
              ))}
            </div>
          )}
        </Card>
      ))}
      {unavailable.drafts && <Unavailable section="Rescheduling drafts are" />}
      {drafts.map((draft) => {
        const session = sessions.find((row) => row.id === draft.source_id);
        const awaitingReschedule = session?.status === "scheduled" || session?.status === "no_show";
        return (
          <Card key={draft.id}>
            <CardTitle>{draft.subject ?? "Reschedule offer"}</CardTitle>
            <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
              {clients.find((client) => client.id === draft.client_id)?.name ?? "Unknown client"} · Pending draft
            </p>
            <p style={{ ...proseStyle, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: "var(--space-3)" }}>{draft.body}</p>
            {awaitingReschedule ? (
              <button disabled={isPending} aria-busy={isPending && busyKey === draft.id}
                onClick={() => run(draft.id, async () => {
                  const result = await pushSchedulingDraft(draft.id);
                  if (!result.pushed) throw new Error(result.reason);
                  setNote("Draft pushed to Gmail.");
                })} style={{ ...buttonStyle("secondary", isPending), marginTop: "var(--space-4)" }}>
                {isPending && busyKey === draft.id ? "Pushing…" : "Push to Gmail"}
              </button>
            ) : <p style={{ color: "var(--faint)", marginTop: "var(--space-3)" }}>This session is no longer awaiting rescheduling.</p>}
          </Card>
        );
      })}
    </div>
  );
}
