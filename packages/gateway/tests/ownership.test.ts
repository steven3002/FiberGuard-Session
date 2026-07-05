import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { OwnershipIndex } from "../src/core/ownership/index.js";

const NOW = new Date("2026-07-05T09:00:00.000Z");
const HASH = `0x${"11".repeat(32)}`;

describe("OwnershipIndex", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "fiberguard-ownership-"));
  });

  it("recognizes the recording session as owner and no one else", async () => {
    const index = new OwnershipIndex(dataDir);
    await index.record(HASH, "sess_owner01", "agent-demo", NOW);

    expect(await index.isOwnedBy(HASH, "sess_owner01")).toBe(true);
    expect(await index.isOwnedBy(HASH, "sess_other99")).toBe(false);
    expect(await index.isOwnedBy(`0x${"22".repeat(32)}`, "sess_owner01")).toBe(false);
  });

  it("keeps the first owner when a hash is recorded twice", async () => {
    const index = new OwnershipIndex(dataDir);
    await index.record(HASH, "sess_first001", "agent-demo", NOW);
    await index.record(HASH, "sess_second02", "agent-demo", NOW);
    expect(await index.isOwnedBy(HASH, "sess_first001")).toBe(true);
    expect(await index.isOwnedBy(HASH, "sess_second02")).toBe(false);
  });

  it("persists across instances", async () => {
    await new OwnershipIndex(dataDir).record(HASH, "sess_owner01", "agent-demo", NOW);
    expect(await new OwnershipIndex(dataDir).isOwnedBy(HASH, "sess_owner01")).toBe(true);
  });
});
