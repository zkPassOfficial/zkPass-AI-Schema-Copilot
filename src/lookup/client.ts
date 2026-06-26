import { LOOKUP_API_URL } from "@/shared/constants";
import type { ApiCandidateSummary } from "@/shared/types";

export interface LookupFieldRef {
  jsonPath: string;
  purposes: string[];
}

export interface LookupMatcher {
  query?: Array<Record<string, unknown>>;
  body?: Array<Record<string, unknown>>;
  header?: Array<Record<string, unknown>>;
}

export interface LookupEndpoint {
  host: string;
  method: "GET" | "POST";
  path: string;
  page: string;
  match?: LookupMatcher;
  nullifier?: string;
  fields: LookupFieldRef[];
}

interface LookupResponse {
  endpoints: LookupEndpoint[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseMatcher(value: unknown): LookupMatcher | undefined {
  if (!isRecord(value)) return undefined;

  const matcher: LookupMatcher = {};
  for (const key of ["query", "body", "header"] as const) {
    const entries = value[key];
    if (Array.isArray(entries)) {
      matcher[key] = entries.filter(isRecord);
    }
  }

  return Object.keys(matcher).length > 0 ? matcher : undefined;
}

function parseEndpoint(value: unknown): LookupEndpoint | null {
  if (!isRecord(value)) return null;
  if (typeof value.host !== "string" || !value.host) return null;
  if (value.method !== "GET" && value.method !== "POST") return null;
  if (typeof value.path !== "string" || !value.path) return null;

  const fields = Array.isArray(value.fields)
    ? value.fields
        .filter(isRecord)
        .map((field) => ({
          jsonPath: typeof field.jsonPath === "string" ? field.jsonPath : "",
          purposes: Array.isArray(field.purposes)
            ? field.purposes.filter((purpose): purpose is string => typeof purpose === "string")
            : [],
        }))
        .filter((field) => field.jsonPath)
    : [];

  return {
    host: value.host,
    method: value.method,
    path: value.path,
    page: typeof value.page === "string" ? value.page : "",
    match: parseMatcher(value.match),
    nullifier: typeof value.nullifier === "string" && value.nullifier ? value.nullifier : undefined,
    fields,
  };
}

export async function lookupEndpoints(host: string): Promise<LookupEndpoint[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(LOOKUP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Lookup failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as Partial<LookupResponse>;
    if (!Array.isArray(payload.endpoints)) return [];
    return payload.endpoints.map(parseEndpoint).filter((endpoint): endpoint is LookupEndpoint => endpoint !== null);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCandidatePath(value: string): string {
  return value.split("?", 1)[0].replace(/^\/+/, "");
}

function normalizeLookupPath(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname.replace(/^\/+/, "");
    } catch {
      return value.replace(/^\/+/, "");
    }
  }
  return value.replace(/^\/+/, "");
}

function lookupPathMatches(lookupPath: string, candidatePath: string): boolean {
  const pattern = normalizeLookupPath(lookupPath)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\?=\\\?/g, "[^/]+");
  return new RegExp(`^${pattern}$`).test(normalizeCandidatePath(candidatePath));
}

function parseCandidateBody(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const params = new URLSearchParams(body);
    if ([...params.keys()].length === 0) return null;
    return Object.fromEntries(params.entries());
  }
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected !== "object") {
    return actual === String(expected);
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function entriesMatch(
  entries: Array<Record<string, unknown>> | undefined,
  source: Record<string, unknown> | null,
): boolean {
  if (!entries?.length) return true;
  if (!source) return false;
  return entries.every((entry) =>
    Object.entries(entry).every(([key, expected]) => valuesEqual(source[key], expected))
  );
}

function matcherMatchesCandidate(matcher: LookupMatcher | undefined, candidate: ApiCandidateSummary): boolean {
  if (!matcher) return true;

  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return false;
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const headers = Object.fromEntries(
    Object.entries(candidate.requestHeaders ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const normalizedHeaderMatchers = matcher.header?.map((entry) =>
    Object.fromEntries(Object.entries(entry).map(([key, value]) => [key.toLowerCase(), value]))
  );

  return entriesMatch(matcher.query, query)
    && entriesMatch(matcher.body, parseCandidateBody(candidate.requestBody))
    && entriesMatch(normalizedHeaderMatchers, headers);
}

export function lookupEndpointMatchesCandidate(
  endpoint: LookupEndpoint,
  candidate: ApiCandidateSummary,
): boolean {
  return endpoint.host.toLowerCase() === candidate.host.toLowerCase()
    && endpoint.method === candidate.method.toUpperCase()
    && lookupPathMatches(endpoint.path, candidate.pathname)
    && matcherMatchesCandidate(endpoint.match, candidate);
}
