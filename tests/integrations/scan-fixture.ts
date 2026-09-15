import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
/** In-memory query double: models durable rows across multiple watcher invocations. */
export function scanDatabase(tables: Record<string, Row[]>) {
  const calls: { table: string; operation: string; filters: [string, unknown][]; limit: number }[] = [];
  const rpc = vi.fn(async (name: string, args: Row): Promise<{ data: unknown; error: unknown }> => {
    if (name === "claim_integration_scan") {
      const row = tables.connected_data_source.find((c) => c.provider === args.p_provider && c.state === "active"
        && (!args.p_org || c.org_id === args.p_org));
      if (!row) return { data: [], error: null };
      const state = tables.integration_scan_state.find((s) => s.connection_id === row.id)!;
      if (state.locked_until && Date.parse(String(state.locked_until)) > Date.now()) return { data: [], error: null };
      Object.assign(state, { lease_token: "lease", locked_until: new Date(Date.now() + 900_000).toISOString() });
      return { data: [{ ...row, lease_token: "lease" }], error: null };
    }
    if (name === "match_gmail_client") {
      const aliases = (tables.client_email_alias ?? []).filter((c) => c.org_id === args.p_org && c.email === args.p_email);
      const clients = (tables.client_contact ?? []).filter((c) => c.org_id === args.p_org &&
        (aliases.length ? aliases.some((a) => a.client_contact_id === c.id) : String(c.email ?? "").trim().toLowerCase() === args.p_email));
      return { data: clients.slice(0, 2), error: null };
    }
    if (name === "record_unmatched_source") {
      const rows = tables.integration_unmatched_source ??= [];
      const existing = rows.find((s) => s.org_id === args.p_org && s.provider === args.p_provider && s.source_key === args.p_key);
      if (existing) { existing.occurrence_count = Number(existing.occurrence_count) + 1; return { data: false, error: null }; }
      rows.push({ org_id: args.p_org, provider: args.p_provider, source_key: args.p_key, status: "open", occurrence_count: 1 });
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const db = { rpc, from(table: string) {
    const filters: [string, unknown][] = [];
    const predicates: ((row: Row) => boolean)[] = [];
    const orders: string[] = [];
    let limit = Infinity, operation = "select", patch: Row = {}, records: Row[] = [], conflict: string[] = [];
    let single = false;
    const chain = {
      select: () => chain,
      eq(key: string, value: unknown) { filters.push([key, value]); predicates.push((r) => r[key] === value); return chain; },
      in(key: string, values: unknown[]) { predicates.push((r) => values.includes(r[key])); return chain; },
      order(key: string) { orders.push(key); return chain; },
      limit(n: number) { limit = n; return chain; },
      single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
      update(value: Row) { operation = "update"; patch = value; return chain; },
      delete() { operation = "delete"; return chain; },
      upsert(value: Row | Row[], options: { onConflict: string }) {
        operation = "upsert"; records = Array.isArray(value) ? value : [value]; conflict = options.onConflict.split(","); return chain;
      },
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          calls.push({ table, operation, filters, limit });
          const rows = tables[table] ??= [];
          let selected = rows.filter((r) => predicates.every((p) => p(r)));
          selected.sort((a, b) => { for (const key of orders) {
            if (a[key] !== b[key]) return a[key]! < b[key]! ? -1 : 1;
          } return 0; });
          selected = selected.slice(0, limit);
          if (operation === "update") selected.forEach((r) => Object.assign(r, patch));
          if (operation === "delete") tables[table] = rows.filter((r) => !selected.includes(r));
          if (operation === "upsert") for (const record of records) {
            const existing = rows.find((r) => conflict.every((key) => r[key] === record[key]));
            if (existing) Object.assign(existing, record); else rows.push({ ...record });
          }
          return { data: single ? selected[0] ?? null : selected.map((r) => ({ ...r })), error: null, count: selected.length };
        }).then(resolve, reject);
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { db, rpc, tables, calls };
}
