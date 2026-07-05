import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function isFileMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Whole-document JSON persistence with atomic writes: content is written to a
 * temp file and renamed into place, so a crash mid-write can never leave a
 * truncated document behind. Serialization of writes is the caller's concern —
 * the gateway funnels all mutations through single-threaded stores.
 */
export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly fallback: () => T,
  ) {}

  async read(): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isFileMissing(error)) {
        return this.fallback();
      }
      throw error;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new StorageError(`corrupt JSON document at ${this.filePath}`);
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

/**
 * Append-only JSON-lines log. Appends are single atomic writeFile calls in
 * append mode; readers tolerate a trailing partial line from an interrupted
 * append by skipping unparseable lines.
 */
export class JsonLinesLog<T> {
  constructor(private readonly filePath: string) {}

  async append(entry: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async readAll(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isFileMissing(error)) {
        return [];
      }
      throw error;
    }
    const entries: T[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      try {
        entries.push(JSON.parse(line) as T);
      } catch {
        continue;
      }
    }
    return entries;
  }
}
