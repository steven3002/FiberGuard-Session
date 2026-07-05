import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({
    status: "ok",
    service: "fiberguard-gateway",
    apps: Object.keys(app.gatewayContext.policy.apps).length,
  }));
};
