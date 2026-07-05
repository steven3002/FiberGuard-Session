"use client";

import type { AuditEntry } from "@fiberguard/session";

export type PanelResult =
  | { decision: "allowed"; title: string; lines: string[] }
  | { decision: "blocked"; reason: string; details?: Record<string, unknown> }
  | { decision: "error"; message: string };

export function ResultPanel({ result }: { result: PanelResult | null }) {
  if (!result) return null;
  if (result.decision === "allowed") {
    return (
      <div className="result result-allowed">
        <strong>✓ {result.title}</strong>
        {result.lines.map((line, index) => (
          <div key={index} className="mono">
            {line}
          </div>
        ))}
      </div>
    );
  }
  if (result.decision === "blocked") {
    return (
      <div className="result result-blocked">
        <strong>✗ Blocked — {result.reason}</strong>
        {result.details && <pre className="mono">{JSON.stringify(result.details, null, 2)}</pre>}
      </div>
    );
  }
  return (
    <div className="result result-blocked">
      <strong>Error</strong> {result.message}
    </div>
  );
}

export function AuditPanel({ events }: { events: AuditEntry[] }) {
  if (events.length === 0) return <p className="empty">No audit events yet — click an action, then Refresh.</p>;
  return (
    <div className="scroll-x">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Action</th>
            <th>Amount</th>
            <th>Decision</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={index}>
              <td className="mono">{new Date(event.timestamp).toLocaleTimeString()}</td>
              <td>{event.event}</td>
              <td>{event.action ?? "—"}</td>
              <td>{event.requestedAmount ?? "—"}</td>
              <td>
                <span className={`badge ${event.decision === "allowed" ? "badge-allowed" : "badge-blocked"}`}>
                  {event.decision}
                </span>
              </td>
              <td className="mono">{event.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
