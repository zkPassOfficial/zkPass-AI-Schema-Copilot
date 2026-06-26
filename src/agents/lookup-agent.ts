import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import { lookupEndpoints } from "@/lookup/client";

export const lookupAgent: Subagent = {
  name: "lookup",

  async execute({ scratchpad, sendProgress }: SubagentInput): Promise<SubagentOutput> {
    if (!scratchpad.domain) {
      return { success: false, error: "Cannot determine the current page's domain.", scratchpadUpdates: {} };
    }

    sendProgress("Looking up reusable schema fields...");

    try {
      const endpoints = await lookupEndpoints(scratchpad.domain);
      sendProgress(
        endpoints.length > 0
          ? `Found ${endpoints.length} reusable endpoint definition(s).`
          : "No reusable endpoint definitions found. Continuing with captured traffic.",
      );
      return { success: true, scratchpadUpdates: { lookupEndpoints: endpoints } };
    } catch (err) {
      sendProgress("Lookup service unavailable. Continuing with captured traffic.");
      return {
        success: true,
        scratchpadUpdates: {
          lookupEndpoints: [],
          lookupError: err instanceof Error ? err.message : "Lookup failed.",
        },
      };
    }
  },
};
