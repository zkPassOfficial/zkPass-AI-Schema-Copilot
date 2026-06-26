import type { ApiCandidateSummary, MissingDataItem, AiMatchResult } from "@/shared/types";
import type { SupervisorResult } from "@/agents/types";

export function formatCandidatesList(candidates: ApiCandidateSummary[]): string {
  if (!candidates.length) return "";
  const lines = candidates.map((c, i) => {
    const leafFields = c.fields
      .filter((f) => f.type !== "object" && f.type !== "array")
      .slice(0, 8);
    const fieldList = leafFields.map((f) => `  \`${f.path}\` (${f.type}: ${f.sampleValue})`).join("\n");
    const more = c.fields.filter((f) => f.type !== "object" && f.type !== "array").length - leafFields.length;
    const moreText = more > 0 ? `\n  ... and ${more} more fields` : "";
    return `**${i + 1}. ${c.method} ${c.pathname}**\n  Host: ${c.host}\n  ID: \`${c.id}\`\n${fieldList}${moreText}`;
  });
  return `\n\n---\n**Captured APIs (${candidates.length}):**\n\n${lines.join("\n\n")}\n\nYou can specify which API to use, e.g.: "use API #1 to verify xxx"`;
}

export function formatMissingData(message: string, missing: MissingDataItem[]): string {
  if (!missing.length) return message;
  const items = missing.map((m) => {
    const pages = m.suggestedPages.length ? `\n  Suggested pages: ${m.suggestedPages.join(", ")}` : "";
    const fields = m.exampleFieldNames?.length ? `\n  Likely fields: ${m.exampleFieldNames.map((f) => `\`${f}\``).join(", ")}` : "";
    return `- **${m.what}**${pages}${fields}`;
  });
  return `${message}\n\n**Missing data:**\n${items.join("\n")}\n\nNavigate to the suggested page (keep this side panel open), then come back and tell me to continue — I'll combine the new data with what's already captured.`;
}

export function formatAnalysis(result: SupervisorResult): string {
  const understanding = result.gate?.data.understanding;
  let content = result.gate?.message || "Let me analyze your request...";

  if (understanding) {
    if (understanding.facts.length > 0) {
      content += "\n\n**What I understand:**\n" + understanding.facts.map((f) => `- ${f}`).join("\n");
    }
    if (understanding.assumptions.length > 0) {
      content += "\n\n**My assumptions:**\n" + understanding.assumptions.map((a) => `- ${a}`).join("\n");
    }
    if (understanding.questions.length > 0) {
      content += "\n\n**Questions:**\n" + understanding.questions.map((q) => `- ${q}`).join("\n");
    }
  }

  if (result.gate?.data.readyToBuild) {
    content += "\n\nReady to generate the schema. Say **\"go ahead\"** to proceed, or let me know if anything needs adjustment.";
  }

  return content;
}

export function formatSchemaMatch(aiResult: AiMatchResult): string {
  const apiInfo = aiResult.nullifierApi
    ? `**Data API:** \`${aiResult.selectedApi}\`\n**Identity API:** \`${aiResult.nullifierApi}\``
    : `**API:** \`${aiResult.selectedApi}\``;
  return `${apiInfo}\n**Field:** \`${aiResult.fieldPath}\`\n${aiResult.assertions.map((a) => `**Assert:** ${a.key} ${a.operation} ${a.value}`).join("\n")}\n\n${aiResult.reason}`;
}
