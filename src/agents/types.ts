import type { ChatTurn } from "@/ai/client";
import type {
  AiMatchResult,
  AnalysisResult,
  ApiCandidateSummary,
  CapturedRequest,
  MissingDataItem,
  MissingDataResult,
  ZkPassSchema,
} from "@/shared/types";
import type { LookupEndpoint } from "@/lookup/client";

// ─── Plan / Task tracking ───

export type TaskStatus = "pending" | "running" | "completed" | "skipped" | "failed" | "waiting";

export type AgentName = "lookup" | "capture" | "analysis" | "schema" | "verify" | "chat";

export interface AgentTask {
  id: string;
  label: string;
  status: TaskStatus;
  agentName: AgentName;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface AgentPlan {
  id: string;
  tasks: AgentTask[];
  currentTaskIndex: number;
  createdAt: number;
  status: "running" | "paused" | "completed" | "failed";
}

// ─── Shared scratchpad (context passed between agents) ───

export interface Scratchpad {
  tabId: number;
  domain: string | null;
  userMessage: string;
  chatHistory?: ChatTurn[];
  retryContext?: { originalQuery: string };
  intent?: "schema" | "chat" | "reload";
  reuseCaptures?: boolean;

  // Written by LookupAgent
  lookupEndpoints?: LookupEndpoint[];
  lookupError?: string;

  // Written by CaptureAgent
  captures?: CapturedRequest[];
  candidates?: ApiCandidateSummary[];

  // Written by AnalysisAgent
  rawAiResponse?: string;
  parsedResult?: AiMatchResult | MissingDataResult | AnalysisResult | { error: string };

  // Written by SchemaAgent
  schema?: ZkPassSchema;

  // Written by VerifyAgent
  verifyResult?: { success: boolean; code?: string; error?: string; [key: string]: unknown };
}

// ─── Subagent interface ───

export interface SubagentInput {
  scratchpad: Scratchpad;
  sendProgress: (msg: string) => void;
}

export interface SubagentOutput {
  success: boolean;
  error?: string;
  scratchpadUpdates: Partial<Scratchpad>;
}

export interface Subagent {
  name: AgentName;
  execute(input: SubagentInput): Promise<SubagentOutput>;
}

// ─── Human-in-the-loop gates ───

export type GateType =
  | "confirm_medium_confidence"
  | "missing_data"
  | "analysis_questions";

export interface GateRequest {
  type: GateType;
  message: string;
  data: {
    aiResult?: AiMatchResult;
    missing?: MissingDataItem[];
    understanding?: AnalysisResult["understanding"];
    readyToBuild?: boolean;
    candidates?: ApiCandidateSummary[];
  };
}

// ─── Supervisor result ───

export type SupervisorResultType =
  | "chat"
  | "schema"
  | "schema_pending"
  | "missing_data"
  | "analysis"
  | "low_confidence"
  | "error"
  | "reload_done";

export interface SupervisorResult {
  type: SupervisorResultType;
  plan: AgentPlan;

  reply?: string;
  schema?: ZkPassSchema;
  aiResult?: AiMatchResult;
  gate?: GateRequest;
  candidates?: ApiCandidateSummary[];
  rawAiContent?: string;
  error?: string;
  captureCount?: number;
}
