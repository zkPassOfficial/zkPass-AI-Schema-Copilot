import type { CapturedRequest, ApiCandidateSummary, IndexedField } from "@/shared/types";
import { indexJsonResponse } from "./indexer";

export function buildApiCandidates(captures: CapturedRequest[]): ApiCandidateSummary[] {
  const seen = new Map<string, ApiCandidateSummary>();

  for (const capture of captures) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(capture.responseBody);
    } catch {
      continue;
    }

    const fields = indexJsonResponse(parsed);
    if (fields.length === 0) continue;

    let url: URL;
    try {
      url = new URL(capture.url);
    } catch {
      continue;
    }

    const dedupeKey = `${capture.method}:${url.host}${url.pathname}:${capture.requestBody ?? ""}`;

    seen.set(dedupeKey, {
      id: capture.id,
      url: capture.url,
      method: capture.method,
      host: url.host,
      pathname: url.pathname,
      requestHeaders: capture.requestHeaders,
      requestBody: capture.requestBody,
      fields,
      capturedAt: capture.timestamp,
    });
  }

  return Array.from(seen.values());
}

export function buildHtmlCandidate(capture: CapturedRequest, fields: IndexedField[]): ApiCandidateSummary | null {
  if (fields.length === 0) return null;

  let url: URL;
  try {
    url = new URL(capture.url);
  } catch {
    return null;
  }

  return {
    id: capture.id,
    url: capture.url,
    method: "GET",
    host: url.host,
    pathname: url.pathname,
    fields,
    sourceType: "html",
    capturedAt: capture.timestamp,
  };
}
