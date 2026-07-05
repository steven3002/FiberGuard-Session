import { describe, expect, it } from "vitest";
import {
  originSchema,
  payInvoiceBodySchema,
  requestedPermissionSchema,
  sessionRequestBodySchema,
} from "../src/index.js";

const validSessionRequest = {
  app_id: "agent-demo",
  origin: "http://localhost:3001",
  requested_permissions: [
    {
      action: "payment.pay_invoice",
      asset: "RUSD",
      max_amount_per_payment: "1",
      daily_limit: "5",
      expires_in: "10m",
    },
  ],
};

describe("sessionRequestBodySchema", () => {
  it("accepts the product-spec example request", () => {
    expect(sessionRequestBodySchema.parse(validSessionRequest)).toEqual(validSessionRequest);
  });

  it("rejects unknown actions", () => {
    const body = structuredClone(validSessionRequest);
    body.requested_permissions[0]!.action = "node.shutdown";
    expect(sessionRequestBodySchema.safeParse(body).success).toBe(false);
  });

  it("rejects unexpected keys", () => {
    const body = { ...structuredClone(validSessionRequest), admin: true };
    expect(sessionRequestBodySchema.safeParse(body).success).toBe(false);
  });

  it("rejects empty permission lists", () => {
    const body = { ...structuredClone(validSessionRequest), requested_permissions: [] };
    expect(sessionRequestBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("requestedPermissionSchema", () => {
  it("accepts read-only permissions without limits", () => {
    expect(requestedPermissionSchema.safeParse({ action: "node.read" }).success).toBe(true);
  });

  it("rejects malformed amounts", () => {
    const result = requestedPermissionSchema.safeParse({
      action: "payment.pay_invoice",
      max_amount_per_payment: "01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero limits", () => {
    const result = requestedPermissionSchema.safeParse({
      action: "payment.pay_invoice",
      max_amount_per_payment: "0",
    });
    expect(result.success).toBe(false);
  });
});

describe("originSchema", () => {
  it.each(["http://localhost:3001", "https://example.com"])("accepts %s", (value) => {
    expect(originSchema.safeParse(value).success).toBe(true);
  });

  it.each(["http://localhost:3001/", "localhost:3001", "not a url", "http://x/path"])(
    "rejects %s",
    (value) => {
      expect(originSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("payInvoiceBodySchema", () => {
  it("accepts the product-spec pay-invoice example", () => {
    const result = payInvoiceBodySchema.safeParse({
      session_id: "sess_a1b2c3d4e5",
      app_id: "agent-demo",
      origin: "http://localhost:3001",
      invoice: "fibt1qexample",
      asset: "RUSD",
      amount: "0.5",
      reason: "Pay for API request",
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero-amount payments", () => {
    const result = payInvoiceBodySchema.safeParse({
      session_id: "sess_a1b2c3d4e5",
      app_id: "agent-demo",
      origin: "http://localhost:3001",
      invoice: "fibt1qexample",
      asset: "RUSD",
      amount: "0",
    });
    expect(result.success).toBe(false);
  });
});
