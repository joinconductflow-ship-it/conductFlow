"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SectionLabel } from "@/components/ui/primitives";

const CONTROLS = [
  {
    label: "Send external email",
    code: "send_external_email",
    description: "Drafts can be prepared. Sending is blocked.",
  },
  {
    label: "Change scope",
    code: "change_scope",
    description: "ConductFlow cannot alter what was agreed.",
  },
  {
    label: "Change pricing",
    code: "change_pricing",
    description: "Pricing changes require a human-controlled process.",
  },
  {
    label: "Sign contracts",
    code: "sign_contract",
    description: "ConductFlow cannot sign on your behalf.",
  },
  {
    label: "Take payments",
    code: "take_payment",
    description: "Payment collection is not autonomous.",
  },
  {
    label: "Delete records",
    code: "delete_record",
    description: "Destructive actions are blocked.",
  },
] as const;

type Stage = "heading" | "boundary" | "cards" | "complete";

export default function ControlLayer() {
  const sectionRef = useRef<HTMLElement>(null);
  const startedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const [stage, setStage] = useState<Stage>("complete");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const timers = timersRef.current;

    const finish = () => {
      setStage("complete");
      setStarted(false);
    };

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStarted(true);
      setStage("heading");

      timersRef.current.push(window.setTimeout(() => setStage("boundary"), 320));
      timersRef.current.push(window.setTimeout(() => setStage("cards"), 700));
      timersRef.current.push(window.setTimeout(finish, 1_900));
    };

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const isMeaningfullyVisible = () => {
      const rect = section.getBoundingClientRect();
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
      );
      return visibleHeight / Math.max(rect.height, 1) >= 0.38;
    };

    if (typeof window.IntersectionObserver !== "function") {
      const checkVisibility = () => {
        if (!isMeaningfullyVisible()) return;
        start();
        window.removeEventListener("scroll", checkVisibility);
        window.removeEventListener("resize", checkVisibility);
      };

      window.addEventListener("scroll", checkVisibility, { passive: true });
      window.addEventListener("resize", checkVisibility);
      checkVisibility();
      timers.push(window.setTimeout(checkVisibility, 100));

      return () => {
        window.removeEventListener("scroll", checkVisibility);
        window.removeEventListener("resize", checkVisibility);
        timers.forEach((timer) => window.clearTimeout(timer));
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.38) {
          observer.disconnect();
          start();
        }
      },
      { threshold: [0.38] },
    );

    observer.observe(section);

    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return (
    <section
      id="principles"
      ref={sectionRef}
      className="marketing-control-layer marketing-dark-section"
      data-control-stage={stage}
      data-control-started={started ? "true" : "false"}
      aria-labelledby="control-layer-title"
    >
      <div className="marketing-control-inner">
        <div className="marketing-control-heading">
          <SectionLabel>Control layer</SectionLabel>
          <h2 id="control-layer-title">Hard limits, enforced in code.</h2>
          <p>
            ConductFlow can prepare and queue work, but certain actions are blocked at the
            execution layer regardless of settings or prompts.
          </p>
        </div>

        <div className="marketing-control-boundary" aria-hidden="true" />

        <div className="marketing-control-grid">
          {CONTROLS.map((control, index) => (
            <article
              className="marketing-control-card"
              key={control.code}
              style={{
                "--control-delay": `${index * 90}ms`,
              } as CSSProperties}
            >
              <div className="marketing-control-card-top">
                <span className="mono marketing-control-code">{control.code}</span>
              </div>
              <h3>{control.label}</h3>
              <p>{control.description}</p>
              <div className="marketing-control-status" aria-live="polite">
                <span className="mono marketing-control-checking" aria-hidden="true">
                  checking execution policy...
                </span>
                <span className="mono marketing-control-blocked">BLOCKED IN CODE</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
