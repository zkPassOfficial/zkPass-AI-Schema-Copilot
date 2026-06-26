import type { Subagent, SubagentInput, SubagentOutput } from "./types";
import type { AiMatchResult } from "@/shared/types";
import { buildSchema } from "@/schema/builder";

export const schemaAgent: Subagent = {
  name: "schema",

  async execute({ scratchpad }: SubagentInput): Promise<SubagentOutput> {
    const { parsedResult, captures, lookupEndpoints, userMessage, retryContext } = scratchpad;

    if (!parsedResult || "error" in parsedResult || "status" in parsedResult) {
      return { success: false, error: "No valid AI match result to build schema from.", scratchpadUpdates: {} };
    }

    const aiResult = parsedResult as AiMatchResult;
    const effectiveQuery = retryContext
      ? `Original verification request: "${retryContext.originalQuery}"\nUser's follow-up: "${userMessage}"`
      : userMessage;

    const schema = buildSchema({
      aiResult,
      captures: captures ?? [],
      userQuery: effectiveQuery,
      lookupEndpoints,
    });
    if ("error" in schema) {
      return { success: false, error: schema.error, scratchpadUpdates: {} };
    }

    return {
      success: true,
      scratchpadUpdates: { schema },
    };
  },
};
