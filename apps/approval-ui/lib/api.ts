// Same-origin when served by the gateway; set NEXT_PUBLIC_GATEWAY_URL for `next dev`.
const BASE = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "";

export interface Permission {
  action: string;
  asset?: string;
  max_amount_per_payment?: string;
  max_amount_per_invoice?: string;
  daily_limit?: string;
}

export interface RequestDetail {
  session_request_id: string;
  app_id: string;
  app_name: string;
  origin: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
  expires_in_ms: number;
  permissions: Permission[];
  denied_actions: string[];
  session_id?: string;
}

export interface ActiveSession {
  session_id: string;
  app_id: string;
  app_name: string;
  origin: string;
  status: string;
  approval_type: "session" | "once";
  created_at: string;
  expires_at: string;
  permissions: Permission[];
}

export interface AuditEvent {
  event: string;
  app_id?: string;
  origin?: string;
  session_id?: string;
  action?: string;
  asset?: string;
  requested_amount?: string;
  decision: "allowed" | "blocked";
  reason: string;
  timestamp: string;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, body };
}

export const api = {
  getRequest: (id: string) =>
    request<RequestDetail>(`/session/request/${encodeURIComponent(id)}`),
  getPending: () => request<{ requests: RequestDetail[] }>(`/session/pending`),
  getActive: () => request<{ sessions: ActiveSession[] }>(`/session/active`),
  getAudit: (appId?: string) =>
    request<{ events: AuditEvent[] }>(
      `/audit${appId ? `?app_id=${encodeURIComponent(appId)}` : ""}`,
    ),
  approve: (id: string, approvalType: "session" | "once") =>
    request<{ status: string; session_id?: string; reason?: string }>(`/session/approve`, {
      method: "POST",
      body: JSON.stringify({ session_request_id: id, approval_type: approvalType }),
    }),
  deny: (id: string, reason?: string) =>
    request<{ status: string }>(`/session/deny`, {
      method: "POST",
      body: JSON.stringify({ session_request_id: id, ...(reason ? { reason } : {}) }),
    }),
  revoke: (sessionId: string) =>
    request<{ status: string; session_id?: string }>(`/session/revoke`, {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }),
};

const ACTION_LABELS: Record<string, string> = {
  "payment.pay_invoice": "Pay Fiber invoices",
  "invoice.create": "Create invoices",
  "payment.read_own": "Read own payments",
  "payments.read_all": "Read all payment history",
  "node.read": "Read node info",
  "channels.read_summary": "Read channel summary",
  "channel.open": "Open channels",
  "channel.close": "Close channels",
  "peer.connect": "Connect peers",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function describePermission(permission: Permission): string[] {
  const lines: string[] = [];
  if (permission.asset) lines.push(`Asset: ${permission.asset}`);
  if (permission.max_amount_per_payment)
    lines.push(`Max per payment: ${permission.max_amount_per_payment}`);
  if (permission.max_amount_per_invoice)
    lines.push(`Max per invoice: ${permission.max_amount_per_invoice}`);
  if (permission.daily_limit) lines.push(`Daily limit: ${permission.daily_limit}`);
  return lines;
}

export function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000} minutes`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
