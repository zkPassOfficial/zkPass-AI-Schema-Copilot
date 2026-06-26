export const MessageType = {
  GET_CAPTURES: "GET_CAPTURES",
  CLEAR_CAPTURES: "CLEAR_CAPTURES",
  GET_CAPTURE_COUNT: "GET_CAPTURE_COUNT",
  GENERATE_SCHEMA: "GENERATE_SCHEMA",
  GET_AI_CONFIG: "GET_AI_CONFIG",
  SET_AI_CONFIG: "SET_AI_CONFIG",
  TEST_CONNECTION: "TEST_CONNECTION",
  VERIFY_PROGRESS: "VERIFY_PROGRESS",
  TAB_DOMAIN_CHANGED: "TAB_DOMAIN_CHANGED",
  AGENT_EXECUTE: "AGENT_EXECUTE",
  AGENT_RESUME: "AGENT_RESUME",
  AGENT_VERIFY: "AGENT_VERIFY",
  CAPTURE_COUNT_UPDATED: "CAPTURE_COUNT_UPDATED",
} as const;

export const CONFIDENCE = {
  HIGH: 0.85,
  MEDIUM: 0.6,
} as const;

export const VALID_OPERATIONS = ["=", ">", ">=", "<", "<=", "!=", "contain", "in"] as const;

export type AiProvider = "claude" | "openai";

export const PROVIDERS: { id: AiProvider; label: string }[] = [
  { id: "claude", label: "Claude (Anthropic)" },
  { id: "openai", label: "OpenAI" },
];

export const CLAUDE_MODELS = [
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const OPENAI_MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "gpt-4", label: "GPT-4" },
  { id: "o4-mini", label: "o4-mini" },
];

export function getModelsForProvider(provider: AiProvider) {
  return provider === "claude" ? CLAUDE_MODELS : OPENAI_MODELS;
}

export const DEFAULT_PROVIDER: AiProvider = "claude";
export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_CLAUDE_ENDPOINT = "https://api.anthropic.com";
export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com";

export function getDefaultEndpoint(provider: AiProvider): string {
  return provider === "claude" ? DEFAULT_CLAUDE_ENDPOINT : DEFAULT_OPENAI_ENDPOINT;
}

export function getDefaultModel(provider: AiProvider): string {
  return provider === "claude" ? DEFAULT_CLAUDE_MODEL : DEFAULT_OPENAI_MODEL;
}

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  endpoint: string;
}

export const MAX_RESPONSE_SIZE = 1_000_000;
export const MAX_INDEX_DEPTH = 10;

export const PAGE_SETTLE_DELAY_MS = 3000;
export const PAGE_SETTLE_POLL_MS = 500;
export const PAGE_SETTLE_TIMEOUT_MS = 15000;

export const ZKPASS_PROJECT_ID = "ae0cff72-f2a5-4673-9c3d-ad00404a6711";
export const ZKPASS_SCHEMA_SUBMIT_URL = "https://dev.zkpass.org/v1/schema/addSchemaBuilderInterface";
export const LOOKUP_API_URL = "https://schema-builder.zkpass.org/lookup";

export const MAX_HTML_SIZE = 2_000_000;
export const MAX_HTML_INDEX_FIELDS = 200;
