import { join } from "node:path";
import { JsonStore } from "../../storage/json-store.js";

interface OwnershipRecord {
  session_id: string;
  app_id: string;
  recorded_at: string;
}

interface OwnershipDocument {
  /** payment_hash → the session/app that created it */
  payments: Record<string, OwnershipRecord>;
}

/**
 * Records which session (and app) created each payment or invoice so the
 * payment.read_own check can confirm a caller only reads its own payments.
 * First writer wins: a payment hash keeps its original owner. Persisted so
 * ownership survives gateway restarts.
 */
export class OwnershipIndex {
  private readonly store: JsonStore<OwnershipDocument>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.store = new JsonStore(join(dataDir, "payment-ownership.json"), () => ({ payments: {} }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  record(paymentHash: string, sessionId: string, appId: string, now: Date): Promise<void> {
    return this.serialize(async () => {
      const document = await this.store.read();
      if (document.payments[paymentHash] === undefined) {
        document.payments[paymentHash] = {
          session_id: sessionId,
          app_id: appId,
          recorded_at: now.toISOString(),
        };
        await this.store.write(document);
      }
    });
  }

  async isOwnedBy(paymentHash: string, sessionId: string): Promise<boolean> {
    const document = await this.store.read();
    return document.payments[paymentHash]?.session_id === sessionId;
  }
}
