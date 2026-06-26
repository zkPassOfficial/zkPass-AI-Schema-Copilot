import type { AiMatchResult, ApiSelection, AssertionItem, CapturedRequest, ZkPassSchema } from "@/shared/types";
import type { LookupEndpoint } from "@/lookup/client";
import { buildInterceptUrl, inferWebsite } from "./helpers";

export function buildSchema(params: {
  aiResult: AiMatchResult;
  captures: CapturedRequest[];
  userQuery: string;
  lookupEndpoints?: LookupEndpoint[];
}): ZkPassSchema | { error: string } {
  const { aiResult, captures, lookupEndpoints = [] } = params;

  const selections: ApiSelection[] =
    aiResult.apis && aiResult.apis.length > 0
      ? aiResult.apis
      : legacySelections(aiResult);

  const apis: ZkPassSchema["APIs"] = [];
  let websiteCapture: CapturedRequest | undefined;
  let lookupPage: string | undefined;

  for (const sel of selections) {
    const capture = captures.find((c) => c.id === sel.apiId);
    if (!capture) {
      return { error: `Captured API '${sel.apiId}' is no longer available.` };
    }

    const entry: ZkPassSchema["APIs"][number] = {
      host: parseHost(capture.url),
      intercept: {
        url: buildInterceptUrl(capture.url),
        method: capture.method.toUpperCase() as "GET" | "POST",
      },
    };

    const lookupEndpoint = sel.lookupEndpointIndex === undefined
      ? undefined
      : lookupEndpoints[sel.lookupEndpointIndex];
    if (lookupEndpoint?.match) {
      if (lookupEndpoint.match.query?.length) {
        entry.intercept.query = lookupEndpoint.match.query.map((item) => ({ ...item }));
      }
      if (lookupEndpoint.match.body?.length) {
        entry.intercept.body = lookupEndpoint.match.body.map((item) => ({ ...item }));
      }
      if (lookupEndpoint.match.header?.length) {
        entry.intercept.header = lookupEndpoint.match.header.map((item) => ({ ...item }));
      }
    }
    if (!lookupPage && lookupEndpoint?.page) lookupPage = lookupEndpoint.page;

    if (sel.assertions.length > 0) {
      entry.assert = sel.assertions.map(buildAssertItem);
      if (!websiteCapture) websiteCapture = capture;
    }

    if (sel.nullifier) entry.nullifier = sel.nullifier;
    if (sel.sourceType === "html" || capture.sourceType === "html") entry.accept = "html";

    apis.push(entry);
  }

  const primaryCapture = websiteCapture ?? captures.find((c) => c.id === selections[0].apiId)!;
  const website = aiResult.website || lookupPage || inferWebsite(primaryCapture.url);
  const issuer = inferIssuerName(parseHost(primaryCapture.url));

  const result: ZkPassSchema = {
    website,
    APIs: apis,
    HRCondition: aiResult.HRCondition,
    tips: {
      message: `When you successfully log in to ${issuer}, please click the 'Start' button to initiate the verification process.`,
    },
  };

  if (aiResult.httpVersion) {
    result.httpVersion = aiResult.httpVersion;
  }

  return result;
}

function legacySelections(aiResult: AiMatchResult): ApiSelection[] {
  if (aiResult.nullifierApi && aiResult.nullifierApi !== aiResult.selectedApi) {
    return [
      { apiId: aiResult.nullifierApi, assertions: [], nullifier: aiResult.nullifier },
      { apiId: aiResult.selectedApi, assertions: aiResult.assertions, nullifier: null, sourceType: aiResult.sourceType },
    ];
  }
  return [
    {
      apiId: aiResult.selectedApi,
      assertions: aiResult.assertions,
      nullifier: aiResult.nullifier,
      sourceType: aiResult.sourceType,
    },
  ];
}

function buildAssertItem(a: AssertionItem) {
  const item: { key: string; value: string; operation: string; tips?: string; isPublic?: boolean } = {
    key: a.key,
    value: String(a.value),
    operation: a.operation,
  };
  if (a.tips) item.tips = a.tips;
  if (a.isPublic) item.isPublic = true;
  return item;
}

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function inferIssuerName(host: string): string {
  const parts = host.split(".");
  const filtered = parts.filter(
    (p) => !["www", "api", "app", "m", "mobile", "auth", "v1", "v2", "com", "org", "net", "io", "co"].includes(p)
  );
  if (filtered.length > 0) {
    const name = filtered[filtered.length - 1] || filtered[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return host;
}
