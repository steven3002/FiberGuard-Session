import type { AuditEvent } from "@fiberguard/shared";
import { JsonLinesLog } from "../../storage/json-store.js";

export interface AuditQuery {
  /** Restrict to events recorded for a single app. Unknown ids yield no events. */
  appId?: string;
  /** Cap the number of (already newest-first) events returned. */
  limit?: number;
}

/**
 * Reads the append-only audit log for `GET /audit`. Events are returned
 * newest-first by reversing append order rather than sorting on timestamp, so
 * entries written within the same millisecond keep a stable, faithful order.
 */
export class AuditReader {
  private readonly log: JsonLinesLog<AuditEvent>;

  constructor(filePath: string) {
    this.log = new JsonLinesLog<AuditEvent>(filePath);
  }

  async query(filter: AuditQuery = {}): Promise<AuditEvent[]> {
    const appended = await this.log.readAll();
    const matched =
      filter.appId === undefined
        ? appended
        : appended.filter((event) => event.app_id === filter.appId);

    matched.reverse();

    return filter.limit === undefined ? matched : matched.slice(0, filter.limit);
  }
}
