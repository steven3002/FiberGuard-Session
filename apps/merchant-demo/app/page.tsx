"use client";

import { useMemo, useState } from "react";
import { FiberGuard, FiberGuardError, type AuditEntry, type Session } from "@fiberguard/session";
import { AuditPanel, ResultPanel, type PanelResult } from "../lib/ui";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
const APP_ID = "merchant-demo";
const ORIGIN = "http://localhost:3002";

export default function MerchantDemo() {
  const guard = useMemo(
    () => new FiberGuard({ gatewayUrl: GATEWAY, appId: APP_ID, origin: ORIGIN }),
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("no session");
  const [invoiceAddress, setInvoiceAddress] = useState<string | null>(null);
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

  async function start() {
    setBusy(true);
    setResult(null);
    try {
      const handle = await guard.requestSession({
        permissions: [{ action: "invoice.create" }, { action: "payment.read_own" }],
      });
      setSession(handle);
      setStatus(handle.isActive ? "active (auto-approved)" : handle.status);
    } catch (error) {
      const reason = error instanceof FiberGuardError ? error.reason : undefined;
      setResult({ decision: "error", message: `${reason ?? ""} ${(error as Error).message}`.trim() });
    } finally {
      setBusy(false);
      await refreshAudit();
    }
  }

  async function createInvoice() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.createInvoice({ asset: "RUSD", amount: "10", description: "Merchant demo invoice" });
    setBusy(false);
    if (outcome.decision === "allowed") {
      setInvoiceAddress(outcome.invoiceAddress);
      setResult({ decision: "allowed", title: "Created 10 RUSD invoice", lines: [outcome.invoiceAddress] });
    } else {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    }
    await refreshAudit();
  }

  async function trySendPayment() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.payInvoice({
      invoice: invoiceAddress ?? "fibt1someinvoicetopayxxxxxxxxxxxxxxx",
      asset: "RUSD",
      amount: "1",
    });
    setBusy(false);
    if (outcome.decision === "blocked") {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    } else {
      setResult({ decision: "allowed", title: "payment (unexpected — merchant cannot pay)", lines: [] });
    }
    await refreshAudit();
  }

  const active = session?.isActive ?? false;

  return (
    <>
      <div className="card">
        <h1>Merchant Demo</h1>
        <p className="subtle">
          Create invoices, but with NO payment authority. This app ({ORIGIN}) talks to the gateway
          ({GATEWAY}) only through <span className="mono">@fiberguard/session</span>.
        </p>
        <p>
          Session status: <span className="badge">{status}</span>
        </p>

        <div className="actions">
          <button className="btn-primary" disabled={busy} onClick={start}>
            Start session
          </button>
          <button disabled={busy || !active} onClick={createInvoice}>
            Create 10 RUSD invoice
          </button>
          <button disabled={busy || !active} onClick={trySendPayment}>
            Try send payment
          </button>
        </div>

        {invoiceAddress && (
          <div className="field">
            <label>
              Invoice address (copy into the Agent demo):
              <input readOnly value={invoiceAddress} onFocus={(event) => event.target.select()} />
            </label>
          </div>
        )}

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
