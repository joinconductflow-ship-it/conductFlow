"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { markReviewStatus, submitReview } from "@/app/actions/reviews";
import { Card, CardTitle, EmptyState, buttonStyle, fieldStyle, labelStyle, proseStyle } from "@/components/ui/primitives";
import { presentError } from "@/lib/errors/presentation";

export interface ReceivedReviewPanelProps {
  unavailable?: boolean;
  reviews: { id: string; reviewer_name: string | null; source: string | null;
    rating: number | null; raw_review: string; sentiment: string; urgency: string;
    drafted_response: string | null; status: string }[];
}

function badgeStyle(value: string) {
  const urgent = value === "negative" || value === "high";
  return {
    color: urgent ? "var(--danger-text)" : "var(--muted)", border: "1px solid currentColor",
    borderRadius: "999px", fontSize: "0.75rem", padding: "0.1rem 0.45rem",
  };
}

export function ReceivedReviewPanel({ reviews, unavailable }: ReceivedReviewPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawReview, setRawReview] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [rating, setRating] = useState("");
  const [source, setSource] = useState("other");

  function run(key: string, fn: () => Promise<unknown>) {
    setError(null); setBusyKey(key);
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(presentError(e, { fallback: "Couldn't update this review right now. Try again." })); }
      finally { setBusyKey(null); }
    });
  }

  function submit() {
    run("submit", async () => {
      await submitReview({ rawReview, reviewerName: reviewerName || null, source,
        rating: rating ? Number(rating) : null });
      setRawReview(""); setReviewerName(""); setRating(""); setSource("other");
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
      <Card>
        <CardTitle>Got a new review?</CardTitle>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
          Paste it in and ConductFlow drafts a reply for you to send, matching the tone
          and flagging anything that needs your attention first.
        </p>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}
          style={{ marginTop: "var(--space-3)" }}>
          <label style={labelStyle}>Paste the review here
            <textarea required value={rawReview} onChange={(event) => setRawReview(event.target.value)}
              rows={5} style={{ ...fieldStyle, resize: "vertical" }} />
          </label>
          <label style={labelStyle}>Reviewer’s name (optional)
            <input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)}
              style={fieldStyle} />
          </label>
          <label style={labelStyle}>Star rating (optional)
            <select value={rating} onChange={(event) => setRating(event.target.value)} style={fieldStyle}>
              <option value="">Not stated</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Where did it come from?
            <select value={source} onChange={(event) => setSource(event.target.value)} style={fieldStyle}>
              <option value="google">Google</option><option value="yelp">Yelp</option>
              <option value="facebook">Facebook</option><option value="other">Somewhere else</option>
            </select>
          </label>
          <button type="submit" disabled={isPending}
            style={{ ...buttonStyle("primary", isPending), marginTop: "var(--space-4)" }}>
            {isPending && busyKey === "submit" ? "Drafting…" : "Draft response"}
          </button>
        </form>
      </Card>
      {unavailable ? <Unavailable section="Received reviews are" /> : reviews.length === 0 ? <EmptyState title="No reviews yet"
        body="Paste a review you received to classify it and draft a reply." /> : reviews.map((review) => (
        <Card key={review.id} style={review.status === "new" ? undefined : { opacity: 0.6 }}>
          <CardTitle>{review.reviewer_name || "Anonymous"}</CardTitle>
          <p style={{ ...proseStyle, color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {review.source ?? "Other"} · {review.rating ? "★".repeat(review.rating) : "no rating"} · {review.status}
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <span style={badgeStyle(review.sentiment)}>{review.sentiment}</span>
            <span style={badgeStyle(review.urgency)}>{review.urgency} urgency</span>
          </div>
          <p style={{ ...proseStyle, whiteSpace: "pre-wrap", marginTop: "var(--space-3)" }}>
            {review.raw_review}
          </p>
          {review.drafted_response && <div style={{ ...proseStyle, whiteSpace: "pre-wrap",
            borderLeft: "3px solid var(--muted)", paddingLeft: "var(--space-3)", marginTop: "var(--space-3)" }}>
            {review.drafted_response}
          </div>}
          {review.status === "new" && <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            <button type="button" disabled={isPending} onClick={() => run(`${review.id}:responded`,
              () => markReviewStatus(review.id, "responded"))} style={buttonStyle("secondary", isPending)}>
              {isPending && busyKey === `${review.id}:responded` ? "Updating…" : "Mark responded"}
            </button>
            <button type="button" disabled={isPending} onClick={() => run(`${review.id}:dismissed`,
              () => markReviewStatus(review.id, "dismissed"))} style={buttonStyle("secondary", isPending)}>
              {isPending && busyKey === `${review.id}:dismissed` ? "Updating…" : "Dismiss"}
            </button>
          </div>}
        </Card>
      ))}
    </div>
  );
}
