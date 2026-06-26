import type { ZkPassSchema } from "@/shared/types";
import { VALID_OPERATIONS } from "@/shared/constants";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSchema(schema: ZkPassSchema): ValidationResult {
  const errors: string[] = [];

  if (!schema.website) errors.push("Missing 'website'.");

  if (schema.website) {
    try {
      new URL(schema.website);
    } catch {
      errors.push("'website' is not a valid URL.");
    }
  }

  if (!Array.isArray(schema.APIs) || schema.APIs.length === 0) {
    errors.push("'APIs' must be a non-empty array.");
  } else {
    let hasNullifier = false;
    let hasAssert = false;

    schema.APIs.forEach((api, i) => {
      const prefix = `APIs[${i}]`;
      if (!api.host) errors.push(`${prefix}: Missing 'host'.`);
      if (!api.intercept?.url) errors.push(`${prefix}: Missing 'intercept.url'.`);
      if (!api.intercept?.method) errors.push(`${prefix}: Missing 'intercept.method'.`);
      if (api.intercept?.method && !["GET", "POST"].includes(api.intercept.method)) {
        errors.push(`${prefix}: 'intercept.method' must be GET or POST.`);
      }

      if (api.intercept?.url?.startsWith("/")) {
        errors.push(`${prefix}: 'intercept.url' should not start with '/'.`);
      }

      if (api.nullifier) {
        hasNullifier = true;
        if (api.accept === "html") {
          if (!api.nullifier.startsWith("/")) {
            errors.push(`${prefix}: HTML nullifier must be a valid XPath expression starting with '/'.`);
          }
        } else if (!api.nullifier.match(/^[a-zA-Z0-9_|$?]+$/)) {
          errors.push(`${prefix}: 'nullifier' contains invalid characters.`);
        }
      }

      if (api.assert && api.assert.length > 0) {
        hasAssert = true;
        api.assert.forEach((a, j) => {
          const aPrefix = `${prefix}.assert[${j}]`;
          if (!a.key) errors.push(`${aPrefix}: Missing 'key'.`);
          if (a.value === undefined || a.value === null) errors.push(`${aPrefix}: Missing 'value'.`);
          if (typeof a.value !== "string") errors.push(`${aPrefix}: 'value' must be a string.`);
          if (!VALID_OPERATIONS.includes(a.operation as typeof VALID_OPERATIONS[number])) {
            errors.push(`${aPrefix}: Invalid operation '${a.operation}'. Must be one of: ${VALID_OPERATIONS.join(", ")}`);
          }
        });
      }
    });

    if (!hasNullifier) {
      errors.push("Schema must have exactly one 'nullifier' across all APIs.");
    }

    if (!hasAssert) {
      errors.push("Schema must have at least one 'assert' across all APIs.");
    }
  }

  if (!Array.isArray(schema.HRCondition) || schema.HRCondition.length === 0) {
    errors.push("'HRCondition' must be a non-empty array.");
  }

  return { valid: errors.length === 0, errors };
}
