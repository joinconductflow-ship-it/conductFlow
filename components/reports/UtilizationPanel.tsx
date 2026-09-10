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
      {data.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "var(--space-3)" }}>No time logged yet.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: "var(--space-3)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}>
                <th style={{ padding: "var(--space-2) var(--space-3) var(--space-2) 0" }}>Client</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Hours logged</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Hours unbilled</th>
                <th style={{ padding: "var(--space-2) var(--space-3)", textAlign: "right" }}>Revenue billed</th>
                <th style={{ padding: "var(--space-2) 0 var(--space-2) var(--space-3)", textAlign: "right" }}>Revenue unbilled</th>
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
