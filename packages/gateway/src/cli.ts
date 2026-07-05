#!/usr/bin/env node
import { Command } from "commander";
import { loadPolicy, PolicyError } from "@fiberguard/policy";
import { ConfigError, resolveConfig, type RawStartOptions } from "./config.js";
import { buildApp } from "./server/app.js";

const program = new Command();

program
  .name("fiberguard")
  .description("Scoped, revocable, spend-limited payment sessions for Fiber apps");

program
  .command("start")
  .description("Start the FiberGuard gateway")
  .requiredOption("--policy <path>", "path to the app permission policy file (YAML)")
  .option("--upstream <url>", "Fiber node JSON-RPC endpoint", "http://127.0.0.1:8227")
  .option("--port <port>", "FiberGuard local gateway port", "8787")
  .option("--data <dir>", "directory for session, spend, and audit state", ".fiberguard")
  .action(async (options: RawStartOptions) => {
    try {
      await start(options);
    } catch (error) {
      if (error instanceof ConfigError || error instanceof PolicyError) {
        console.error(`fiberguard: ${error.message}`);
      } else {
        console.error("fiberguard: failed to start", error);
      }
      process.exitCode = 1;
    }
  });

async function start(options: RawStartOptions): Promise<void> {
  const config = resolveConfig(options);
  const policy = loadPolicy(config.policyPath);

  const app = await buildApp({ config, policy, logger: false });
  await app.listen({ port: config.port, host: "127.0.0.1" });

  const appIds = Object.keys(policy.apps);
  console.log(`FiberGuard gateway listening on http://127.0.0.1:${config.port}`);
  console.log(`Upstream Fiber RPC: ${config.upstreamUrl}`);
  console.log(`Policy: ${config.policyPath} (${appIds.length} apps: ${appIds.join(", ")})`);
  console.log(`Data directory: ${config.dataDir}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`Received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

program.parseAsync(process.argv);
