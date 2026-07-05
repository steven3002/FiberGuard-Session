import { join } from "node:path";
import type { ApprovalType, GrantedPermission, RequestedPermission } from "@fiberguard/shared";
import { JsonStore } from "../../storage/json-store.js";
import { newSessionId, newSessionRequestId } from "../../ids.js";

export interface StoredSessionRequest {
  id: string;
  app_id: string;
  origin: string;
  requested_permissions: RequestedPermission[];
  /** Policy-clamped permissions captured at request time; copied onto the session on approval. */
  granted_permissions: GrantedPermission[];
  /** Session lifetime measured from the moment of approval, not from the request. */
  expires_in_ms: number;
  status: "pending" | "approved" | "denied";
  created_at: string;
  resolved_at?: string;
  session_id?: string;
  deny_reason?: string;
}

export interface StoredSession {
  id: string;
  app_id: string;
  origin: string;
  approval_type: ApprovalType;
  status: "active" | "revoked";
  /** True once a one-shot session has performed its single allowed intent. */
  used: boolean;
  permissions: GrantedPermission[];
  created_at: string;
  expires_at: string;
  revoked_at?: string;
  session_request_id?: string;
}

export type EffectiveSessionStatus = "active" | "revoked" | "expired" | "consumed";

/**
 * Display status for /session/current. Revocation is reported ahead of expiry
 * because it is the more informative state for a user; the intent pipeline's
 * reason-code ordering (expiry first) is governed by the policy engine instead.
 */
export function effectiveStatus(session: StoredSession, now: Date): EffectiveSessionStatus {
  if (session.status === "revoked") {
    return "revoked";
  }
  if (Date.parse(session.expires_at) <= now.getTime()) {
    return "expired";
  }
  if (session.approval_type === "once" && session.used) {
    return "consumed";
  }
  return "active";
}

export type SessionStoreErrorCode =
  | "REQUEST_NOT_FOUND"
  | "REQUEST_ALREADY_RESOLVED"
  | "SESSION_NOT_FOUND";

export class SessionStoreError extends Error {
  constructor(
    public readonly code: SessionStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SessionStoreError";
  }
}

interface RequestsDocument {
  requests: Record<string, StoredSessionRequest>;
}

interface SessionsDocument {
  sessions: Record<string, StoredSession>;
}

export interface CreateRequestInput {
  appId: string;
  origin: string;
  requestedPermissions: RequestedPermission[];
  grantedPermissions: GrantedPermission[];
  expiresInMs: number;
  now: Date;
}

export interface CreateSessionInput {
  appId: string;
  origin: string;
  permissions: GrantedPermission[];
  expiresInMs: number;
  approvalType: ApprovalType;
  sessionRequestId?: string;
  now: Date;
}

/**
 * Persistence and lifecycle transitions for session requests and sessions.
 * All mutations run through an internal queue so concurrent HTTP handlers
 * cannot interleave read-modify-write cycles on the underlying documents.
 */
export class SessionStore {
  private readonly requests: JsonStore<RequestsDocument>;
  private readonly sessions: JsonStore<SessionsDocument>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.requests = new JsonStore(join(dataDir, "session-requests.json"), () => ({
      requests: {},
    }));
    this.sessions = new JsonStore(join(dataDir, "sessions.json"), () => ({ sessions: {} }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  createRequest(input: CreateRequestInput): Promise<StoredSessionRequest> {
    return this.serialize(async () => {
      const record: StoredSessionRequest = {
        id: newSessionRequestId(),
        app_id: input.appId,
        origin: input.origin,
        requested_permissions: input.requestedPermissions,
        granted_permissions: input.grantedPermissions,
        expires_in_ms: input.expiresInMs,
        status: "pending",
        created_at: input.now.toISOString(),
      };
      const document = await this.requests.read();
      document.requests[record.id] = record;
      await this.requests.write(document);
      return record;
    });
  }

  async getRequest(id: string): Promise<StoredSessionRequest | null> {
    const document = await this.requests.read();
    return document.requests[id] ?? null;
  }

  async listPendingRequests(): Promise<StoredSessionRequest[]> {
    const document = await this.requests.read();
    return Object.values(document.requests)
      .filter((record) => record.status === "pending")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  approveRequest(id: string, approvalType: ApprovalType, now: Date): Promise<StoredSession> {
    return this.serialize(async () => {
      const document = await this.requests.read();
      const record = document.requests[id];
      if (record === undefined) {
        throw new SessionStoreError("REQUEST_NOT_FOUND", `session request ${id} not found`);
      }
      if (record.status !== "pending") {
        throw new SessionStoreError(
          "REQUEST_ALREADY_RESOLVED",
          `session request ${id} is already ${record.status}`,
        );
      }

      const session = await this.insertSession({
        appId: record.app_id,
        origin: record.origin,
        permissions: record.granted_permissions,
        expiresInMs: record.expires_in_ms,
        approvalType,
        sessionRequestId: record.id,
        now,
      });

      record.status = "approved";
      record.resolved_at = now.toISOString();
      record.session_id = session.id;
      await this.requests.write(document);
      return session;
    });
  }

  denyRequest(id: string, now: Date, reason?: string): Promise<StoredSessionRequest> {
    return this.serialize(async () => {
      const document = await this.requests.read();
      const record = document.requests[id];
      if (record === undefined) {
        throw new SessionStoreError("REQUEST_NOT_FOUND", `session request ${id} not found`);
      }
      if (record.status !== "pending") {
        throw new SessionStoreError(
          "REQUEST_ALREADY_RESOLVED",
          `session request ${id} is already ${record.status}`,
        );
      }
      record.status = "denied";
      record.resolved_at = now.toISOString();
      if (reason !== undefined) {
        record.deny_reason = reason;
      }
      await this.requests.write(document);
      return record;
    });
  }

  createSession(input: CreateSessionInput): Promise<StoredSession> {
    return this.serialize(() => this.insertSession(input));
  }

  private async insertSession(input: CreateSessionInput): Promise<StoredSession> {
    const session: StoredSession = {
      id: newSessionId(),
      app_id: input.appId,
      origin: input.origin,
      approval_type: input.approvalType,
      status: "active",
      used: false,
      permissions: input.permissions,
      created_at: input.now.toISOString(),
      expires_at: new Date(input.now.getTime() + input.expiresInMs).toISOString(),
      ...(input.sessionRequestId !== undefined
        ? { session_request_id: input.sessionRequestId }
        : {}),
    };
    const document = await this.sessions.read();
    document.sessions[session.id] = session;
    await this.sessions.write(document);
    return session;
  }

  async getSession(id: string): Promise<StoredSession | null> {
    const document = await this.sessions.read();
    return document.sessions[id] ?? null;
  }

  revokeSession(
    id: string,
    now: Date,
  ): Promise<{ session: StoredSession; alreadyRevoked: boolean }> {
    return this.serialize(async () => {
      const document = await this.sessions.read();
      const session = document.sessions[id];
      if (session === undefined) {
        throw new SessionStoreError("SESSION_NOT_FOUND", `session ${id} not found`);
      }
      if (session.status === "revoked") {
        return { session, alreadyRevoked: true };
      }
      session.status = "revoked";
      session.revoked_at = now.toISOString();
      await this.sessions.write(document);
      return { session, alreadyRevoked: false };
    });
  }

  markSessionUsed(id: string): Promise<StoredSession> {
    return this.serialize(async () => {
      const document = await this.sessions.read();
      const session = document.sessions[id];
      if (session === undefined) {
        throw new SessionStoreError("SESSION_NOT_FOUND", `session ${id} not found`);
      }
      session.used = true;
      await this.sessions.write(document);
      return session;
    });
  }
}
