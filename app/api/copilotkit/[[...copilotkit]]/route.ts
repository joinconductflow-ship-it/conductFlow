// @ai-sdk/gateway is pinned to the same major version CopilotKit's own
// bundled "ai" package expects (v3 protocol) — the app's top-level "ai"
// package is a newer major (v4 protocol) and its gateway() is NOT
// interchangeable here; BuiltInAgent's internals reject that shape.
import { createGateway } from "@ai-sdk/gateway";
import {
  CopilotRuntime,
  BuiltInAgent,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { copilotTools } from "@/lib/copilot/tools";
import { EXTRACTION_MODEL } from "@/lib/agent/schema";

// BuiltInAgent's own string-based model resolution expects a raw provider key
// (OPENAI_API_KEY) rather than this app's Vercel AI Gateway credit. Passing an
// already-resolved LanguageModel from the Gateway sidesteps that and reuses
// the exact same model + billing path as the rest of the app (see schema.ts).
const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });

const approvalAgent = new BuiltInAgent({
  model: gateway(EXTRACTION_MODEL),
  tools: copilotTools,
  // >1 so the model can call listOpenCommitments and then respond to the
  // result in the same turn (the CopilotKit docs warn interrupt tools are
  // safest at the default maxSteps:1 — verify proposeAction still pauses
  // correctly at this value before relying on it for a demo).
  maxSteps: 4,
});

const runtime = new CopilotRuntime({
  agents: { default: approvalAgent },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
