#!/usr/bin/env node
import { startMockNode } from "./server.js";

function parsePort(argv: string[]): number {
  const index = argv.indexOf("--port");
  if (index === -1) {
    return 8227;
  }
  const raw = argv[index + 1];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`fiber-mock: invalid --port ${raw ?? "(missing)"}`);
    process.exit(1);
  }
  return value;
}

const [command, ...rest] = process.argv.slice(2);
if (command !== "start") {
  console.error("usage: fiber-mock start [--port 8227]");
  process.exit(1);
}

startMockNode({ port: parsePort(rest) })
  .then((handle) => {
    console.log(`fiber-mock JSON-RPC node listening on ${handle.url}`);
    console.log(`Seeded channels: ${handle.state.channels.length} (2 ready, 1 closed)`);
    const shutdown = () => {
      void handle.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((error) => {
    console.error("fiber-mock: failed to start", error);
    process.exit(1);
  });
