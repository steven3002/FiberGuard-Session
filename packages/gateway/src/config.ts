import { z } from "zod";

const httpUrlSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL" },
);

export const gatewayConfigSchema = z.object({
  upstreamUrl: httpUrlSchema,
  port: z.coerce.number().int().min(1).max(65535),
  policyPath: z.string().min(1),
  dataDir: z.string().min(1),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface RawStartOptions {
  upstream: string;
  port: string;
  policy: string;
  data: string;
}

export function resolveConfig(raw: RawStartOptions): GatewayConfig {
  const result = gatewayConfigSchema.safeParse({
    upstreamUrl: raw.upstream,
    port: raw.port,
    policyPath: raw.policy,
    dataDir: raw.data,
  });
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  --${flagFor(issue.path[0])}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`invalid gateway options:\n${issues}`);
  }
  return result.data;
}

function flagFor(field: unknown): string {
  switch (field) {
    case "upstreamUrl":
      return "upstream";
    case "policyPath":
      return "policy";
    case "dataDir":
      return "data";
    default:
      return String(field);
  }
}
