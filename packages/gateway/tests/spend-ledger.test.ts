import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SpendLedger } from "../src/core/spend/ledger.js";

const DAY = new Date("2026-07-05T09:00:00.000Z");
const SAME_DAY_LATER = new Date("2026-07-05T23:30:00.000Z");
const NEXT_DAY = new Date("2026-07-06T00:30:00.000Z");

describe("SpendLedger", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "fiberguard-ledger-"));
  });

  it("starts empty and accumulates within a UTC day", async () => {
    const ledger = new SpendLedger(dataDir);
    expect(await ledger.spentToday("agent-demo", "payment.pay_invoice", "RUSD", DAY)).toBe("0");

    await ledger.addSpend("agent-demo", "payment.pay_invoice", "RUSD", "0.5", DAY);
    await ledger.addSpend("agent-demo", "payment.pay_invoice", "RUSD", "1", SAME_DAY_LATER);
    expect(await ledger.spentToday("agent-demo", "payment.pay_invoice", "RUSD", DAY)).toBe("1.5");
  });

  it("separates buckets by app, action, asset, and UTC day", async () => {
    const ledger = new SpendLedger(dataDir);
    await ledger.addSpend("agent-demo", "payment.pay_invoice", "RUSD", "2", DAY);

    expect(await ledger.spentToday("merchant-demo", "payment.pay_invoice", "RUSD", DAY)).toBe("0");
    expect(await ledger.spentToday("agent-demo", "invoice.create", "RUSD", DAY)).toBe("0");
    expect(await ledger.spentToday("agent-demo", "payment.pay_invoice", "CKB", DAY)).toBe("0");
    expect(await ledger.spentToday("agent-demo", "payment.pay_invoice", "RUSD", NEXT_DAY)).toBe("0");
  });

  it("persists across instances", async () => {
    await new SpendLedger(dataDir).addSpend("agent-demo", "payment.pay_invoice", "RUSD", "3", DAY);
    const reopened = new SpendLedger(dataDir);
    expect(await reopened.spentToday("agent-demo", "payment.pay_invoice", "RUSD", DAY)).toBe("3");
  });
});
