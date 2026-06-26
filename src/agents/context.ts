import type { Scratchpad } from "./types";
import type { AiMatchResult, CapturedRequest } from "@/shared/types";

const SCRATCHPAD_PREFIX = "agent_scratchpad_";

export async function saveScratchpad(planId: string, scratchpad: Scratchpad): Promise<void> {
  // Keep only the captures referenced by the AI result, with responseBody stripped.
  // Full captures are too large for session storage quota, but buildSchema only needs
  // id, url, method, and sourceType from each capture.
  let slimCaptures: CapturedRequest[] | undefined;
  const parsed = scratchpad.parsedResult;
  if (parsed && "apis" in parsed && scratchpad.captures) {
    const ai = parsed as AiMatchResult;
    const ids = new Set<string>();
    if (ai.apis) for (const a of ai.apis) ids.add(a.apiId);
    if (ai.selectedApi) ids.add(ai.selectedApi);
    if (ai.nullifierApi) ids.add(ai.nullifierApi);
    slimCaptures = scratchpad.captures
      .filter((c) => ids.has(c.id))
      .map((c) => ({ ...c, responseBody: "" }));
  }

  const slim = { ...scratchpad, captures: slimCaptures };
  await chrome.storage.session.set({ [`${SCRATCHPAD_PREFIX}${planId}`]: slim });
}

export async function loadScratchpad(planId: string): Promise<Scratchpad | null> {
  const key = `${SCRATCHPAD_PREFIX}${planId}`;
  const result = await chrome.storage.session.get(key);
  return (result[key] as Scratchpad) ?? null;
}

export async function clearScratchpad(planId: string): Promise<void> {
  await chrome.storage.session.remove(`${SCRATCHPAD_PREFIX}${planId}`);
}
