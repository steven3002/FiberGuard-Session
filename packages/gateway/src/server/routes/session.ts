import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import {
  approveSessionBodySchema,
  denySessionBodySchema,
  revokeSessionBodySchema,
  sessionIdSchema,
  sessionRequestBodySchema,
} from "@fiberguard/shared";
import { evaluateSessionRequest, type Policy } from "@fiberguard/policy";
import {
  effectiveStatus,
  SessionStoreError,
  type StoredSessionRequest,
} from "../../core/sessions/store.js";
import { blockedBody } from "../responses.js";

function sendStoreError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof SessionStoreError) {
    switch (error.code) {
      case "REQUEST_NOT_FOUND":
      case "SESSION_NOT_FOUND":
        return reply.code(404).send(blockedBody("SESSION_NOT_FOUND", { detail: error.message }));
      case "REQUEST_ALREADY_RESOLVED":
        return reply.code(409).send(blockedBody("INVALID_REQUEST", { detail: error.message }));
    }
  }
  throw error;
}

/** Shape consumed by the approval UI to render the §14 approval screen. */
function requestView(record: StoredSessionRequest, policy: Policy) {
  const app = policy.apps[record.app_id];
  return {
    session_request_id: record.id,
    app_id: record.app_id,
    app_name: app?.name ?? record.app_id,
    origin: record.origin,
    status: record.status,
    created_at: record.created_at,
    expires_in_ms: record.expires_in_ms,
    permissions: record.granted_permissions,
    denied_actions: app?.deny.map((rule) => rule.action) ?? [],
    // Present once approved so the SDK's waitForApproval() can learn the session id.
    ...(record.session_id !== undefined ? { session_id: record.session_id } : {}),
  };
}

const currentSessionQuerySchema = z.object({ session_id: sessionIdSchema });

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const { policy, config, sessionStore, audit } = app.gatewayContext;

  app.post("/session/request", async (request, reply) => {
    const parsed = sessionRequestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      await audit.record({
        event: "session_requested",
        decision: "blocked",
        reason: "INVALID_REQUEST",
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      });
      return reply.code(400).send(blockedBody("INVALID_REQUEST"));
    }
    const body = parsed.data;

    const evaluation = evaluateSessionRequest(
      policy,
      body.app_id,
      body.origin,
      body.requested_permissions,
    );
    if (!evaluation.ok) {
      await audit.record({
        event: "session_requested",
        app_id: body.app_id,
        origin: body.origin,
        decision: "blocked",
        reason: evaluation.reason,
        ...(evaluation.details !== undefined ? { details: evaluation.details } : {}),
      });
      return reply.code(403).send(blockedBody(evaluation.reason, evaluation.details));
    }

    if (evaluation.requiresApproval) {
      const record = await sessionStore.createRequest({
        appId: body.app_id,
        origin: body.origin,
        requestedPermissions: body.requested_permissions,
        grantedPermissions: evaluation.permissions,
        expiresInMs: evaluation.expiresInMs,
        now: new Date(),
      });
      await audit.record({
        event: "session_requested",
        app_id: body.app_id,
        origin: body.origin,
        decision: "allowed",
        reason: "APPROVAL_REQUIRED",
        details: { session_request_id: record.id },
      });
      return reply.send({
        status: "pending_approval",
        session_request_id: record.id,
        approval_url: `http://localhost:${config.port}/approve/${record.id}`,
      });
    }

    const session = await sessionStore.createSession({
      appId: body.app_id,
      origin: body.origin,
      permissions: evaluation.permissions,
      expiresInMs: evaluation.expiresInMs,
      approvalType: "session",
      now: new Date(),
    });
    await audit.record({
      event: "session_approved",
      app_id: body.app_id,
      origin: body.origin,
      session_id: session.id,
      decision: "allowed",
      reason: "WITHIN_POLICY",
      details: { auto_approved: true },
    });
    return reply.send({
      status: "approved",
      session_id: session.id,
      expires_at: session.expires_at,
    });
  });

  app.post("/session/approve", async (request, reply) => {
    const parsed = approveSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(blockedBody("INVALID_REQUEST"));
    }
    try {
      const session = await sessionStore.approveRequest(
        parsed.data.session_request_id,
        parsed.data.approval_type,
        new Date(),
      );
      await audit.record({
        event: "session_approved",
        app_id: session.app_id,
        origin: session.origin,
        session_id: session.id,
        decision: "allowed",
        reason: "WITHIN_POLICY",
        details: {
          approval_type: parsed.data.approval_type,
          session_request_id: parsed.data.session_request_id,
        },
      });
      return await reply.send({
        status: "approved",
        session_id: session.id,
        expires_at: session.expires_at,
      });
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.post("/session/deny", async (request, reply) => {
    const parsed = denySessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(blockedBody("INVALID_REQUEST"));
    }
    try {
      const record = await sessionStore.denyRequest(
        parsed.data.session_request_id,
        new Date(),
        parsed.data.reason,
      );
      await audit.record({
        event: "session_denied",
        app_id: record.app_id,
        origin: record.origin,
        decision: "blocked",
        reason: "APPROVAL_REQUIRED",
        details: {
          session_request_id: record.id,
          ...(record.deny_reason !== undefined ? { user_reason: record.deny_reason } : {}),
        },
      });
      return await reply.send({ status: "denied" });
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.post("/session/revoke", async (request, reply) => {
    const parsed = revokeSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(blockedBody("INVALID_REQUEST"));
    }
    try {
      const { session, alreadyRevoked } = await sessionStore.revokeSession(
        parsed.data.session_id,
        new Date(),
      );
      if (!alreadyRevoked) {
        await audit.record({
          event: "session_revoked",
          app_id: session.app_id,
          origin: session.origin,
          session_id: session.id,
          decision: "allowed",
          reason: "WITHIN_POLICY",
        });
      }
      return await reply.send({ status: "revoked", session_id: session.id });
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.get("/session/current", async (request, reply) => {
    const parsed = currentSessionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(blockedBody("INVALID_REQUEST"));
    }
    const session = await sessionStore.getSession(parsed.data.session_id);
    if (session === null) {
      return reply
        .code(404)
        .send(blockedBody("SESSION_NOT_FOUND", { session_id: parsed.data.session_id }));
    }
    return reply.send({
      session_id: session.id,
      app_id: session.app_id,
      status: effectiveStatus(session, new Date()),
      expires_at: session.expires_at,
      permissions: session.permissions,
    });
  });

  app.get("/session/pending", async (_request, reply) => {
    const records = await sessionStore.listPendingRequests();
    return reply.send({ requests: records.map((record) => requestView(record, policy)) });
  });

  app.get("/session/request/:session_request_id", async (request, reply) => {
    const { session_request_id } = request.params as { session_request_id: string };
    const record = await sessionStore.getRequest(session_request_id);
    if (record === null) {
      return reply.code(404).send(blockedBody("SESSION_NOT_FOUND", { session_request_id }));
    }
    return reply.send(requestView(record, policy));
  });
};
