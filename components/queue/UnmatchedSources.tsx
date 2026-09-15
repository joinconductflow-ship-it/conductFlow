"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClientAndLink, ignoreUnmatchedSource, linkUnmatchedSource, searchUnmatchedClients } from "@/app/actions/unmatched";
import { presentError } from "@/lib/errors/presentation";
import type { ClientContact } from "@/lib/db/queries";
import { Badge, buttonStyle, Card, CardTitle, EmptyState } from "@/components/ui/primitives";

export interface UnmatchedSourceItem {
  id: string;
  provider: "google" | "slack";
  source_type: "email" | "channel";
  source_key: string;
  source_name: string;
  source_label: string | null;
  occurrence_count: number;
  last_seen_at: string;
}

interface Props {
  sources: UnmatchedSourceItem[];
  total?: number | null;
}

function providerLabel(provider: UnmatchedSourceItem["provider"]): string {
  return provider === "google" ? "Gmail" : "Slack";
}

function ClientPicker({
  sourceId, sourceName, selected, disabled, onSelect,
}: {
  sourceId: string;
  sourceName: string;
  selected: ClientContact | null;
  disabled: boolean;
  onSelect: (client: ClientContact | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ClientContact[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const normalized = query.trim();
      if (normalized.length < 2) {
        setMatches([]);
        return;
      }
      startSearch(async () => {
        try {
          const result = await searchUnmatchedClients(normalized);
          if (active) setMatches(result);
        } catch {
          // The review action still offers Create client when search is unavailable.
          if (active) setMatches([]);
        }
      });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  if (selected) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 30 }}>
        <span style={{ color: "var(--muted)" }}>Selected: <strong style={{ color: "var(--text)" }}>{selected.name}</strong></span>
        <button type="button" disabled={disabled} style={buttonStyle("ghost", disabled)} onClick={() => { onSelect(null); setQuery(""); setMatches([]); }}>
          Change
        </button>
      </div>
    );
  }

  const listId = `client-search-${sourceId}`;
  return (
    <div style={{ position: "relative", minWidth: 260, flex: "1 1 260px" }}>
      <input
        aria-label={`Search existing clients for ${sourceName}`}
        aria-controls={listId}
        aria-expanded={open && query.trim().length >= 2}
        role="combobox"
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        placeholder="Name or email starts with…"
        style={{ width: "100%", minHeight: 30, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface)", color: "var(--text)", padding: "0 8px" }}
      />
      {open && query.trim().length >= 2 && (
        <div id={listId} role="listbox" style={{ position: "absolute", zIndex: 2, left: 0, right: 0, top: "calc(100% + 4px)", maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--raised)", boxShadow: "var(--shadow-sm)", padding: "var(--space-1)" }}>
          {searching ? <p style={{ padding: "var(--space-2)", color: "var(--muted)" }}>Searching…</p>
            : matches.length ? matches.map((client) => (
              <button key={client.id} type="button" role="option" aria-selected={false}
                style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text)", padding: "var(--space-2)", cursor: "pointer" }}
                onClick={() => { onSelect(client); setOpen(false); }}>
                <span>{client.name}</span>
                {client.email && <span style={{ display: "block", color: "var(--faint)", fontSize: "var(--text-sm)", marginTop: 2 }}>{client.email}</span>}
              </button>
            ))
            : <p style={{ padding: "var(--space-2)", color: "var(--muted)" }}>No matching clients. Create one below.</p>}
        </div>
      )}
    </div>
  );
}

export function UnmatchedSources({ sources, total = null }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedClients, setSelectedClients] = useState<Record<string, ClientContact | null>>({});
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Record<string, string>>({});

  function run(sourceId: string, action: () => Promise<void>, success: string) {
    setMessage((current) => ({ ...current, [sourceId]: "" }));
    startTransition(async () => {
      try {
        await action();
        setMessage((current) => ({ ...current, [sourceId]: success }));
        router.refresh();
      } catch (cause) {
        setMessage((current) => ({ ...current, [sourceId]: presentError(cause, {
          fallback: "Couldn't update this source. Try again.",
          authentication: "Please sign in again to manage the review queue.",
          provider: "The integration is unavailable right now. Try again.",
        }) }));
      }
    });
  }

  return (
    <Card tone={sources.length ? "warn" : "neutral"}>
      <CardTitle tone={sources.length ? "warn" : "neutral"} dot>
        Unmatched sources {total !== null && total > 0 && <Badge tone="warn">{total} waiting</Badge>}
      </CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
        New senders and Slack channels wait here until you link them to a client. Nothing from
        an unmatched source enters the commitment queue.
        {total !== null && total > sources.length && ` Showing ${sources.length} of ${total}; resolve these to see more.`}
      </p>

      {!sources.length ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <EmptyState title="Nothing waiting" body="Automatic scans will place new senders and channels here for review." />
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          {sources.map((source) => {
            const selected = selectedClients[source.id] ?? null;
            const newName = newNames[source.id] ?? "";
            const status = message[source.id];
            return (
              <article key={source.id} style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
                  <div>
                    <strong>{source.source_name}</strong>
                    {source.source_type === "email" && source.source_key !== source.source_name && (
                      <p className="mono" style={{ color: "var(--faint)", marginTop: 3 }}>{source.source_key}</p>
                    )}
                    {source.source_label && <p style={{ color: "var(--muted)", marginTop: 3 }}>{source.source_label}</p>}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <Badge>{providerLabel(source.provider)}</Badge>
                    <Badge tone="warn">{source.occurrence_count} seen</Badge>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-3)" }}>
                  <ClientPicker sourceId={source.id} sourceName={source.source_name} selected={selected} disabled={pending}
                    onSelect={(client) => setSelectedClients((current) => ({ ...current, [source.id]: client }))} />
                  <button type="button" className="cf-btn" disabled={pending || !selected} style={buttonStyle("secondary", pending || !selected)}
                    onClick={() => selected && run(source.id, () => linkUnmatchedSource(source.id, selected.id), "Linked to client.")}>Link to client</button>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
                  <input
                    aria-label={`New client name for ${source.source_name}`}
                    value={newName}
                    onChange={(event) => setNewNames((current) => ({ ...current, [source.id]: event.target.value }))}
                    placeholder="New client name"
                    maxLength={160}
                    style={{ minHeight: 30, minWidth: 210, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface)", color: "var(--text)", padding: "0 8px" }}
                  />
                  <button type="button" className="cf-btn" disabled={pending || !newName.trim()} style={buttonStyle("secondary", pending || !newName.trim())}
                    onClick={() => run(source.id, () => createClientAndLink(source.id, newName), "Client created and linked.")}>Create client</button>
                  <button type="button" className="cf-btn" disabled={pending} style={buttonStyle("ghost", pending)}
                    onClick={() => run(source.id, () => ignoreUnmatchedSource(source.id), "Ignored.")}>Ignore</button>
                </div>
                {status && <p role="status" style={{ color: "var(--muted)", marginTop: "var(--space-2)", fontSize: "var(--text-sm)" }}>{status}</p>}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
