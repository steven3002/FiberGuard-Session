"use client";

import { useMemo, useState } from "react";
import { FiberGuard, FiberGuardError, type AuditEntry, type Session } from "@fiberguard/session";
import { AuditPanel, ResultPanel, type PanelResult } from "../lib/ui";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
const APP_ID = "dashboard-demo";
const ORIGIN = "http://localhost:3003";

export default function DashboardDemo() {
  const guard = useMemo(
    () => new FiberGuard({ gatewayUrl: GATEWAY, appId: APP_ID, origin: ORIGIN }),
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState("no session");
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
        permissions: [
          { action: "node.read" },
          { action: "channels.read_summary" },
          { action: "payment.read_own" },
        ],
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

  async function readNode() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.getNodeInfo();
    setBusy(false);
    if (outcome.decision === "allowed") {
      setResult({
        decision: "allowed",
        title: "Node info (safe summary)",
        lines: Object.entries(outcome.node).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
      });
    } else {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    }
    await refreshAudit();
  }

  async function readChannels() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.getChannelSummary();
    setBusy(false);
    if (outcome.decision === "allowed") {
      setResult({
        decision: "allowed",
        title: "Channel summary",
        lines: [
          `total: ${outcome.totalChannels}`,
          `open: ${outcome.openChannels}`,
          `closed: ${outcome.closedChannels}`,
        ],
      });
    } else {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    }
    await refreshAudit();
  }

  async function tryCloseChannel() {
    if (!session) return;
    setBusy(true);
    const outcome = await session.tryAction("channel.close");
    setBusy(false);
    if (outcome.decision === "blocked") {
      setResult({ decision: "blocked", reason: outcome.reason, details: outcome.details });
    } else {
      setResult({ decision: "allowed", title: "channel.close (unexpected — should be blocked)", lines: [] });
    }
    await refreshAudit();
  }

  const active = session?.isActive ?? false;

  return (
    <>
      <div className="card">
        <h1>Read-only Dashboard Demo</h1>
        <p className="subtle">
          Read node and channel data, no write authority. This app ({ORIGIN}) talks to the gateway
          ({GATEWAY}) only through <span className="mono">@fiberguard/session</span>.
        </p>
        <p>
          Session status: <span className="badge">{status}</span>
        </p>

        <div className="actions">
          <button className="btn-primary" disabled={busy} onClick={start}>
            Start session
          </button>
          <button disabled={busy || !active} onClick={readNode}>
            Read node info
          </button>
          <button disabled={busy || !active} onClick={readChannels}>
            Read channel summary
          </button>
          <button disabled={busy || !active} onClick={tryCloseChannel}>
            Try close channel
          </button>
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
