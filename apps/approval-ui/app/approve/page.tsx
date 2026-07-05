"use client";

import { useEffect, useState } from "react";
import {
  actionLabel,
  api,
  describePermission,
  type RequestDetail,
} from "../../lib/api";

function readRequestId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fromPath = window.location.pathname.match(/\/approve\/([^/?#]+)/);
  if (fromPath?.[1]) return decodeURIComponent(fromPath[1]);
  return new URLSearchParams(window.location.search).get("request") ?? undefined;
}

type Outcome =
  | { kind: "approved"; sessionId?: string; approvalType: string }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export default function ApprovePage() {
  const [id, setId] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const requestId = readRequestId();
    setId(requestId);
    if (!requestId) {
      setLoading(false);
      return;
    }
    api
      .getRequest(requestId)
      .then((res) => {
        if (res.status === 200) setDetail(res.body);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function approve(approvalType: "session" | "once") {
    if (!id) return;
    setBusy(true);
    const res = await api.approve(id, approvalType);
    setBusy(false);
    if (res.status === 200 && res.body.status === "approved") {
      setOutcome({ kind: "approved", sessionId: res.body.session_id, approvalType });
    } else {
      setOutcome({ kind: "error", message: res.body.reason ?? `Approval failed (HTTP ${res.status})` });
    }
  }

  async function deny() {
    if (!id) return;
    setBusy(true);
    const res = await api.deny(id, "Denied from approval UI");
    setBusy(false);
    setOutcome(res.status === 200 ? { kind: "denied" } : { kind: "error", message: `Deny failed (HTTP ${res.status})` });
  }

  if (loading) {
    return (
      <div className="card">
        <p className="subtle">Loading approval request…</p>
      </div>
    );
  }
  if (!id) {
    return (
      <div className="card">
        <h1>No request specified</h1>
        <p className="subtle">Open the approval link your app gave you (…/approve/&lt;id&gt;).</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="card">
        <h1>Request not found</h1>
        <p className="mono">{id}</p>
      </div>
    );
  }

  const resolved = detail.status !== "pending";

  return (
    <div className="card">
      <h1>{detail.app_name} wants Fiber payment access</h1>
      <p className="subtle">
        Origin: <span className="mono">{detail.origin}</span>
      </p>

      <h2>Requested permissions</h2>
      <ul className="perm-list">
        {detail.permissions.map((permission, index) => (
          <li key={index}>
            <div className="perm-title">
              <span className="allow-mark">✓</span>
              {actionLabel(permission.action)}
            </div>
            {describePermission(permission).map((line, lineIndex) => (
              <div key={lineIndex} className="perm-detail">
                {line}
              </div>
            ))}
          </li>
        ))}
      </ul>

      {detail.denied_actions.length > 0 && (
        <>
          <h2>Blocked by policy</h2>
          <ul className="denied-list">
            {detail.denied_actions.map((action) => (
              <li key={action}>
                <span className="block-mark">✗</span>
                {actionLabel(action)}
              </li>
            ))}
          </ul>
        </>
      )}

      {outcome === null && !resolved && (
        <div className="actions">
          <button className="btn-primary" disabled={busy} onClick={() => approve("once")}>
            Approve once
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => approve("session")}>
            Approve session
          </button>
          <button className="btn-danger" disabled={busy} onClick={deny}>
            Deny
          </button>
        </div>
      )}

      {outcome === null && resolved && (
        <div className="result result-blocked">This request was already {detail.status}.</div>
      )}
      {outcome?.kind === "approved" && (
        <div className="result result-allowed">
          Approved ({outcome.approvalType}). Session id: <span className="mono">{outcome.sessionId}</span>.
          You can return to the app.
        </div>
      )}
      {outcome?.kind === "denied" && <div className="result result-blocked">Request denied.</div>}
      {outcome?.kind === "error" && <div className="result result-blocked">{outcome.message}</div>}
    </div>
  );
}
