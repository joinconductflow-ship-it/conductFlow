import { it, expect, beforeAll, afterAll } from "vitest";
import { describeWithLocalDb } from "../helpers/local-supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MockLanguageModelV4 } from "ai/test";
import { runIngest } from "@/lib/ingest/run";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const orgA = "00000000-0000-0000-0000-00000000000a";
const clientA = "00000000-0000-0000-0000-0000000000c1";

function mockReturning(payload: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

const owned = {
  text: "Send the revised deck", owner: "Priya", deadline: "2026-08-14",
  type: "deliverable", confidence: "high", source_span: "I'll send the revised deck",
};

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

async function escalationsFor(conversationId: string) {
  const { data } = await db.from("escalation").select("*").eq("conversation_id", conversationId);
  return data ?? [];
}

const base = {
  orgId: orgA, clientId: clientA, clientName: "Ramirez family",
  title: "Escalation check", occurredAt: "2026-08-11",
};

describeWithLocalDb("runIngest escalations", () => {
  it("raises nothing for a clean conversation", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Consultant: I'll send the revised deck by Friday.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    expect(await escalationsFor(r.conversationId)).toEqual([]);
  });

  it("raises a complaint and links it to the conversation, not a commitment", async () => {
    const r = await runIngest(db, {
      ...base,
      transcript: "Client: I'm disappointed with last month. Consultant: I'll send the revised deck.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    const rows = await escalationsFor(r.conversationId);
    const complaint = rows.find((e) => e.kind === "complaint");
    expect(complaint).toBeDefined();
    expect(complaint!.commitment_id).toBeNull();
    expect(complaint!.state).toBe("open");
  });

  it("links a missing-owner escalation to the commitment it is about", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Someone will send the deck.",
    }, mockReturning({
      commitments: [{ ...owned, owner: null, deadline: null }],
      subject: "Deck", body: "On its way.",
    }));

    const rows = await escalationsFor(r.conversationId);
    const missing = rows.find((e) => e.kind === "missing_owner_or_deadline");
    expect(missing).toBeDefined();
    expect(missing!.commitment_id).not.toBeNull();

    const { data: commitment } = await db.from("commitment").select("id")
      .eq("id", missing!.commitment_id).single();
    expect(commitment).not.toBeNull();
  });

  it("writes an agent-actor audit row when it escalates", async () => {
    const r = await runIngest(db, {
      ...base, transcript: "Client: My attorney will be in touch. I'll send the signed copy.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    const { data } = await db.from("audit_event").select("*")
      .eq("target", `conversation:${r.conversationId}:escalate`);
    expect(data!.length).toBe(1);
    expect(data![0].actor).toBe("agent");
  });

  it("does not stack duplicates when extraction is retried", async () => {
    const model = mockReturning({
      commitments: [{ ...owned, owner: null }], subject: "Deck", body: "On its way.",
    });
    const r = await runIngest(db, {
      ...base, transcript: "Client: I'm frustrated. Someone will send the deck.",
    }, model);
    const first = await escalationsFor(r.conversationId);

    const { retryExtractionFor } = await import("@/lib/ingest/run");
    await retryExtractionFor(db, r.transcriptId, model);

    const second = await escalationsFor(r.conversationId);
    expect(second.filter((e) => e.state === "open").map((e) => e.kind).sort())
      .toEqual(first.filter((e) => e.state === "open").map((e) => e.kind).sort());
  });
});

// Versions 9500-9599 are this file's reserved range; see the version-range table in the
// Phase 5 plan. loadBlueprint reads the highest version and nothing ever deletes, so a
// restricted row written here would become org A's live contract for every file that runs
// after this one. The afterAll puts the defaults back at a higher version.
const DEFAULT_ROW = {
  allowed_sources: ["transcript", "client_contact", "template"],
  permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
  required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
    "propose_recurring_task"],
  escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
  success_metric: "follow_up_sent_within_24h",
  expires_in_minutes: 60,
};

/**
 * The next free version at or above `floor`. A fixed number would collide with itself
 * (23505) the second time the suite runs against a database that was not reset, and the
 * row must also out-rank every other version for the org — loadBlueprint reads the highest,
 * so a restricted row that does not win the ordering tests nothing. Same idiom as
 * tests/rls.test.ts.
 */
async function nextVersion(floor: number): Promise<number> {
  const { data } = await db.from("agent_blueprint").select("version")
    .eq("org_id", orgA).order("version", { ascending: false }).limit(1).maybeSingle();
  return Math.max(floor, ((data?.version as number | undefined) ?? 0) + 1);
}

describeWithLocalDb("runIngest honors escalation_conditions", () => {
  afterAll(async () => {
    // Blueprints are append-only and this suite never deletes. Restoring at a higher
    // version is how a test puts the org back the way it found it — without this, the
    // restricted contract below becomes org A's live contract for every file that runs
    // after this one.
    const { error } = await db.from("agent_blueprint")
      .insert({ ...DEFAULT_ROW, org_id: orgA, version: await nextVersion(9599) });
    if (error) throw error;
  });

  // Declared first on purpose: Vitest runs `it` blocks in declaration order within a file,
  // so this one sees the defaults, before the restricted row below is written. Without it a
  // filter that silenced every kind would pass the negative case.
  it("raises a complaint the default blueprint names", async () => {
    const r = await runIngest(db, {
      ...base, title: "Unhappy call — defaults",
      transcript: "Client: I am frustrated with the delay. Consultant: I'll send the revised deck.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    expect((await escalationsFor(r.conversationId)).map((e) => e.kind)).toContain("complaint");
  });

  it("does not raise an escalation kind the blueprint omits", async () => {
    // Only escalation_conditions is narrowed. permitted_actions keeps the defaults on
    // purpose: another file racing this one must still find draft_follow_up permitted for
    // org A while this row is live.
    const { error } = await db.from("agent_blueprint").insert({
      ...DEFAULT_ROW, org_id: orgA, version: await nextVersion(9501),
      // complaint deliberately absent
      escalation_conditions: ["legal_concern", "missing_owner_or_deadline"],
    });
    if (error) throw error;

    const r = await runIngest(db, {
      ...base, title: "Unhappy call — restricted",
      transcript: "Client: I am frustrated with the delay. Consultant: I'll send the revised deck.",
    }, mockReturning({ commitments: [owned], subject: "Deck", body: "On its way." }));

    expect((await escalationsFor(r.conversationId)).map((e) => e.kind))
      .not.toContain("complaint");
  });

  it("still raises a kind the restricted blueprint keeps", async () => {
    const r = await runIngest(db, {
      ...base, title: "Ownerless promise — restricted",
      transcript: "Someone will send the deck at some point.",
    }, mockReturning({
      commitments: [{ ...owned, owner: null, deadline: null }],
      subject: "Deck", body: "On its way.",
    }));

    expect((await escalationsFor(r.conversationId)).map((e) => e.kind))
      .toContain("missing_owner_or_deadline");
  });
});
