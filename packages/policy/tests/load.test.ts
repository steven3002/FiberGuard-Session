import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPolicy, parsePolicy, PolicyError } from "../src/index.js";
import { FIXTURE_YAML } from "./fixture.js";

describe("parsePolicy", () => {
  it("parses the full example policy", () => {
    const policy = parsePolicy(FIXTURE_YAML);
    expect(Object.keys(policy.apps)).toEqual(["agent-demo", "merchant-demo", "dashboard-demo"]);
    expect(policy.apps["agent-demo"]?.allow[0]?.max_amount_per_payment).toBe("1");
    expect(policy.apps["merchant-demo"]?.allow[0]?.assets).toEqual(["RUSD", "CKB"]);
    expect(policy.assets["RUSD"]?.decimals).toBe(8);
    expect(policy.assets["CKB"]?.native).toBe(true);
  });

  it("parses a policy without an assets section", () => {
    const policy = parsePolicy(`
apps:
  demo:
    name: "Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "payment.pay_invoice"
        assets: ["RUSD"]
        max_amount_per_payment: "1"
`);
    expect(policy.assets).toEqual({});
    expect(policy.apps["demo"]?.allow).toHaveLength(1);
  });

  it("rejects invalid YAML", () => {
    expect(() => parsePolicy("apps:\n  demo: [unclosed")).toThrow(PolicyError);
  });

  it("rejects unknown actions", () => {
    expect(() =>
      parsePolicy(`
apps:
  demo:
    name: "Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "node.shutdown"
`),
    ).toThrow(PolicyError);
  });

  it("rejects two allow rules for the same action", () => {
    expect(() =>
      parsePolicy(`
apps:
  demo:
    name: "Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "invoice.create"
      - action: "invoice.create"
`),
    ).toThrow(/more than one allow rule/);
  });

  it("rejects an action listed in both allow and deny", () => {
    expect(() =>
      parsePolicy(`
apps:
  demo:
    name: "Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "invoice.create"
    deny:
      - action: "invoice.create"
`),
    ).toThrow(/both allow and deny/);
  });

  it("rejects assets referenced by rules but not declared", () => {
    expect(() =>
      parsePolicy(`
assets:
  CKB:
    decimals: 8
    native: true
apps:
  demo:
    name: "Demo"
    origins: ["http://localhost:3001"]
    allow:
      - action: "payment.pay_invoice"
        assets: ["RUSD"]
`),
    ).toThrow(/not declared in the assets section/);
  });

  it("rejects asset configs that are neither native nor UDT", () => {
    expect(() =>
      parsePolicy(`
assets:
  RUSD:
    decimals: 8
apps: {}
`),
    ).toThrow(PolicyError);
  });

  it("rejects malformed UDT script hashes", () => {
    expect(() =>
      parsePolicy(`
assets:
  RUSD:
    decimals: 8
    udt_type_script:
      code_hash: "0x1234"
      hash_type: type
      args: "0x"
apps: {}
`),
    ).toThrow(PolicyError);
  });

  it("rejects malformed origins", () => {
    expect(() =>
      parsePolicy(`
apps:
  demo:
    name: "Demo"
    origins: ["localhost:3001"]
`),
    ).toThrow(PolicyError);
  });
});

describe("loadPolicy", () => {
  it("loads a policy from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "fiberguard-policy-"));
    const path = join(dir, "fiberguard.yml");
    writeFileSync(path, FIXTURE_YAML);
    expect(Object.keys(loadPolicy(path).apps)).toHaveLength(3);
  });

  it("reports unreadable files", () => {
    expect(() => loadPolicy("/nonexistent/fiberguard.yml")).toThrow(/cannot read policy file/);
  });
});
