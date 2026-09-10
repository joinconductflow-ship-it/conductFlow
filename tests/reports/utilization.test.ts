import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUtilizationSummary } from "@/lib/reports/utilization";

const ORG = "00000000-0000-0000-0000-00000000000a";
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? (tables[table] = []);
      function chain(matchers: Array<(row: Row) => boolean> = [], start = 0, end = Infinity) {
        return {
          eq(column: string, value: unknown) {
            return chain([...matchers, (row) => row[column] === value], start, end);
          },
          order() { return chain(matchers, start, end); },
          range(nextStart: number, nextEnd: number) { return chain(matchers, nextStart, nextEnd); },
          then(resolve: (value: { data: Row[]; error: null }) => unknown) {
            const data = rows().filter((row) => matchers.every((matcher) => matcher(row))).slice(start, end + 1);
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
      }
      return { select() { return chain(); } };
    },
  } as unknown as SupabaseClient;
}

function rows(overrides: Record<string, Row[]> = {}) {
  return {
    time_entry: [], invoice: [], client_contact: [], billing_rate: [], ...overrides,
  } as Record<string, Row[]>;
}

describe("getUtilizationSummary", () => {
  it("calculates unbilled hourly revenue once with half-up integer rounding", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }],
      time_entry: [{ id: "1", org_id: ORG, client_id: "a", minutes: 31, invoiced: false }],
      billing_rate: [{ org_id: ORG, client_id: "a", unit: "hourly", amount_cents: 101 }],
    })), { orgId: ORG });
    expect(result[0]).toMatchObject({ clientName: "Ava", minutesUnbilled: 31, revenueUnbilledCents: 52 });
  });

  it("uses zero unbilled revenue when no rate is configured", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }],
      time_entry: [{ id: "1", org_id: ORG, client_id: "a", minutes: 30, invoiced: false }],
    })), { orgId: ORG });
    expect(result[0].revenueUnbilledCents).toBe(0);
  });

  it("falls back to the organization default rate", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }],
      time_entry: [{ id: "1", org_id: ORG, client_id: "a", minutes: 90, invoiced: false }],
      billing_rate: [{ org_id: ORG, client_id: null, unit: "hourly", amount_cents: 10000 }],
    })), { orgId: ORG });
    expect(result[0].revenueUnbilledCents).toBe(15000);
  });

  it("reports billed time and invoice revenue separately", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }],
      time_entry: [{ id: "1", org_id: ORG, client_id: "a", minutes: 60, invoiced: true }],
      invoice: [{ id: "invoice", org_id: ORG, client_id: "a", total_cents: 12500 }],
    })), { orgId: ORG });
    expect(result[0]).toMatchObject({ minutesInvoiced: 60, minutesUnbilled: 0, revenueInvoicedCents: 12500 });
  });

  it("keeps time but not estimated revenue for non-hourly rates", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }, { id: "b", org_id: ORG, name: "Bea" }],
      time_entry: [
        { id: "1", org_id: ORG, client_id: "a", minutes: 20, invoiced: false },
        { id: "2", org_id: ORG, client_id: "b", minutes: 20, invoiced: false },
      ],
      billing_rate: [
        { org_id: ORG, client_id: "a", unit: "per_session", amount_cents: 5000 },
        { org_id: ORG, client_id: "b", unit: "flat", amount_cents: 5000 },
      ],
    })), { orgId: ORG });
    expect(result.map((client) => [client.minutesUnbilled, client.revenueUnbilledCents])).toEqual([[20, 0], [20, 0]]);
  });

  it("returns an empty report for an org with no time entries", async () => {
    await expect(getUtilizationSummary(fakeDb(rows()), { orgId: ORG })).resolves.toEqual([]);
  });

  it("sorts clients by total logged minutes descending", async () => {
    const result = await getUtilizationSummary(fakeDb(rows({
      client_contact: [{ id: "a", org_id: ORG, name: "Ava" }, { id: "b", org_id: ORG, name: "Bea" }],
      time_entry: [
        { id: "1", org_id: ORG, client_id: "a", minutes: 20, invoiced: false },
        { id: "2", org_id: ORG, client_id: "b", minutes: 45, invoiced: true },
      ],
    })), { orgId: ORG });
    expect(result.map((client) => client.clientId)).toEqual(["b", "a"]);
  });
});
