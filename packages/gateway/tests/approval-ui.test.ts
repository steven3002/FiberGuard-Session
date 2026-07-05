import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPolicy } from "@fiberguard/policy";
import { buildApp } from "../src/server/app.js";
import { resolveConfig } from "../src/config.js";

const EXAMPLE_POLICY = fileURLToPath(new URL("../../../examples/fiberguard.yml", import.meta.url));
const policy = loadPolicy(EXAMPLE_POLICY);

function config(dataDir: string) {
  return resolveConfig({
    upstream: "http://127.0.0.1:8227",
    port: "8787",
    policy: EXAMPLE_POLICY,
    data: dataDir,
  });
}

function fakeExport(): string {
  const uiDir = mkdtempSync(join(tmpdir(), "fiberguard-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<html><body data-page='console'>console</body></html>");
  writeFileSync(join(uiDir, "approve.html"), "<html><body data-page='approve'>approve</body></html>");
  mkdirSync(join(uiDir, "_next", "static"), { recursive: true });
  writeFileSync(join(uiDir, "_next", "static", "app.js"), "console.log('ui');");
  return uiDir;
}

describe("approval UI static serving", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      config: config(mkdtempSync(join(tmpdir(), "fiberguard-ui-data-"))),
      policy,
      approvalUiDir: fakeExport(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves the console page at /", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("data-page='console'");
  });

  it("serves the approve page for /approve and /approve/:id", async () => {
    for (const url of ["/approve", "/approve/sr_abcdefgh"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("data-page='approve'");
    }
  });

  it("serves static assets under /_next", async () => {
    const response = await app.inject({ method: "GET", url: "/_next/static/app.js" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("console.log");
  });

  it("keeps the API routes working alongside the static handler", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/session/active" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/audit" })).statusCode).toBe(200);
  });
});

describe("approval UI serving skipped when unbuilt", () => {
  it("does not register the UI when the directory has no index.html", async () => {
    const app = await buildApp({
      config: config(mkdtempSync(join(tmpdir(), "fiberguard-ui-data2-"))),
      policy,
      approvalUiDir: mkdtempSync(join(tmpdir(), "fiberguard-ui-empty-")),
    });
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
    // API still works.
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    await app.close();
  });
});
