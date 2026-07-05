import { randomBytes } from "node:crypto";
import { RpcError } from "../errors.js";
import { fromHex, toHex } from "../hex.js";
import { randomHash, type MockInvoice, type MockState } from "../state.js";

const CURRENCY_PREFIX: Record<string, string> = { Fibb: "fibb", Fibt: "fibt", Fibd: "fibd" };

interface NewInvoiceParams {
  amount?: unknown;
  currency?: unknown;
  description?: unknown;
  payment_hash?: unknown;
  udt_type_script?: unknown;
}

/** `new_invoice`: mints an invoice, returning its encoded address and payment hash. */
export function newInvoice(state: MockState, params: NewInvoiceParams): Record<string, unknown> {
  let amount: bigint;
  try {
    amount = fromHex(params.amount);
  } catch {
    throw new RpcError(-32602, "new_invoice requires amount as a 0x-hex string");
  }

  const currency = typeof params.currency === "string" ? params.currency : "Fibd";
  const prefix = CURRENCY_PREFIX[currency] ?? "fibd";
  const paymentHash = typeof params.payment_hash === "string" ? params.payment_hash : randomHash();
  const invoiceAddress = `${prefix}1${randomBytes(24).toString("hex")}`;
  const description = typeof params.description === "string" ? params.description : undefined;

  const invoice: MockInvoice = {
    invoice_address: invoiceAddress,
    payment_hash: paymentHash,
    amount: toHex(amount),
    currency,
    status: "Open",
    ...(description !== undefined ? { description } : {}),
    ...(params.udt_type_script !== undefined ? { udt_type_script: params.udt_type_script } : {}),
  };
  state.invoices.set(invoiceAddress, invoice);

  return {
    invoice_address: invoiceAddress,
    invoice: {
      currency,
      amount: invoice.amount,
      payment_hash: paymentHash,
      status: "Open",
      ...(description !== undefined ? { description } : {}),
      ...(params.udt_type_script !== undefined ? { udt_type_script: params.udt_type_script } : {}),
    },
  };
}
