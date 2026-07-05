import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  /**
   * Directory of the built approval UI (Next.js static export `out/`). When set
   * and present, the gateway serves it — the approval page for `/approve` and
   * `/approve/:id`, everything else (assets, `/_next/*`) as static files.
   */
  approvalUiDir?: string;
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

/** The approval UI's build output, resolved relative to this file (cwd-independent). */
export function defaultApprovalUiDir(): string {
  return fileURLToPath(new URL("../../../../apps/approval-ui/out", import.meta.url));
}

/**
 * Serves the approval UI static export. Assets (`/_next/*`, favicon, the console
 * page at `/`) come straight from disk; the single approve screen is served for
 * `/approve` and `/approve/:id` so the browser can read the request id from the
 * path (the id is not known at export time).
 */
async function registerApprovalUi(app: FastifyInstance, uiDir: string): Promise<void> {
  await app.register(fastifyStatic, { root: uiDir, prefix: "/" });
  const approveFile = existsSync(join(uiDir, "approve.html")) ? "approve.html" : "approve/index.html";
  app.get("/approve", (_request, reply) => reply.sendFile(approveFile));
  app.get("/approve/:sessionRequestId", (_request, reply) => reply.sendFile(approveFile));
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

  if (options.approvalUiDir !== undefined && existsSync(join(options.approvalUiDir, "index.html"))) {
    await registerApprovalUi(app, options.approvalUiDir);
  }

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    gatewayContext: GatewayRuntime;
  }
}
