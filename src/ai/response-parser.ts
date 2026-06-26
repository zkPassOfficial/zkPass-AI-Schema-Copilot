import type {
  AiMatchResult,
  ApiSelection,
  AssertionItem,
  ApiCandidateSummary,
  MissingDataResult,
  MissingDataItem,
  AnalysisResult,
} from "@/shared/types";
import { VALID_OPERATIONS } from "@/shared/constants";
import type { LookupEndpoint } from "@/lookup/client";
import { lookupEndpointMatchesCandidate } from "@/lookup/client";

function parseOneAssertion(raw: Record<string, unknown>): AssertionItem | { error: string } {
  if (typeof raw.key !== "string" || !raw.key) {
    return { error: "Assertion missing 'key'." };
  }

  const op = String(raw.operation ?? "");
  if (op && !VALID_OPERATIONS.includes(op as typeof VALID_OPERATIONS[number])) {
    return { error: `Invalid operation '${op}'. Must be one of: ${VALID_OPERATIONS.join(", ")}` };
  }

  const item: AssertionItem = {
    key: raw.key,
    value: String(raw.value ?? ""),
    operation: op,
  };
  if (typeof raw.tips === "string") item.tips = raw.tips;
  if (raw.isPublic === true) item.isPublic = true;
  return item;
}

function parseMissingData(parsed: Record<string, unknown>): MissingDataResult {
  const rawMissing = Array.isArray(parsed.missing) ? parsed.missing : [];
  const missing: MissingDataItem[] = rawMissing
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .map((m) => ({
      what: typeof m.what === "string" ? m.what : "required data",
      suggestedPages: Array.isArray(m.suggestedPages)
        ? m.suggestedPages.filter((p): p is string => typeof p === "string")
        : [],
      exampleFieldNames: Array.isArray(m.exampleFieldNames)
        ? m.exampleFieldNames.filter((f): f is string => typeof f === "string")
        : undefined,
    }));

  return {
    status: "missing_data",
    message:
      typeof parsed.message === "string" && parsed.message
        ? parsed.message
        : "The captured data doesn't contain what's needed. Please visit the relevant page and try again.",
    missing,
  };
}

function parseAnalysisResponse(parsed: Record<string, unknown>): AnalysisResult {
  const understanding = parsed.understanding as Record<string, unknown> | undefined;
  return {
    status: "analysis",
    understanding: {
      facts: Array.isArray(understanding?.facts)
        ? (understanding.facts as unknown[]).filter((f): f is string => typeof f === "string")
        : [],
      assumptions: Array.isArray(understanding?.assumptions)
        ? (understanding.assumptions as unknown[]).filter((a): a is string => typeof a === "string")
        : [],
      questions: Array.isArray(understanding?.questions)
        ? (understanding.questions as unknown[]).filter((q): q is string => typeof q === "string")
        : [],
    },
    message:
      typeof parsed.message === "string" && parsed.message
        ? parsed.message
        : "Let me analyze your request...",
    readyToBuild: parsed.readyToBuild === true,
  };
}

function parseApisArray(
  rawApis: unknown[],
  candidates: ApiCandidateSummary[],
  lookupEndpoints: LookupEndpoint[],
): ApiSelection[] | { error: string } {
  const selections: ApiSelection[] = [];

  for (const rawEntry of rawApis) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;

    const apiId = typeof entry.apiId === "string" ? entry.apiId : "";
    if (!apiId) return { error: "An 'apis' entry is missing 'apiId'." };
    if (!candidates.find((c) => c.id === apiId)) {
      return { error: `API '${apiId}' not found in candidates.` };
    }

    const assertions: AssertionItem[] = [];
    if (Array.isArray(entry.assertions)) {
      for (const a of entry.assertions) {
        const result = parseOneAssertion(a as Record<string, unknown>);
        if ("error" in result) return result;
        assertions.push(result);
      }
    }

    const nullifier = typeof entry.nullifier === "string" && entry.nullifier ? entry.nullifier : null;

    if (assertions.length === 0 && !nullifier) {
      return { error: `API '${apiId}' has neither assertions nor a nullifier.` };
    }

    const selection: ApiSelection = { apiId, assertions, nullifier };
    if (entry.sourceType === "html") selection.sourceType = "html";
    if (typeof entry.lookupEndpointIndex === "number" && Number.isInteger(entry.lookupEndpointIndex)) {
      const lookupEndpoint = lookupEndpoints[entry.lookupEndpointIndex];
      const candidate = candidates.find((item) => item.id === apiId)!;
      if (!lookupEndpoint) {
        return { error: `Lookup endpoint index '${entry.lookupEndpointIndex}' is not available.` };
      }
      if (!lookupEndpointMatchesCandidate(lookupEndpoint, candidate)) {
        return { error: `Lookup endpoint index '${entry.lookupEndpointIndex}' does not match API '${apiId}'.` };
      }
      selection.lookupEndpointIndex = entry.lookupEndpointIndex;
    }
    selections.push(selection);
  }

  if (selections.length === 0) return { error: "'apis' array is empty." };

  const nullifierCount = selections.filter((s) => s.nullifier).length;
  if (nullifierCount > 1) {
    // Keep only the first nullifier to satisfy the one-nullifier rule.
    let seen = false;
    for (const s of selections) {
      if (s.nullifier) {
        if (seen) s.nullifier = null;
        seen = true;
      }
    }
  }

  return selections;
}

export function parseAiResponse(
  raw: string,
  candidates: ApiCandidateSummary[],
  lookupEndpoints: LookupEndpoint[] = [],
): AiMatchResult | MissingDataResult | AnalysisResult | { error: string } {
  let json: string = raw.trim();

  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1].trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Failed to parse AI response as JSON." };
  }

  if (parsed.status === "missing_data") {
    return parseMissingData(parsed);
  }

  if (parsed.status === "analysis") {
    return parseAnalysisResponse(parsed);
  }

  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  const clampedConfidence = Math.max(0, Math.min(1, confidence));
  const reason = typeof parsed.reason === "string" ? parsed.reason : "";

  let apis: ApiSelection[];

  if (Array.isArray(parsed.apis) && parsed.apis.length > 0) {
    const result = parseApisArray(parsed.apis, candidates, lookupEndpoints);
    if ("error" in result) return result;
    apis = result;
  } else {
    // Legacy format: selectedApi (+ optional nullifierApi)
    const legacy = parseLegacyFormat(parsed, candidates);
    if ("error" in legacy) return legacy;
    apis = legacy;
  }

  const assertionApi = apis.find((a) => a.assertions.length > 0) ?? apis[0];
  const nullifierApi = apis.find((a) => a.nullifier);
  const allAssertions = apis.flatMap((a) => a.assertions);

  return {
    selectedApi: assertionApi.apiId,
    nullifierApi: nullifierApi && nullifierApi.apiId !== assertionApi.apiId ? nullifierApi.apiId : undefined,
    fieldPath: (parsed.fieldPath as string) || allAssertions[0]?.key || "",
    assertions: assertionApi.assertions.length > 0 ? assertionApi.assertions : allAssertions,
    nullifier: nullifierApi?.nullifier ?? null,
    confidence: clampedConfidence,
    reason,
    HRCondition: Array.isArray(parsed.HRCondition)
      ? (parsed.HRCondition as string[])
      : [reason || "Verification condition"],
    website: typeof parsed.website === "string" ? parsed.website : undefined,
    sourceType: assertionApi.sourceType,
    httpVersion: parsed.httpVersion === "2.0" ? "2.0" : undefined,
    apis,
  };
}

function parseLegacyFormat(
  parsed: Record<string, unknown>,
  candidates: ApiCandidateSummary[]
): ApiSelection[] | { error: string } {
  if (typeof parsed.selectedApi !== "string") {
    return { error: "Missing or invalid 'selectedApi' in AI response." };
  }

  if (!candidates.find((c) => c.id === parsed.selectedApi)) {
    return { error: `Selected API '${parsed.selectedApi}' not found in candidates.` };
  }

  const nullifierApiId = typeof parsed.nullifierApi === "string" ? parsed.nullifierApi : undefined;
  if (nullifierApiId && nullifierApiId !== parsed.selectedApi) {
    if (!candidates.find((c) => c.id === nullifierApiId)) {
      return { error: `Nullifier API '${nullifierApiId}' not found in candidates.` };
    }
  }

  const assertions: AssertionItem[] = [];
  if (Array.isArray(parsed.assertions) && parsed.assertions.length > 0) {
    for (const a of parsed.assertions) {
      const result = parseOneAssertion(a as Record<string, unknown>);
      if ("error" in result) return result;
      assertions.push(result);
    }
  } else if (parsed.assertion && typeof parsed.assertion === "object") {
    const result = parseOneAssertion(parsed.assertion as Record<string, unknown>);
    if ("error" in result) return result;
    assertions.push(result);
  } else {
    return { error: "Missing 'assertions' or 'assertion' in AI response." };
  }

  const nullifier = typeof parsed.nullifier === "string" && parsed.nullifier ? parsed.nullifier : null;
  const sourceType = parsed.sourceType === "html" ? ("html" as const) : undefined;

  if (nullifierApiId && nullifierApiId !== parsed.selectedApi) {
    return [
      { apiId: nullifierApiId, assertions: [], nullifier },
      { apiId: parsed.selectedApi, assertions, nullifier: null, sourceType },
    ];
  }

  return [{ apiId: parsed.selectedApi, assertions, nullifier, sourceType }];
}
