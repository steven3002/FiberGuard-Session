import { describe, expect, it } from "vitest";
import { parsePolicy } from "@fiberguard/policy";
import { buildApp, policyOrigins } from "../src/server/app.js";
import { ConfigError, resolveConfig } from "../src/config.js";

const policy = parsePolicy(`
apps:
  agent-demo:
    name: "Agent Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "payment.pay_invoice"
        assets: ["RUSD"]
        max_amount_per_payment: "1"
  dashboard-demo:
    name: "Dashboard"
    origins: ["http://localhost:3003"]
    allow:
      - action: "node.read"
`);

const config = resolveConfig({
  upstream: "http://127.0.0.1:8227",
  port: "8787",
  policy: "examples/fiberguard.yml",
  data: ".fiberguard",
});

describe("buildApp", () => {
  it("serves /healthz", async () => {
    const app = await buildApp({ config, policy });
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", apps: 2 });
    await app.close();
  });

  it("allows CORS for policy origins and rejects others", async () => {
    const app = await buildApp({ config, policy });

    const allowed = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: "http://localhost:3001" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3001");

    const denied = await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { origin: "http://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });

  it("collects unique origins across apps", () => {
    expect(policyOrigins(policy)).toEqual(["http://localhost:3001", "http://localhost:3003"]);
  });
});

describe("resolveConfig", () => {
  it("coerces and validates options", () => {
    expect(config.port).toBe(8787);
    expect(config.upstreamUrl).toBe("http://127.0.0.1:8227");
  });

  it("rejects invalid ports", () => {
    expect(() =>
      resolveConfig({ upstream: "http://127.0.0.1:8227", port: "0", policy: "p.yml", data: "d" }),
    ).toThrow(ConfigError);
    expect(() =>
      resolveConfig({ upstream: "http://127.0.0.1:8227", port: "abc", policy: "p.yml", data: "d" }),
    ).toThrow(ConfigError);
  });

  it("rejects non-http upstreams", () => {
    expect(() =>
      resolveConfig({ upstream: "ftp://node", port: "8787", policy: "p.yml", data: "d" }),
    ).toThrow(ConfigError);
  });
});
