import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  createInvoiceBodySchema,
  IMPLEMENTED_ACTIONS,
  payInvoiceBodySchema,
  restrictedActionBodySchema,
  type FiberGuardAction,
} from "@fiberguard/shared";
import { runIntent, type PipelineContext } from "../../core/decision/pipeline.js";
import { blockedBody } from "../responses.js";

export function pipelineContext(app: FastifyInstance): PipelineContext {
  const runtime = app.gatewayContext;
  return {
    policy: runtime.policy,
    sessionStore: runtime.sessionStore,
    spendLedger: runtime.spendLedger,
    ownership: runtime.ownership,
    fiber: runtime.fiber,
    audit: runtime.audit,
  };
}

export const intentRoutes: FastifyPluginAsync = async (app) => {
  const ctx = pipelineContext(app);
  const { audit } = app.gatewayContext;

  async function rejectMalformed(
    reply: FastifyReply,
    action: FiberGuardAction | undefined,
    issues: string[],
  ): Promise<FastifyReply> {
    await audit.record({
      event: "intent_blocked",
      ...(action !== undefined ? { action } : {}),
      decision: "blocked",
      reason: "INVALID_REQUEST",
      details: { issues },
    });
    return reply.code(400).send(blockedBody("INVALID_REQUEST"));
  }

  app.post("/intent/pay-invoice", async (request, reply) => {
    const parsed = payInvoiceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectMalformed(reply, "payment.pay_invoice", parsed.error.issues.map((i) => i.message));
    }
    const body = parsed.data;
    const result = await runIntent(ctx, {
      action: "payment.pay_invoice",
      appId: body.app_id,
      origin: body.origin,
      sessionId: body.session_id,
      asset: body.asset,
      amount: body.amount,
      invoice: body.invoice,
    });
    return reply.code(result.httpStatus).send(result.payload);
  });

  app.post("/intent/create-invoice", async (request, reply) => {
    const parsed = createInvoiceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectMalformed(reply, "invoice.create", parsed.error.issues.map((i) => i.message));
    }
    const body = parsed.data;
    const result = await runIntent(ctx, {
      action: "invoice.create",
      appId: body.app_id,
      origin: body.origin,
      sessionId: body.session_id,
      asset: body.asset,
      amount: body.amount,
      ...(body.description !== undefined ? { description: body.description } : {}),
    });
    return reply.code(result.httpStatus).send(result.payload);
  });

  // Generic path for NON-implemented actions only (channel.open, channel.close,
  // peer.connect, payments.read_all). It always terminates at the decision
  // pipeline as a block and never forwards. Implemented actions are redirected
  // to their dedicated endpoints via INVALID_REQUEST.
  app.post("/intent/action", async (request, reply) => {
    const parsed = restrictedActionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectMalformed(reply, undefined, parsed.error.issues.map((i) => i.message));
    }
    const body = parsed.data;
    if (IMPLEMENTED_ACTIONS.has(body.action)) {
      const detail = `action "${body.action}" has a dedicated endpoint; /intent/action is for restricted actions only`;
      await audit.record({
        event: "intent_blocked",
        app_id: body.app_id,
        origin: body.origin,
        session_id: body.session_id,
        action: body.action,
        decision: "blocked",
        reason: "INVALID_REQUEST",
        details: { detail },
      });
      return reply.code(400).send(blockedBody("INVALID_REQUEST", { detail }));
    }
    const result = await runIntent(ctx, {
      action: body.action,
      appId: body.app_id,
      origin: body.origin,
      sessionId: body.session_id,
    });
    return reply.code(result.httpStatus).send(result.payload);
  });
};
