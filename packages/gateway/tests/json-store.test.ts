import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonLinesLog, JsonStore, StorageError } from "../src/storage/json-store.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fiberguard-store-"));
}

describe("JsonStore", () => {
  it("returns the fallback when the file does not exist", async () => {
    const store = new JsonStore(join(tempDir(), "missing.json"), () => ({ items: [] }));
    expect(await store.read()).toEqual({ items: [] });
  });

  it("round-trips documents", async () => {
    const path = join(tempDir(), "sessions.json");
    const store = new JsonStore<Record<string, string>>(path, () => ({}));
    await store.write({ sess_1: "active" });
    expect(await store.read()).toEqual({ sess_1: "active" });
    await store.write({ sess_1: "revoked" });
    expect(await store.read()).toEqual({ sess_1: "revoked" });
  });

  it("creates parent directories on write", async () => {
    const path = join(tempDir(), "nested", "deep", "state.json");
    const store = new JsonStore<number[]>(path, () => []);
    await store.write([1, 2, 3]);
    expect(await store.read()).toEqual([1, 2, 3]);
  });

  it("leaves no temp file behind after a write", async () => {
    const path = join(tempDir(), "state.json");
    const store = new JsonStore<number>(path, () => 0);
    await store.write(42);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("reports corrupt documents instead of returning bad data", async () => {
    const path = join(tempDir(), "corrupt.json");
    writeFileSync(path, "{ not json");
    const store = new JsonStore<Record<string, never>>(path, () => ({}));
    await expect(store.read()).rejects.toThrow(StorageError);
  });

  it("writes human-readable JSON", async () => {
    const path = join(tempDir(), "pretty.json");
    const store = new JsonStore<{ a: number }>(path, () => ({ a: 0 }));
    await store.write({ a: 1 });
    expect(readFileSync(path, "utf8")).toContain("\n");
  });
});

describe("JsonLinesLog", () => {
  it("returns an empty list when the log does not exist", async () => {
    const log = new JsonLinesLog(join(tempDir(), "audit.jsonl"));
    expect(await log.readAll()).toEqual([]);
  });

  it("appends entries and reads them back in order", async () => {
    const log = new JsonLinesLog<{ n: number }>(join(tempDir(), "audit.jsonl"));
    await log.append({ n: 1 });
    await log.append({ n: 2 });
    await log.append({ n: 3 });
    expect(await log.readAll()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("skips a truncated trailing line from an interrupted append", async () => {
    const path = join(tempDir(), "audit.jsonl");
    const log = new JsonLinesLog<{ n: number }>(path);
    await log.append({ n: 1 });
    writeFileSync(path, `${readFileSync(path, "utf8")}{"n": 2`, { flag: "w" });
    expect(await log.readAll()).toEqual([{ n: 1 }]);
  });
});
