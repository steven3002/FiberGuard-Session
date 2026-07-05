"use client";

import { useCallback, useEffect, useState } from "react";
import {
  actionLabel,
  api,
  type ActiveSession,
  type AuditEvent,
  type RequestDetail,
} from "../lib/api";

export default function ConsolePage() {
  const [pending, setPending] = useState<RequestDetail[]>([]);
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, a, log] = await Promise.all([api.getPending(), api.getActive(), api.getAudit()]);
    setPending(p.body.requests ?? []);
    setActive(a.body.sessions ?? []);
    setAudit((log.body.events ?? []).slice(0, 40));
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    await action().catch(() => {});
    setBusy(null);
    await refresh().catch(() => {});
  }

  const rowStyle = { borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 };

  return (
    <>
      <div className="card">
        <div className="row-between">
          <div>
            <h1>Operator console</h1>
            <p className="subtle">Pending approvals, active sessions, and the audit trail.</p>
          </div>
          <button className="btn-small" onClick={() => refresh()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Pending approvals ({pending.length})</h2>
        {pending.length === 0 && <p className="empty">No pending requests.</p>}
        {pending.map((request) => (
          <div key={request.session_request_id} className="row-between" style={rowStyle}>
            <div className="stack">
              <strong>{request.app_name}</strong>
              <span className="subtle mono">{request.origin}</span>
              <span className="subtle">
                {request.permissions.map((permission) => actionLabel(permission.action)).join(", ")}
              </span>
            </div>
            <div className="actions" style={{ marginTop: 0 }}>
              <button
                className="btn-primary btn-small"
                disabled={busy !== null}
                onClick={() => act(request.session_request_id, () => api.approve(request.session_request_id, "session"))}
              >
                Approve
              </button>
              <button
                className="btn-small"
                disabled={busy !== null}
                onClick={() => act(request.session_request_id, () => api.approve(request.session_request_id, "once"))}
              >
                Once
              </button>
              <button
                className="btn-danger btn-small"
                disabled={busy !== null}
                onClick={() => act(request.session_request_id, () => api.deny(request.session_request_id))}
              >
                Deny
              </button>
              <a className="btn-small" href={`/approve/${request.session_request_id}`} style={{ textDecoration: "none" }}>
                Open
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Active sessions ({active.length})</h2>
        {active.length === 0 && <p className="empty">No active sessions.</p>}
        {active.map((session) => (
          <div key={session.session_id} className="row-between" style={rowStyle}>
            <div className="stack">
              <strong>
                {session.app_name} <span className="subtle">({session.approval_type})</span>
              </strong>
              <span className="subtle mono">{session.session_id}</span>
              <span className="subtle">expires {new Date(session.expires_at).toLocaleTimeString()}</span>
            </div>
            <button
              className="btn-danger btn-small"
              disabled={busy !== null}
              onClick={() => act(session.session_id, () => api.revoke(session.session_id))}
            >
              Revoke
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Audit log ({audit.length})</h2>
        {audit.length === 0 && <p className="empty">No audit events yet.</p>}
        {audit.length > 0 && (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>App</th>
                  <th>Action</th>
                  <th>Decision</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((event, index) => (
                  <tr key={index}>
                    <td className="mono">{new Date(event.timestamp).toLocaleTimeString()}</td>
                    <td>{event.event}</td>
                    <td>{event.app_id ?? "—"}</td>
                    <td>{event.action ?? "—"}</td>
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
        )}
      </div>
    </>
  );
}
