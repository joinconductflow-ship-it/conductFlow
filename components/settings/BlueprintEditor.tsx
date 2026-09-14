"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBlueprint } from "@/app/actions/blueprint";
import { HARD_PROHIBITED, ALWAYS_NEEDS_APPROVAL } from "@/lib/agent/blueprint";
import {
  Card, CardTitle, Badge, SectionHeading, buttonStyle, fieldStyle,
} from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

const DESCRIPTIONS: Record<string, string> = {
  draft_recap: "Write a recap of what was said",
  draft_task_list: "Turn a conversation into a list of promises",
  draft_follow_up: "Write the follow-up message",
  create_internal_task: "Put a task on your board",
  propose_recurring_task: "Suggest a promise you make on a regular cadence",
  push_email_draft: "Place a draft in your Gmail drafts folder",
  edit_crm: "Update a client record",
};

/** Plain English for limits enforced in code. Same wording as the landing page. */
const NEVER: Record<string, string> = {
  send_external_email: "Send an email to anyone",
  change_scope: "Change what was agreed",
  change_pricing: "Change a price",
  sign_contract: "Sign anything",
  take_payment: "Take a payment",
  delete_record: "Delete a record",
};

type Setting = "off" | "approval" | "unattended";

const CHOICES: { value: Setting; label: string; hint: string }[] = [
  { value: "off", label: "Never", hint: "The assistant will not do this at all." },
  { value: "approval", label: "Ask me first", hint: "It prepares it; nothing happens until you approve." },
  { value: "unattended", label: "On its own", hint: "It does this without stopping to ask." },
];

export interface BlueprintView {
  version: number;
  permitted: string[];
  gated: string[];
  successMetric: string;
  expiresInMinutes: number;
  editable: readonly string[];
  canEdit: boolean;
}

export function BlueprintEditor({ view }: { view: BlueprintView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const [settings, setSettings] = useState<Record<string, Setting>>(() => {
    const initial: Record<string, Setting> = {};
    for (const action of view.editable) {
      initial[action] = view.permitted.includes(action) ? "unattended"
        : view.gated.includes(action) ? "approval" : "off";
    }
    return initial;
  });

  // Live counts: an owner should be able to see the shape of their blueprint without
  // reading every row, and see it change as they edit.
  const unattended = Object.values(settings).filter((s) => s === "unattended").length;
  const asks = Object.values(settings).filter((s) => s === "approval").length;
  const off = Object.values(settings).filter((s) => s === "off").length;

  return (
    <form
      action={(fd) => {
        setError(null); setSaved(null);
        startTransition(async () => {
          try {
            await updateBlueprint(fd);
            setSaved(view.version + 1);
            router.refresh();
          } catch (e) {
            setError(presentError(e, { fallback: "That change was refused. Try again." }));
          }
        });
      }}
    >
      <div className="mono" style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap",
        color: "var(--faint)", fontSize: "var(--text-xs)", marginBottom: "var(--space-4)" }}>
        <span>{unattended} on its own</span>
        <span>{asks} ask first</span>
        <span>{off} never</span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0,
        display: "grid", gap: "var(--space-2)" }}>
        {view.editable.map((action) => {
          const locked = (ALWAYS_NEEDS_APPROVAL as readonly string[]).includes(action);
          const current = settings[action];
          return (
            <li key={action}>
              <div style={{
                border: "1px solid var(--border)", borderRadius: "var(--radius)",
                background: "var(--surface)", padding: "var(--space-3) var(--space-4)",
                minWidth: 0,
                // The rule reads the row's answer before any text does.
                borderLeft: `2px solid ${current === "unattended" ? "var(--accent)"
                  : current === "approval" ? "var(--border-strong)" : "transparent"}`,
                transition: "border-color var(--motion)",
              }}>
                <div style={{ display: "grid", gap: "var(--space-3)",
                  gridTemplateColumns: "minmax(200px, 1fr) auto", alignItems: "center" }}>
                  <div id={`bp-${action}`}>
                    <span style={{ display: "block" }}>{DESCRIPTIONS[action] ?? action}</span>
                    <span className="mono" style={{ display: "block", color: "var(--faint)",
                      fontSize: "var(--text-xs)", marginTop: 2 }}>
                      {action}
                    </span>
                  </div>

                  <div role="radiogroup" aria-labelledby={`bp-${action}`}
                    style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap",
                      justifyContent: "flex-end" }}>
                    {CHOICES.map((choice) => {
                      const disabled = choice.value === "unattended" && locked;
                      return (
                        <label key={choice.value}
                          title={disabled
                            ? "Not available: this reaches someone outside your team"
                            : choice.hint}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "var(--space-2)",
                            fontSize: "var(--text-sm)",
                            color: disabled ? "var(--faint)"
                              : current === choice.value ? "var(--text)" : "var(--muted)",
                            cursor: disabled || !view.canEdit ? "not-allowed" : "pointer",
                          }}>
                          <input
                            type="radio"
                            name={`action:${action}`}
                            value={choice.value}
                            checked={current === choice.value}
                            disabled={disabled || !view.canEdit || isPending}
                            onChange={() => setSettings((s) => ({ ...s, [action]: choice.value }))}
                            // Native control keeps arrow-key navigation and its own focus ring.
                            style={{ accentColor: "var(--accent)", margin: 0 }}
                          />
                          {choice.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {locked && (
                  <p style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
                    marginTop: "var(--space-2)" }}>
                    Reaches someone outside your team, so &ldquo;on its own&rdquo; is not offered.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/*
        The reassurance the product is sold on, given the weight of a section rather than a
        footnote: named in plain English, with the machine name underneath, and stated as
        something no setting reaches.
      */}
      <section style={{ marginTop: "var(--space-7)", border: "1px solid var(--border-strong)",
        borderLeft: "2px solid var(--danger)", borderRadius: "var(--radius)",
        background: "var(--raised)", padding: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: "var(--space-3)", flexWrap: "wrap" }}>
          <CardTitle>Never, under any setting</CardTitle>
          <Badge tone="danger">enforced in code</Badge>
        </div>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)", maxWidth: "62ch" }}>
          These are not switches that happen to be off. There is no setting on this page, and
          no edit to the database, that turns them on.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-4) 0 0",
          display: "grid", gap: "var(--space-2)",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {HARD_PROHIBITED.map((action) => (
            <li key={action} style={{ display: "flex", alignItems: "baseline",
              gap: "var(--space-3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "var(--space-3)",
              background: "var(--canvas)" }}>
              <span aria-hidden className="mono" style={{ color: "var(--danger-text)",
                fontSize: "var(--text-sm)", lineHeight: 1.5 }}>✕</span>
              <span>
                {NEVER[action] ?? action}
                <span className="mono" style={{ display: "block", color: "var(--faint)",
                  fontSize: "var(--text-xs)", marginTop: 2 }}>{action}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "var(--space-7)" }}>
        <SectionHeading>Operating limits</SectionHeading>
        <Card>
          <div style={{ display: "grid", gap: "var(--space-4)",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
              What counts as success
              <input name="successMetric" defaultValue={view.successMetric}
                disabled={!view.canEdit || isPending} style={fieldStyle} />
              <span style={{ display: "block", color: "var(--faint)",
                fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
                The outcome the assistant is measured against.
              </span>
            </label>
            <label style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
              Unattended permission expires after
              <input name="expiresInMinutes" type="number" min={1} max={1440}
                defaultValue={view.expiresInMinutes} disabled={!view.canEdit || isPending}
                className="mono" style={fieldStyle} />
              <span style={{ display: "block", color: "var(--faint)",
                fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }}>
                Minutes from saving this version until actions set to &ldquo;on its own&rdquo;
                need approval. Save a new version to renew. 1–1440. Shipped defaults do not expire.
              </span>
            </label>
          </div>
        </Card>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)",
        flexWrap: "wrap", marginTop: "var(--space-5)" }}>
        {view.canEdit ? (
          <>
            <button type="submit" disabled={isPending} aria-busy={isPending}
              // Reserved width: the label changes while saving and must not resize.
              style={{ ...buttonStyle("primary", isPending), minWidth: 148 }}>
              {isPending ? "Saving…" : "Save blueprint"}
            </button>
            <span style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Saved as a new version. The previous one stays on the record.
            </span>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>
            Only an owner can change these. You can read every setting here.
          </p>
        )}
      </div>

      {saved !== null && (
        <p style={{ color: "var(--ok)", marginTop: "var(--space-3)" }}>
          Saved as version {saved}.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--danger-text)", marginTop: "var(--space-3)" }}>
          That change was refused.{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>{error}</span>
        </p>
      )}
    </form>
  );
}
