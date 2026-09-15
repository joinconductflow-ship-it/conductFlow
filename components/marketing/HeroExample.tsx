"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Badge, buttonStyle, Card, StatusPill } from "@/components/ui/primitives";

const CLIENT_LINE = "Can you send over the revised proposal by Friday?";
const PROMISE =
  "Yep, I’ll send the final proposal Friday and put the updated scope in your client folder.";

type DemoStage = "idle" | "complete" | "typing" | "processing" | "commitment" | "actions";

/** A small, self-contained product story: source evidence becomes reviewable work. */
export default function HeroExample() {
  const [stage, setStage] = useState<DemoStage>("idle");
  const [typedChars, setTypedChars] = useState(PROMISE.length);
  const [approved, setApproved] = useState(false);
  const demoRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage("complete");
      setTypedChars(PROMISE.length);
      return;
    }

    const demo = demoRef.current;
    if (!demo) return;

    let cancelled = false;
    let started = false;
    let frame = 0;
    let processingTimer = 0;
    let actionsTimer = 0;
    let stopObserving = () => {};

    const startSequence = () => {
      if (started || cancelled) return;
      started = true;

      const startedAt = performance.now();
      setStage("typing");
      setTypedChars(0);

      const type = (now: number) => {
        if (cancelled) return;

        const progress = Math.min(1, (now - startedAt) / 1450);
        setTypedChars(Math.floor(progress * PROMISE.length));

        if (progress < 1) {
          frame = window.requestAnimationFrame(type);
          return;
        }

        setTypedChars(PROMISE.length);
        setStage("processing");
        processingTimer = window.setTimeout(() => {
          if (cancelled) return;
          setStage("commitment");
          actionsTimer = window.setTimeout(() => {
            if (!cancelled) setStage("actions");
          }, 700);
        }, 620);
      };

      frame = window.requestAnimationFrame(type);
    };

    const supportsIntersectionObserver = typeof window.IntersectionObserver === "function";
    if (supportsIntersectionObserver) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting && entry.intersectionRatio >= 0.4) {
            observer.disconnect();
            startSequence();
          }
        },
        { threshold: 0.4 },
      );
      observer.observe(demo);
      stopObserving = () => observer.disconnect();
    } else {
      const checkVisibility = () => {
        const rect = demo.getBoundingClientRect();
        const visible = Math.max(0, Math.min(window.innerHeight, rect.bottom)
          - Math.max(0, rect.top)) / rect.height;
        if (visible < 0.4) return;
        startSequence();
        window.removeEventListener("scroll", checkVisibility);
        window.removeEventListener("resize", checkVisibility);
      };
      window.addEventListener("scroll", checkVisibility, { passive: true });
      window.addEventListener("resize", checkVisibility);
      stopObserving = () => {
        window.removeEventListener("scroll", checkVisibility);
        window.removeEventListener("resize", checkVisibility);
      };
      checkVisibility();
    }

    return () => {
      cancelled = true;
      stopObserving();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(processingTimer);
      window.clearTimeout(actionsTimer);
    };
  }, []);

  const visiblePromise = PROMISE.slice(0, typedChars);
  const showHighlight = typedChars >= PROMISE.length && stage !== "typing";
  const approvalAvailable = stage === "actions" || stage === "complete";

  return (
    <figure
      ref={demoRef}
      className="marketing-demo"
      data-demo-stage={stage}
      style={{ minWidth: 0, width: "min(100%, 1040px)", margin: 0, textAlign: "left" }}
    >
      <figcaption className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)",
        letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
        Example · client-proposal.vtt · 00:18:42
      </figcaption>

      <div className="marketing-demo-transcript" style={{ borderLeft: "1px solid var(--border-strong)",
        paddingLeft: "var(--space-4)" }}>
        <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
          letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
          01 · TRANSCRIPT
        </div>
        <p style={{ lineHeight: 1.7 }}>
          <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>Client</span>{" "}
          “{CLIENT_LINE}”
        </p>
        <p style={{ lineHeight: 1.7, marginTop: "var(--space-2)" }}>
          <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-sm)" }}>You</span>{" "}
          <mark className={`marketing-demo-promise${showHighlight ? " is-highlighted" : ""}`}>
            “{visiblePromise}”
            {stage === "typing" && <span aria-hidden className="marketing-demo-caret" />}
          </mark>
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)",
        paddingLeft: "var(--space-4)", paddingBlock: "var(--space-3)" }}>
        <span aria-hidden style={{ width: 1, height: "var(--space-5)", background: "var(--border-strong)", flexShrink: 0 }} />
        <span className="mono" style={{ color: "var(--faint)", fontSize: "var(--text-xs)" }}>
          matched word for word
        </span>
      </div>

      <div className="marketing-demo-processing" aria-live="polite" aria-hidden={stage !== "processing"}>
        <span>ConductFlow is extracting commitments...</span>
        <span aria-hidden className="marketing-demo-processing-dot" />
      </div>

      <Card className="marketing-demo-commitment">
        <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
          letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "var(--space-3)" }}>
          02 · EXTRACTED COMMITMENT
        </div>
        <div className="marketing-demo-commitment-detail">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)",
            alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>
              Send revised proposal
            </span>
            <Badge tone="ok">high confidence</Badge>
          </div>
          <div className="mono" style={{ color: "var(--muted)", fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)" }}>
            owner: you · due Friday · evidence matched
          </div>
          <div className="marketing-demo-approval" style={{ marginTop: "var(--space-3)" }}>
            <StatusPill tone={approved ? "ok" : "warn"}
              label={approved ? "Approved" : "Waiting for approval"} />
          </div>
        </div>

        <div className="marketing-demo-actions">
          <div className="mono" style={{ color: "var(--accent-text)", fontSize: "var(--text-xs)",
            letterSpacing: "0.08em", textTransform: "uppercase" }}>
            03 · DETECTED ACTIONS
          </div>
          <div className="marketing-action-list">
            <div className={`marketing-action-item${approved ? " is-approved" : ""}`}>
              <div className="marketing-action-heading">
                <div className="marketing-action-provider">
                  <Image src="/integrations/gmail.webp" alt="" width={20} height={20}
                    unoptimized className="marketing-action-logo" />
                  <span>Gmail · Draft follow-up</span>
                </div>
                <Badge tone={approved ? "ok" : "neutral"}>{approved ? "Approved" : "Prepared"}</Badge>
              </div>
              <p>Send the client the revised proposal and confirm next steps.</p>
            </div>
            <div className={`marketing-action-item${approved ? " is-approved" : ""}`}>
              <div className="marketing-action-heading">
                <div className="marketing-action-provider">
                  <Image src="/integrations/google-drive.svg" alt="" width={20} height={20}
                    unoptimized className="marketing-action-logo" />
                  <span>Google Drive · Create document</span>
                </div>
                <Badge tone={approved ? "ok" : "neutral"}>{approved ? "Approved" : "Prepared"}</Badge>
              </div>
              <p>Create the updated proposal and scope in the client folder.</p>
            </div>
          </div>
          <div className="marketing-demo-approval-action">
            <button
              type="button"
              className="cf-btn marketing-demo-approve"
              style={{ ...buttonStyle("primary"), height: 34, padding: "0 14px" }}
              onClick={() => setApproved(true)}
              disabled={approved}
              tabIndex={approvalAvailable && !approved ? 0 : -1}
              aria-hidden={!approvalAvailable}
            >
              {approved ? "Approved ✓" : "Approve 2 actions"}
            </button>
          </div>
        </div>
      </Card>
    </figure>
  );
}
