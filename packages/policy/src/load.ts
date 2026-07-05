import { readFileSync } from "node:fs";
import YAML from "yaml";
import { policyFileSchema, type Policy } from "./schema.js";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

/**
 * Parses and validates policy YAML. Beyond the schema, enforces structural
 * invariants that keep evaluation deterministic:
 * - at most one allow rule per action per app,
 * - an action may not appear in both allow and deny for the same app,
 * - when an assets section is present, every asset referenced by a rule must be declared.
 */
export function parsePolicy(source: string): Policy {
  let document: unknown;
  try {
    document = YAML.parse(source);
  } catch (error) {
    throw new PolicyError(`policy file is not valid YAML: ${(error as Error).message}`);
  }

  const result = policyFileSchema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new PolicyError(`policy file failed validation:\n${issues}`);
  }

  const policy = result.data;
  const declaredAssets = Object.keys(policy.assets);

  for (const [appId, app] of Object.entries(policy.apps)) {
    const allowedActions = new Set<string>();
    for (const rule of app.allow) {
      if (allowedActions.has(rule.action)) {
        throw new PolicyError(
          `app "${appId}" has more than one allow rule for action "${rule.action}"`,
        );
      }
      allowedActions.add(rule.action);

      if (declaredAssets.length > 0) {
        for (const asset of rule.assets ?? []) {
          if (!declaredAssets.includes(asset)) {
            throw new PolicyError(
              `app "${appId}" allows asset "${asset}" which is not declared in the assets section`,
            );
          }
        }
      }
    }

    for (const rule of app.deny) {
      if (allowedActions.has(rule.action)) {
        throw new PolicyError(
          `app "${appId}" lists action "${rule.action}" in both allow and deny`,
        );
      }
    }
  }

  return policy;
}

export function loadPolicy(path: string): Policy {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new PolicyError(`cannot read policy file "${path}": ${(error as Error).message}`);
  }
  return parsePolicy(source);
}
