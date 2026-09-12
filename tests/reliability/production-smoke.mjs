// Run after `npm run build -- --no-lint`: node tests/reliability/production-smoke.mjs
// Exercises the real production RSC pipeline with a local, read-only Supabase stand-in.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

const id = "00000000-0000-0000-0000-000000000001";
const org = "00000000-0000-0000-0000-00000000000a";
const user = { id, aud: "authenticated", role: "authenticated", email: "smoke@example.test",
  app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
let failures = new Set();
const seen = [];
const database = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const table = url.pathname.split("/").at(-1);
  seen.push(`${url.pathname}?${url.searchParams}`);
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    res.writeHead(405).end(JSON.stringify({ message: "Read-only fixture" }));
    return;
  }
  if (url.pathname === "/auth/v1/user") { res.end(JSON.stringify(user)); return; }
  if (failures.has(table)) {
    res.writeHead(500).end(JSON.stringify({ code: "42P01", message: "SMOKE_PRIVATE_DATABASE_FAILURE",
      details: `Missing ${table}`, hint: "Check migration" }));
    return;
  }
  const data = {
    membership: [{ user_id: id, org_id: org, role: "owner" }],
    client_contact: [{ id, name: "Smoke client" }],
    client_message_draft: [{ id, client_id: id, source_id: id, subject: "Smoke healthy draft", body: "Draft body" }],
    received_review: [{ id, reviewer_name: "Smoke healthy reviewer", source: "other", rating: 5,
      raw_review: "Great", sentiment: "positive", urgency: "low", status: "new" }],
  }[table] ?? [];
  res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? data[0] ?? null : data));
});
database.listen(0, "127.0.0.1");
await once(database, "listening");
const dbUrl = `http://127.0.0.1:${database.address().port}`;

// Let the OS select a free app port; don't disturb an existing development server.
const portProbe = createServer();
portProbe.listen(0, "127.0.0.1");
await once(portProbe, "listening");
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const exp = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, aud: "authenticated", role: "authenticated", exp })}.local-fixture-signature`;
const cookie = `sb-127-auth-token=base64-${encode({ access_token: token, refresh_token: "local-fixture-refresh",
  expires_at: exp, expires_in: 3600, token_type: "bearer", user })}`;
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: dbUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-fixture-anon", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
next.stdout.on("data", (data) => { logs += data.toString(); });
next.stderr.on("data", (data) => { logs += data.toString(); });

try {
  for (let attempt = 0; ; attempt++) {
    if (next.exitCode !== null) throw new Error(`Next exited: ${logs}`);
    try { await fetch(`http://127.0.0.1:${port}/onboarding`); break; }
    catch { if (attempt >= 100) throw new Error(`Next did not start: ${logs}`); await delay(100); }
  }
  const scenarios = [
    { path: "/reviews", tables: [], present: ["Smoke healthy draft", "Smoke healthy reviewer"], absent: ["temporarily unavailable"] },
    { path: "/reviews", tables: ["client_message_draft"], present: ["Review requests are temporarily unavailable", "Smoke healthy reviewer"], absent: ["Nothing pending"] },
    { path: "/reviews", tables: ["received_review"], present: ["Received reviews are temporarily unavailable", "Smoke healthy draft"], absent: ["No reviews yet"] },
    { path: "/reviews", tables: ["client_message_draft", "received_review"], present: ["Review requests are temporarily unavailable", "Received reviews are temporarily unavailable"], absent: [] },
    { path: "/reviews", tables: ["client_contact"], present: ["Client names are temporarily unavailable", "Smoke healthy draft", "Smoke healthy reviewer"], absent: [] },
    { path: "/queue", tables: ["escalation"], present: ["Escalations are temporarily unavailable", "No promises yet"], absent: [] },
    { path: "/reports", tables: ["billing_rate"], present: ["Client utilization is temporarily unavailable"], absent: ["No time logged yet"] },
    { path: "/settings/blueprint", tables: ["agent_blueprint"], present: ["The agent blueprint is temporarily unavailable"], absent: ["shipped defaults"] },
    { path: "/scope", tables: ["scope_of_work"], present: ["Scope of work is temporarily unavailable"], absent: ["Save scope"] },
  ];
  for (const scenario of scenarios) {
    failures = new Set(scenario.tables);
    const logStart = logs.length;
    const response = await fetch(`http://127.0.0.1:${port}${scenario.path}`, { headers: { cookie } });
    // React inserts comment boundaries between adjacent text nodes during streaming.
    const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
    assert.equal(response.status, 200, `${scenario.path}: ${html.slice(0, 300)}\n${logs}`);
    for (const text of scenario.present) assert.ok(html.includes(text), `Missing ${text}. Requests: ${seen.join("\n")}\n${logs}`);
    for (const text of [...scenario.absent, "SMOKE_PRIVATE_DATABASE_FAILURE", "An error occurred in the Server Components render"])
      assert.ok(!html.includes(text), `Unexpected ${text} in ${scenario.path}`);
    if (scenario.tables.length) {
      // stderr delivery may trail the response by one event-loop turn.
      await delay(20);
      assert.ok(logs.slice(logStart).includes(scenario.path), "Missing route in server logs");
      for (const table of scenario.tables) assert.ok(logs.slice(logStart).includes(table), `Missing query ${table} in server logs`);
      assert.ok(logs.slice(logStart).includes("42P01"), "Missing database error code");
    }
    console.log(`PASS ${scenario.path}: ${scenario.tables.join(", ") || "healthy"}`);
  }
  console.log(`${scenarios.length} production render scenarios passed.`);
} finally {
  const exited = next.exitCode === null ? once(next, "exit") : Promise.resolve();
  if (next.exitCode === null) next.kill("SIGTERM");
  database.closeAllConnections();
  await new Promise((resolve) => database.close(resolve));
  await exited;
}
