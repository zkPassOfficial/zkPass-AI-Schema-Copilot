import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import { callLlm } from "@/ai/client";
import type { ChatTurn } from "@/ai/client";
import { buildChatSystemPrompt } from "@/ai/prompts";
import { getAiConfig } from "@/background/storage";

async function callAi(systemPrompt: string, userPrompt: string, history?: ChatTurn[]): Promise<string> {
  const config = await getAiConfig();
  if (!config.apiKey) throw new Error("No API key configured. Please open extension Options to set up your AI provider.");
  return callLlm({ config, systemPrompt, userPrompt, history });
}

function sanitizeHistory(history: ChatTurn[]): ChatTurn[] {
  return history.map((t) => {
    if (t.role !== "assistant") return t;
    const trimmed = t.content.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
        !(trimmed.startsWith("[") && trimmed.endsWith("]"))) return t;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed.status === "missing_data") return { ...t, content: `[Missing data: ${parsed.message || "required data not found in captured traffic"}]` };
      if (parsed.status === "analysis") return { ...t, content: `[Analysis: ${parsed.message || "analyzing request"}]` };
      if (parsed.apis || parsed.selectedApi) return { ...t, content: `[Schema match found with confidence ${Math.round(((parsed.confidence as number) ?? 0) * 100)}%]` };
      return { ...t, content: "[Previous structured result]" };
    } catch { return t; }
  });
}

export const chatAgent: Subagent = {
  name: "chat",

  async execute({ scratchpad }: SubagentInput): Promise<SubagentOutput> {
    const { userMessage, chatHistory } = scratchpad;

    try {
      const history = chatHistory ? sanitizeHistory(chatHistory) : undefined;
      const reply = await callAi(buildChatSystemPrompt(), userMessage, history);
      return {
        success: true,
        scratchpadUpdates: { rawAiResponse: reply },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to call AI.",
        scratchpadUpdates: {},
      };
    }
  },
};
