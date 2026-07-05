import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { join } from "node:path";
import type { Policy } from "@fiberguard/policy";
import type { GatewayConfig } from "../config.js";
import { AuditWriter } from "../core/audit/writer.js";
import { SessionStore } from "../core/sessions/store.js";
import { healthRoutes } from "./routes/health.js";
import { sessionRoutes } from "./routes/session.js";

export interface AppOptions {
  config: GatewayConfig;
  policy: Policy;
  logger?: boolean;
}

export interface GatewayRuntime {
  config: GatewayConfig;
  policy: Policy;
  sessionStore: SessionStore;
  audit: AuditWriter;
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

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  const runtime: GatewayRuntime = {
    config: options.config,
    policy: options.policy,
    sessionStore: new SessionStore(options.config.dataDir),
    audit: new AuditWriter(join(options.config.dataDir, "audit.jsonl")),
  };

  await app.register(cors, {
    origin: policyOrigins(options.policy),
    methods: ["GET", "POST"],
  });

  app.decorate("gatewayContext", runtime);

  await app.register(healthRoutes);
  await app.register(sessionRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    gatewayContext: GatewayRuntime;
  }
}
