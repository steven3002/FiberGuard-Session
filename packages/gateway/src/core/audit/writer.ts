import type { AuditEvent } from "@fiberguard/shared";
import { JsonLinesLog } from "../../storage/json-store.js";

export class AuditWriter {
  private readonly log: JsonLinesLog<AuditEvent>;

  constructor(filePath: string) {
    this.log = new JsonLinesLog<AuditEvent>(filePath);
  }

  /**
   * Appends an event with the current timestamp. Never throws: a failing audit
   * write must not turn a policy decision into a request failure.
   */
  async record(event: Omit<AuditEvent, "timestamp">): Promise<void> {
    const entry: AuditEvent = { ...event, timestamp: new Date().toISOString() };
    try {
      await this.log.append(entry);
    } catch (error) {
      console.error("fiberguard: audit write failed", error);
    }
  }
}
