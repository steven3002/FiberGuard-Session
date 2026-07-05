import { join } from "node:path";
import { addAmounts } from "@fiberguard/shared";
import { JsonStore } from "../../storage/json-store.js";

interface LedgerDocument {
  /** key `${app_id}::${action}::${asset}::${utc_date}` → accumulated decimal amount */
  entries: Record<string, string>;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function ledgerKey(appId: string, action: string, asset: string, now: Date): string {
  return `${appId}::${action}::${asset}::${utcDate(now)}`;
}

/**
 * Per-day spend accumulation keyed by app + action + asset over the UTC calendar
 * day. Totals advance only after an upstream forward succeeds, so a blocked or
 * failed intent never moves the running total. Mutations serialize over the
 * atomic JSON document, mirroring SessionStore's discipline; the document
 * survives restarts so daily limits hold across gateway lifetimes.
 */
export class SpendLedger {
  private readonly store: JsonStore<LedgerDocument>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "spend-ledger.json"), () => ({ entries: {} }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Amount already spent today (UTC) for this app + action + asset, decimal string. */
  async spentToday(appId: string, action: string, asset: string, now: Date): Promise<string> {
    const document = await this.store.read();
    return document.entries[ledgerKey(appId, action, asset, now)] ?? "0";
  }

  /** Adds `amount` to today's bucket and returns the new total. */
  addSpend(
    appId: string,
    action: string,
    asset: string,
    amount: string,
    now: Date,
  ): Promise<string> {
    return this.serialize(async () => {
      const document = await this.store.read();
      const key = ledgerKey(appId, action, asset, now);
      const next = addAmounts(document.entries[key] ?? "0", amount);
      document.entries[key] = next;
      await this.store.write(document);
      return next;
    });
  }
}
