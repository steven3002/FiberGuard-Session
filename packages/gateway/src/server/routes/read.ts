import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { sessionIdSchema, type FiberGuardAction } from "@fiberguard/shared";
import { runIntent } from "../../core/decision/pipeline.js";
import { blockedBody } from "../responses.js";
import { pipelineContext } from "./intent.js";

const sessionQuerySchema = z.object({ session_id: sessionIdSchema }).strict();
const paymentHashParamSchema = z.object({
  payment_hash: z.string().regex(/^0x[0-9a-f]{64}$/i, {
    message: "must be a 0x-prefixed 32-byte payment hash",
  }),
});

/**
 * Read intents (node.read, channels.read_summary, payment.read_own) run the
 * same decision pipeline as writes. The documented API identifies the caller by
 * `session_id` alone, so app/origin are taken from the stored session; the
 * pipeline still enforces expiry, revocation, grant, and ownership.
 */
export const readRoutes: FastifyPluginAsync = async (app) => {
  const ctx = pipelineContext(app);
  const { sessionStore, audit } = app.gatewayContext;

  async function invalid(reply: FastifyReply, action: FiberGuardAction): Promise<FastifyReply> {
    await audit.record({
      event: "intent_blocked",
      action,
      decision: "blocked",
      reason: "INVALID_REQUEST",
    });
    return reply.code(400).send(blockedBody("INVALID_REQUEST"));
  }

  async function readIntent(
    reply: FastifyReply,
    sessionId: string,
    action: FiberGuardAction,
    paymentHash?: string,
  ): Promise<FastifyReply> {
    const session = await sessionStore.getSession(sessionId);
    if (session === null) {
      await audit.record({
        event: "intent_blocked",
        session_id: sessionId,
        action,
        decision: "blocked",
        reason: "SESSION_NOT_FOUND",
      });
      return reply.code(404).send(blockedBody("SESSION_NOT_FOUND", { session_id: sessionId }));
    }
    const result = await runIntent(ctx, {
      action,
      appId: session.app_id,
      origin: session.origin,
      sessionId: session.id,
      ...(paymentHash !== undefined ? { paymentHash } : {}),
    });
    return reply.code(result.httpStatus).send(result.payload);
  }

  app.get("/node/info", async (request, reply) => {
    const query = sessionQuerySchema.safeParse(request.query);
    if (!query.success) {
      return invalid(reply, "node.read");
    }
    return readIntent(reply, query.data.session_id, "node.read");
  });

  app.get("/channels/summary", async (request, reply) => {
    const query = sessionQuerySchema.safeParse(request.query);
    if (!query.success) {
      return invalid(reply, "channels.read_summary");
    }
    return readIntent(reply, query.data.session_id, "channels.read_summary");
  });

  app.get("/payments/:payment_hash", async (request, reply) => {
    const params = paymentHashParamSchema.safeParse(request.params);
    const query = sessionQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return invalid(reply, "payment.read_own");
    }
    return readIntent(reply, query.data.session_id, "payment.read_own", params.data.payment_hash);
  });
};
