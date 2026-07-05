import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Policy } from "@fiberguard/policy";
import type { GatewayConfig } from "../config.js";
import { healthRoutes } from "./routes/health.js";

export interface AppContext {
  config: GatewayConfig;
  policy: Policy;
  logger?: boolean;
}

/** All origins any policy app is allowed to call from; used for CORS. */
export function policyOrigins(policy: Policy): string[] {
  const origins = new Set<string>();
  for (const app of Object.values(policy.apps)) {
    for (const origin of app.origins) {
      origins.add(origin);
    }
  }
  return [...origins];
}

export async function buildApp(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: context.logger ?? false });

  await app.register(cors, {
    origin: policyOrigins(context.policy),
    methods: ["GET", "POST"],
  });

  app.decorate("gatewayContext", context);

  await app.register(healthRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    gatewayContext: AppContext;
  }
}
