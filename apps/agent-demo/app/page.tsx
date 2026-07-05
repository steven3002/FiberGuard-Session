"use client";

import { useMemo, useState } from "react";
import { FiberGuard, FiberGuardError, type AuditEntry, type Session } from "@fiberguard/session";
import { AuditPanel, ResultPanel, type PanelResult } from "../lib/ui";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
const APP_ID = "agent-demo";
const ORIGIN = "http://localhost:3001";
const DEMO_INVOICE = "fibt1qdemoinvoiceagentpayable00000000";

export default function AgentDemo() {
  const guard = useMemo(
    () => new FiberGuard({ gatewayUrl: GATEWAY, appId: APP_ID, origin: ORIGIN }),
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("no session");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [invoice, setInvoice] = useState(DEMO_INVOICE);
  const [result, setResult] = useState<PanelResult | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  async function refreshAudit() {
    try {
      setAudit(await guard.getAudit({ appId: APP_ID }));
    } catch {
      /* ignore */
    }
  }

  async function requestSession() {
    setBusy(true);
    setResult(null);
    try {
      const handle = await guard.requestSession({
        permissions: [
          { action: "payment.pay_invoice", asset: "RUSD", maxAmountPerPayment: "1", dailyLimit: "5", expiresIn: "10m" },
          { action: "payment.read_own" },
        ],
      });
      setSession(handle);
      if (handle.isActive) {
        setStatus("active");
        setApprovalUrl(null);
      } else {
        setStatus("pending approval");
        setApprovalUrl(handle.approvalUrl ?? null);
        handle
          .waitForApproval({ intervalMs: 1500, timeoutMs: 300_000 })
          .then(() => {
            setStatus(handle.isActive ? "active" : handle.status);
            if (handle.isActive) setApprovalUrl(null);
          })
          .catch(() => setStatus("approval timed out"));
      }
    } catch (error) {
      const reason = error instanceof FiberGuardError ? error.reason : undefined;
      setResult({ decision: "error", message: `${reason ?? ""} ${(error as Error).message}`.trim() });
    } finally {
      setBusy(false);
      await refreshAudit();
    }
  }

  async function pay(amount: string) {
    if (!session) return;
    setBusy(true);
    const outcome = await session.payInvoice({ invoice, asset: "RUSD", amount, reason: `Agent pays ${amount} RUSD` });
    setBusy(false);
    if (outcome.decision === "allowed") {
      setResult({ decision: "allowed", title: `Paid ${amount} RUSD`, lines: [`payment_hash: ${outcome.paymentHash}`] });
    } else {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    }
    await refreshAudit();
  }

  async function openChannel() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.tryAction("channel.open");
    setBusy(false);
    if (outcome.decision === "blocked") {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    } else {
      setResult({ decision: "allowed", title: "channel.open (unexpected — should be blocked)", lines: [] });
    }
    await refreshAudit();
  }

  async function showSession() {
    if (!session?.sessionId) return;
    const current = await guard.getCurrentSession(session.sessionId);
    if (current) {
      setResult({
        decision: "allowed",
        title: "Current session",
        lines: [
          `id: ${current.sessionId}`,
          `expires: ${current.expiresAt ?? "—"}`,
          `permissions: ${current.permissions.map((permission) => permission.action).join(", ")}`,
        ],
      });
    } else {
      setResult({ decision: "blocked", reason: "SESSION_NOT_FOUND" });
    }
  }

  const active = session?.isActive ?? false;

  return (
    <>
      <div className="card">
        <h1>AI Agent Demo</h1>
        <p className="subtle">
          Spend-limited RUSD payments. This app ({ORIGIN}) talks to the gateway ({GATEWAY}) only
          through <span className="mono">@fiberguard/session</span>.
        </p>
        <p>
          Session status: <span className="badge">{status}</span>
        </p>
        {approvalUrl && (
          <p className="subtle">
            Approval required —{" "}
            <a href={approvalUrl} target="_blank" rel="noreferrer">
              open the approval screen
            </a>
            , approve there, and this page updates automatically.
          </p>
        )}

        <div className="actions">
          <button className="btn-primary" disabled={busy} onClick={requestSession}>
            Request payment session
          </button>
          <button disabled={busy || !active} onClick={() => pay("0.5")}>
            Pay 0.5 RUSD
          </button>
          <button disabled={busy || !active} onClick={() => pay("100")}>
            Try pay 100 RUSD
          </button>
          <button disabled={busy || !active} onClick={openChannel}>
            Try open channel
          </button>
          <button disabled={!active} onClick={showSession}>
            Show session
          </button>
        </div>

        <div className="field">
          <label>
            Invoice to pay:
            <input value={invoice} onChange={(event) => setInvoice(event.target.value)} />
          </label>
          <span className="subtle">Paste an invoice from the Merchant demo, or use the default.</span>
        </div>

        <ResultPanel result={result} />
      </div>

      <div className="card">
        <div className="row-between">
          <h2>Audit — this app</h2>
          <button className="btn-small" onClick={refreshAudit}>
            Refresh
          </button>
        </div>
        <AuditPanel events={audit} />
      </div>
    </>
  );
}
