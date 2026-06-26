import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import { callLlm } from "@/ai/client";
import type { ChatTurn } from "@/ai/client";
import { buildSystemPrompt, buildUserPrompt } from "@/ai/prompts";
import { parseAiResponse } from "@/ai/response-parser";
import { getAiConfig } from "@/background/storage";

async function callAi(systemPrompt: string, userPrompt: string, history?: ChatTurn[]): Promise<string> {
  const config = await getAiConfig();
  if (!config.apiKey) throw new Error("No API key configured. Please open extension Options to set up your AI provider.");
  return callLlm({ config, systemPrompt, userPrompt, history });
}

export const analysisAgent: Subagent = {
  name: "analysis",

  async execute({ scratchpad }: SubagentInput): Promise<SubagentOutput> {
    const { candidates, lookupEndpoints, userMessage, chatHistory, retryContext } = scratchpad;

    if (!candidates || candidates.length === 0) {
      return { success: false, error: "No API candidates to analyze.", scratchpadUpdates: {} };
    }

    const effectiveQuery = retryContext
      ? `Original verification request: "${retryContext.originalQuery}"\nUser's follow-up: "${userMessage}"`
      : userMessage;

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(effectiveQuery, candidates, lookupEndpoints);

    let rawResponse: string;
    try {
      rawResponse = await callAi(systemPrompt, userPrompt, chatHistory);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : "Failed to call AI.", scratchpadUpdates: {} };
    }

    const parsed = parseAiResponse(rawResponse, candidates, lookupEndpoints);

    return {
      success: true,
      scratchpadUpdates: {
        rawAiResponse: rawResponse,
        parsedResult: parsed,
      },
    };
  },
};
