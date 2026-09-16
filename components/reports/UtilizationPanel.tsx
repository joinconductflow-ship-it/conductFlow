import type { ClientUtilization } from "@/lib/reports/utilization";
import { Card, CardTitle } from "@/components/ui/primitives";

function money(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

export function UtilizationPanel({ data }: { data: ClientUtilization[] }) {
  return (
    <Card>
      <CardTitle>Client utilization</CardTitle>
      <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
        How much time and money each client represents, and how much of that work
        hasn’t been invoiced yet.
      </p>
      {data.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>
          Nothing here yet, log some time on the Billing page and it’ll show up here.
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "var(--space-3)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                <th style={{ padding: "var(--space-2) var(--space-3) var(--space-2) 0" }}>Client</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Hours worked</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Hours not invoiced yet</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Invoiced</th>
                <th style={{ padding: "var(--space-2) 0 var(--space-2) var(--space-3)", textAlign: "right" }}>Not invoiced yet</th>
              </tr>
            </thead>
            <tbody>
              {data.map((client) => (
                <tr key={client.clientId} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "var(--space-3) var(--space-3) var(--space-3) 0" }}>{client.clientName}</td>
                  <td className="tabular" style={{ padding: "var(--space-3)", textAlign: "right" }}>{hours(client.minutesLogged)}</td>
                  <td className="tabular" style={{ padding: "var(--space-3)", textAlign: "right" }}>{hours(client.minutesUnbilled)}</td>
                  <td className="tabular" style={{ padding: "var(--space-3)", textAlign: "right" }}>{money(client.revenueInvoicedCents)}</td>
                  <td className="tabular" style={{ padding: "var(--space-3) 0 var(--space-3) var(--space-3)", textAlign: "right" }}>{money(client.revenueUnbilledCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
