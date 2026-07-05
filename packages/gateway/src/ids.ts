import { randomBytes } from "node:crypto";

export function newSessionRequestId(): string {
  return `sr_${randomBytes(12).toString("base64url")}`;
}

export function newSessionId(): string {
  return `sess_${randomBytes(16).toString("base64url")}`;
}
