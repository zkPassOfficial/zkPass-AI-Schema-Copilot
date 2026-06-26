import type { IndexedField } from "@/shared/types";
import { MAX_INDEX_DEPTH } from "@/shared/constants";
import { maskValue } from "./masker";

export function indexJsonResponse(json: unknown, maxDepth = MAX_INDEX_DEPTH): IndexedField[] {
  const fields: IndexedField[] = [];
  traverse(json, [], 0, maxDepth, fields);
  return fields;
}

function traverse(
  value: unknown,
  pathParts: string[],
  depth: number,
  maxDepth: number,
  fields: IndexedField[]
) {
  if (depth > maxDepth) return;

  if (value === null) {
    fields.push({
      path: pathParts.join("|"),
      type: "null",
      sampleValue: "null",
      depth,
    });
    return;
  }

  if (Array.isArray(value)) {
    if (pathParts.length > 0) {
      fields.push({
        path: pathParts.join("|"),
        type: "array",
        sampleValue: `[${value.length} items]`,
        depth,
      });
    }
    if (value.length > 0) {
      traverse(value[0], [...pathParts, "0"], depth + 1, maxDepth, fields);
    }
    return;
  }

  if (typeof value === "object") {
    if (pathParts.length > 0) {
      fields.push({
        path: pathParts.join("|"),
        type: "object",
        sampleValue: `{${Object.keys(value!).length} keys}`,
        depth,
      });
    }
    for (const key of Object.keys(value!)) {
      traverse((value as Record<string, unknown>)[key], [...pathParts, key], depth + 1, maxDepth, fields);
    }
    return;
  }

  const type = typeof value === "number"
    ? "number"
    : typeof value === "boolean"
    ? "boolean"
    : "string";

  const raw = String(value);
  const sample = maskValue(raw.length > 100 ? raw.slice(0, 100) + "..." : raw);

  fields.push({
    path: pathParts.join("|"),
    type,
    sampleValue: sample,
    depth,
  });
}
