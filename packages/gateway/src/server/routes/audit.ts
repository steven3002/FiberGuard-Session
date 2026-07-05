import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { blockedBody } from "../responses.js";

const auditQuerySchema = z
  .object({
    app_id: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })
  .strict();

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/audit", async (request, reply) => {
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(
        blockedBody("INVALID_REQUEST", {
          issues: parsed.error.issues.map((issue) => issue.message),
        }),
      );
    }

    const events = await app.gatewayContext.auditReader.query({
      appId: parsed.data.app_id,
      limit: parsed.data.limit,
    });
    return reply.send({ events });
  });
};
