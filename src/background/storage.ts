import type { CapturedRequest } from "@/shared/types";
import { type AiConfig, DEFAULT_PROVIDER, DEFAULT_CLAUDE_MODEL, getDefaultEndpoint } from "@/shared/constants";

const STORAGE_PREFIX = "captures_";
const DOMAIN_LRU_KEY = "capture_domains_lru";
const MAX_CAPTURES_PER_DOMAIN = 50;
const MAX_DOMAIN_BUCKETS = 3;

// Serialize read-modify-write cycles so concurrent captures from multiple tabs don't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

async function touchDomainLru(domain: string): Promise<void> {
  const result = await chrome.storage.session.get(DOMAIN_LRU_KEY);
  const lru: string[] = (result[DOMAIN_LRU_KEY] || []).filter((d: string) => d !== domain);
  lru.push(domain);

  const evicted = lru.splice(0, Math.max(0, lru.length - MAX_DOMAIN_BUCKETS));
  if (evicted.length > 0) {
    await chrome.storage.session.remove(evicted.map((d) => `${STORAGE_PREFIX}${d}`));
  }
  await chrome.storage.session.set({ [DOMAIN_LRU_KEY]: lru });
}

export function storeCapturedRequest(domain: string, request: CapturedRequest): Promise<void> {
  return serialized(async () => {
    const key = `${STORAGE_PREFIX}${domain}`;
    const result = await chrome.storage.session.get(key);
    const existing: CapturedRequest[] = result[key] || [];

    const dedupIndex = existing.findIndex(
      (r) => r.url === request.url
        && r.method === request.method
        && (r.requestBody ?? null) === (request.requestBody ?? null)
    );
    if (dedupIndex >= 0) {
      existing[dedupIndex] = request;
    } else {
      existing.push(request);
    }

    while (existing.length > MAX_CAPTURES_PER_DOMAIN) {
      let oldestIdx = 0;
      for (let i = 1; i < existing.length; i++) {
        if (existing[i].timestamp < existing[oldestIdx].timestamp) oldestIdx = i;
      }
      existing.splice(oldestIdx, 1);
    }

    await touchDomainLru(domain);

    try {
      await chrome.storage.session.set({ [key]: existing });
    } catch {
      // Likely quota exceeded — drop the oldest half and retry once.
      existing.sort((a, b) => b.timestamp - a.timestamp);
      const trimmed = existing.slice(0, Math.ceil(existing.length / 2));
      await chrome.storage.session.set({ [key]: trimmed });
    }
  });
}

export async function getCapturedRequests(domain: string): Promise<CapturedRequest[]> {
  const key = `${STORAGE_PREFIX}${domain}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || [];
}

export async function getCaptureCount(domain: string): Promise<number> {
  const captures = await getCapturedRequests(domain);
  return captures.length;
}

export function clearCapturedRequests(domain?: string): Promise<void> {
  return serialized(async () => {
    if (domain !== undefined) {
      await chrome.storage.session.remove(`${STORAGE_PREFIX}${domain}`);
      const result = await chrome.storage.session.get(DOMAIN_LRU_KEY);
      const lru: string[] = (result[DOMAIN_LRU_KEY] || []).filter((d: string) => d !== domain);
      await chrome.storage.session.set({ [DOMAIN_LRU_KEY]: lru });
    } else {
      const all = await chrome.storage.session.get(null);
      const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_PREFIX) || k === DOMAIN_LRU_KEY);
      if (keys.length > 0) await chrome.storage.session.remove(keys);
    }
  });
}

export async function getAiConfig(): Promise<AiConfig> {
  const result = await chrome.storage.local.get("ai_config");
  const stored = result.ai_config as Partial<AiConfig> | undefined;
  const provider = stored?.provider || DEFAULT_PROVIDER;
  return {
    provider,
    apiKey: stored?.apiKey || "",
    model: stored?.model || DEFAULT_CLAUDE_MODEL,
    endpoint: stored?.endpoint || getDefaultEndpoint(provider),
  };
}

export async function setAiConfig(config: AiConfig): Promise<void> {
  await chrome.storage.local.set({ ai_config: config });
}
