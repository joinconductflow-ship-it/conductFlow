"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unavailable } from "@/components/ui/Unavailable";
import { markReviewStatus, submitReview } from "@/app/actions/reviews";
import { Card, CardTitle, EmptyState, buttonStyle, proseStyle } from "@/components/ui/primitives";

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
      catch (e) { setError(e instanceof Error ? e.message : "That did not work."); }
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
        <CardTitle>Received a review?</CardTitle>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }}
          style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
          <label style={proseStyle}>Paste a review
            <textarea required value={rawReview} onChange={(event) => setRawReview(event.target.value)}
              rows={5} style={{ display: "block", width: "100%", marginTop: "var(--space-1)" }} />
          </label>
          <label style={proseStyle}>Reviewer name
            <input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)}
              style={{ display: "block", width: "100%", marginTop: "var(--space-1)" }} />
          </label>
          <label style={proseStyle}>Star rating
            <select value={rating} onChange={(event) => setRating(event.target.value)}
              style={{ display: "block", marginTop: "var(--space-1)" }}>
              <option value="">Not stated</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={proseStyle}>Source
            <select value={source} onChange={(event) => setSource(event.target.value)}
              style={{ display: "block", marginTop: "var(--space-1)" }}>
              <option value="google">Google</option><option value="yelp">Yelp</option>
              <option value="facebook">Facebook</option><option value="other">Other</option>
            </select>
          </label>
          <button type="submit" disabled={isPending} style={buttonStyle("primary", isPending)}>
            {isPending && busyKey === "submit" ? "Drafting…" : "Draft response"}
          </button>
        </form>
      </Card>
      {unavailable ? <Unavailable section="Received reviews are" /> : reviews.length === 0 ? <EmptyState title="No reviews yet"
        body="Paste a review you received to classify it and draft a reply." /> : reviews.map((review) => (
        <Card key={review.id} style={review.status === "new" ? undefined : { opacity: 0.6 }}>
          <CardTitle>{review.reviewer_name || "Anonymous"}</CardTitle>
          <p style={{ ...proseStyle, color: "var(--muted)", marginTop: "var(--space-2)" }}>
            {review.source ?? "Other"} · {review.rating ? "★".repeat(review.rating) : "N/A"} · {review.status}
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
