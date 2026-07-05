import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { join } from "node:path";
import type { Policy } from "@fiberguard/policy";
import type { GatewayConfig } from "../config.js";
import { AuditWriter } from "../core/audit/writer.js";
import { AuditReader } from "../core/audit/reader.js";
import { SessionStore } from "../core/sessions/store.js";
import { SpendLedger } from "../core/spend/ledger.js";
import { OwnershipIndex } from "../core/ownership/index.js";
import { FiberClient } from "../upstream/fiber.js";
import { healthRoutes } from "./routes/health.js";
import { sessionRoutes } from "./routes/session.js";
import { auditRoutes } from "./routes/audit.js";
import { intentRoutes } from "./routes/intent.js";
import { readRoutes } from "./routes/read.js";

export interface AppOptions {
  config: GatewayConfig;
  policy: Policy;
  logger?: boolean;
}

export interface GatewayRuntime {
  config: GatewayConfig;
  policy: Policy;
  sessionStore: SessionStore;
  spendLedger: SpendLedger;
  ownership: OwnershipIndex;
  fiber: FiberClient;
  audit: AuditWriter;
  auditReader: AuditReader;
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

  const auditPath = join(options.config.dataDir, "audit.jsonl");
  const runtime: GatewayRuntime = {
    config: options.config,
    policy: options.policy,
    sessionStore: new SessionStore(options.config.dataDir),
    spendLedger: new SpendLedger(options.config.dataDir),
    ownership: new OwnershipIndex(options.config.dataDir),
    fiber: new FiberClient(options.config.upstreamUrl),
    audit: new AuditWriter(auditPath),
    auditReader: new AuditReader(auditPath),
  };

  await app.register(cors, {
    origin: policyOrigins(options.policy),
    methods: ["GET", "POST"],
  });

  app.decorate("gatewayContext", runtime);

  await app.register(healthRoutes);
  await app.register(sessionRoutes);
  await app.register(intentRoutes);
  await app.register(readRoutes);
  await app.register(auditRoutes);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    gatewayContext: GatewayRuntime;
  }
}
