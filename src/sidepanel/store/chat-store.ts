import { create } from "zustand";
import type { ChatMessage, ZkPassSchema, AiMatchResult } from "@/shared/types";
import type { SupervisorResult, AgentPlan, GateRequest } from "@/agents/types";
import { MessageType, CONFIDENCE } from "@/shared/constants";
import { sendToBackground } from "@/shared/messages";
import {
  formatCandidatesList,
  formatMissingData,
  formatAnalysis,
  formatSchemaMatch,
} from "../utils/format";

interface PendingMissingData {
  originalQuery: string;
  lastCandidateIds: string[];
}

interface ChatStore {
  messages: ChatMessage[];
  captureCount: number;
  isLoading: boolean;
  currentSchema: ZkPassSchema | null;
  currentPlan: AgentPlan | null;
  activeGate: GateRequest | null;
  activePlanId: string | null;
  pendingConfirmation: AiMatchResult | null;
  pendingQuery: string | null;
  pendingMissingData: PendingMissingData | null;
  verifyStatus: string | null;
  verifyStartTime: number | null;

  addMessage: (msg: ChatMessage) => void;
  setCaptureCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  setCurrentSchema: (schema: ZkPassSchema | null) => void;
  setPendingConfirmation: (result: AiMatchResult | null, query: string | null) => void;
  sendUserMessage: (text: string, opts?: { silent?: boolean; systemMessage?: string }) => Promise<void>;
  rerunForDomainChange: (domain: string) => Promise<void>;
  confirmSchema: () => Promise<void>;
  rejectSchema: () => void;
  clearChat: () => void;
  refreshCaptureCount: () => Promise<void>;
  startVerify: () => void;
  setVerifyStatus: (status: string) => void;
  endVerify: () => void;
}

function makeId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

type WireResult = SupervisorResult & { progressMessages?: string[] };

function sanitizeReply(reply: string): string {
  const trimmed = reply.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) return reply;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.status === "missing_data") {
      const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
      return formatMissingData(
        typeof parsed.message === "string" ? parsed.message : "Some required data wasn't found.",
        missing.map((m: Record<string, unknown>) => ({
          what: typeof m?.what === "string" ? m.what : "required data",
          suggestedPages: Array.isArray(m?.suggestedPages) ? m.suggestedPages.filter((p: unknown): p is string => typeof p === "string") : [],
          exampleFieldNames: Array.isArray(m?.exampleFieldNames) ? m.exampleFieldNames.filter((f: unknown): f is string => typeof f === "string") : undefined,
        })),
      );
    }
    if (parsed.status === "analysis") return typeof parsed.message === "string" ? parsed.message : reply;
    if (parsed.apis || parsed.selectedApi) {
      const conf = typeof parsed.confidence === "number" ? Math.round(parsed.confidence * 100) : 0;
      return `Found a match (${conf}% confidence). ${typeof parsed.reason === "string" ? parsed.reason : ""}`.trim();
    }
    if (typeof parsed.message === "string") return parsed.message;
  } catch { /* not JSON, use as-is */ }
  return reply;
}

function handleSupervisorResult(
  result: WireResult,
  text: string,
  get: () => ChatStore,
  set: (partial: Partial<ChatStore>) => void,
) {
  const { addMessage, setCurrentSchema, setPendingConfirmation } = get();

  if (result.progressMessages) {
    for (const msg of result.progressMessages) {
      addMessage({ id: makeId(), role: "system", content: msg, timestamp: Date.now() });
    }
  }

  set({ currentPlan: result.plan, activePlanId: result.plan?.id ?? null });

  switch (result.type) {
    case "chat":
    case "reload_done": {
      addMessage({
        id: makeId(),
        role: "assistant",
        content: sanitizeReply(result.reply || "Sorry, I couldn't generate a response."),
        rawAiContent: result.rawAiContent,
        timestamp: Date.now(),
      });
      break;
    }

    case "missing_data": {
      const missing = result.gate?.data.missing ?? [];
      const candidateIds = (result.candidates ?? []).map((c) => c.id);
      const prevPending = get().pendingMissingData;

      let content = formatMissingData(
        result.gate?.message || "Some required data wasn't found in the captured traffic.",
        missing,
      );
      if (
        prevPending &&
        prevPending.lastCandidateIds.length === candidateIds.length &&
        prevPending.lastCandidateIds.every((id) => candidateIds.includes(id))
      ) {
        content = `I still don't see any new data since last time.\n\n${content}`;
      }

      addMessage({
        id: makeId(),
        role: "assistant",
        content,
        rawAiContent: result.rawAiContent,
        timestamp: Date.now(),
      });

      set({
        activeGate: result.gate ?? null,
        pendingMissingData: {
          originalQuery: prevPending?.originalQuery ?? text,
          lastCandidateIds: candidateIds,
        },
      });
      break;
    }

    case "analysis": {
      const content = formatAnalysis(result);
      addMessage({
        id: makeId(),
        role: "assistant",
        content,
        rawAiContent: result.rawAiContent,
        timestamp: Date.now(),
        metadata: { capturedApis: result.candidates },
      });
      set({ activeGate: result.gate ?? null });
      break;
    }

    case "schema": {
      const { aiResult, schema } = result;
      if (!aiResult) break;
      set({ pendingMissingData: null, activeGate: null });

      const matchInfo = formatSchemaMatch(aiResult);
      if (schema) {
        addMessage({
          id: makeId(),
          role: "assistant",
          content: `Found a strong match (${Math.round(aiResult.confidence * 100)}% confidence).\n\n${matchInfo}`,
          rawAiContent: result.rawAiContent,
          timestamp: Date.now(),
          metadata: { confidence: aiResult.confidence, schema, aiResult },
        });
        setCurrentSchema(schema);
      }
      break;
    }

    case "schema_pending": {
      const { aiResult } = result;
      if (!aiResult) break;
      set({ pendingMissingData: null });

      const matchInfo = formatSchemaMatch(aiResult);
      if (aiResult.confidence >= CONFIDENCE.MEDIUM) {
        addMessage({
          id: makeId(),
          role: "assistant",
          content: `Found a possible match (${Math.round(aiResult.confidence * 100)}% confidence).\n\n${matchInfo}\n\nDo you want to generate the schema with this match?`,
          rawAiContent: result.rawAiContent,
          timestamp: Date.now(),
          metadata: { confidence: aiResult.confidence, aiResult },
        });
        setPendingConfirmation(aiResult, text);
        set({ activeGate: result.gate ?? null });
      } else {
        const lowConfApis = result.candidates?.length ? formatCandidatesList(result.candidates) : "";
        addMessage({
          id: makeId(),
          role: "assistant",
          content: `Low confidence match (${Math.round(aiResult.confidence * 100)}%). ${aiResult.reason}\n\nTry:\n- Navigating to the relevant page on the website\n- Interacting with the feature you want to verify\n- Rephrasing your request with more detail${lowConfApis}`,
          rawAiContent: result.rawAiContent,
          timestamp: Date.now(),
          metadata: { confidence: aiResult.confidence, aiResult, capturedApis: result.candidates },
        });
      }
      break;
    }

    case "error": {
      const errorApiList = result.candidates?.length ? formatCandidatesList(result.candidates) : "";
      addMessage({
        id: makeId(),
        role: "assistant",
        content: `Error: ${result.error}${errorApiList}`,
        timestamp: Date.now(),
        metadata: { capturedApis: result.candidates },
      });
      break;
    }
  }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  captureCount: 0,
  isLoading: false,
  currentSchema: null,
  currentPlan: null,
  activeGate: null,
  activePlanId: null,
  pendingConfirmation: null,
  pendingQuery: null,
  pendingMissingData: null,
  verifyStatus: null,
  verifyStartTime: null,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  setCaptureCount: (count) => set({ captureCount: count }),

  setLoading: (loading) => set({ isLoading: loading }),

  setCurrentSchema: (schema) => set({ currentSchema: schema }),

  startVerify: () => set({ verifyStatus: "Starting...", verifyStartTime: Date.now() }),
  setVerifyStatus: (status) => set({ verifyStatus: status }),
  endVerify: () => set({ verifyStatus: null, verifyStartTime: null }),

  setPendingConfirmation: (result, query) =>
    set({ pendingConfirmation: result, pendingQuery: query }),

  clearChat: () =>
    set({
      messages: [],
      currentSchema: null,
      currentPlan: null,
      activeGate: null,
      activePlanId: null,
      pendingConfirmation: null,
      pendingQuery: null,
      pendingMissingData: null,
      verifyStatus: null,
      verifyStartTime: null,
    }),

  refreshCaptureCount: async () => {
    const tabId = await getActiveTabId();
    if (tabId === undefined) return;
    const count = await sendToBackground<number>(MessageType.GET_CAPTURE_COUNT, { tabId });
    set({ captureCount: count });
  },

  sendUserMessage: async (text: string, opts?: { silent?: boolean; systemMessage?: string }) => {
    const { addMessage, setLoading, setCurrentSchema, setPendingConfirmation, refreshCaptureCount } = get();

    if (opts?.silent && opts.systemMessage) {
      addMessage({ id: makeId(), role: "system", content: opts.systemMessage, timestamp: Date.now() });
    } else {
      addMessage({ id: makeId(), role: "user", content: text, timestamp: Date.now() });
    }

    setLoading(true);
    setCurrentSchema(null);
    setPendingConfirmation(null, null);

    try {
      const tabId = await getActiveTabId();

      const chatHistory = get().messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-(20 + 1), -1)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.rawAiContent ?? m.content }));

      const pendingMissing = get().pendingMissingData;
      const retryContext = pendingMissing ? { originalQuery: pendingMissing.originalQuery } : undefined;

      const result = await sendToBackground<WireResult>(
        MessageType.AGENT_EXECUTE,
        { tabId, userMessage: text, chatHistory, retryContext },
      );

      if (!result) {
        addMessage({ id: makeId(), role: "assistant", content: "Unexpected error. Please try again.", timestamp: Date.now() });
        setLoading(false);
        return;
      }

      await refreshCaptureCount();
      handleSupervisorResult(result, text, get, (partial) => set(partial));
    } catch (err) {
      addMessage({
        id: makeId(),
        role: "assistant",
        content: `Error: ${err instanceof Error ? err.message : "Unknown error occurred."}`,
        timestamp: Date.now(),
      });
    }

    setLoading(false);
  },

  rerunForDomainChange: async (domain: string) => {
    const { messages, isLoading, sendUserMessage, refreshCaptureCount } = get();
    if (isLoading) return;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      await refreshCaptureCount();
      return;
    }

    const tabId = await getActiveTabId();
    if (tabId !== undefined) {
      await sendToBackground(MessageType.CLEAR_CAPTURES, { tabId });
    }

    await sendUserMessage(lastUserMsg.content, {
      silent: true,
      systemMessage: `Switched to ${domain}. Re-analyzing with previous query...`,
    });
  },

  confirmSchema: async () => {
    const { activePlanId, addMessage, setCurrentSchema, setPendingConfirmation, setLoading } = get();

    if (activePlanId) {
      setLoading(true);
      try {
        const result = await sendToBackground<WireResult>(
          MessageType.AGENT_RESUME,
          { planId: activePlanId },
        );
        if (result) {
          handleSupervisorResult(result, "", get, (partial) => set(partial));
        }
      } catch (err) {
        addMessage({
          id: makeId(),
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          timestamp: Date.now(),
        });
      }
      setLoading(false);
      setPendingConfirmation(null, null);
      set({ activeGate: null });
      return;
    }

    // Fallback for old-style confirmation
    const { pendingConfirmation, pendingQuery } = get();
    if (!pendingConfirmation || !pendingQuery) return;

    const tabId = await getActiveTabId();
    if (tabId === undefined) return;

    const genResult = await sendToBackground<{ success: true; schema: ZkPassSchema } | { success: false; error: string }>(
      MessageType.GENERATE_SCHEMA,
      { tabId, aiResult: pendingConfirmation, userQuery: pendingQuery },
    );

    if (genResult?.success) {
      addMessage({
        id: makeId(),
        role: "assistant",
        content: "Schema generated successfully!",
        timestamp: Date.now(),
        metadata: { schema: genResult.schema },
      });
      setCurrentSchema(genResult.schema);
      set({ pendingMissingData: null });
    } else {
      addMessage({
        id: makeId(),
        role: "assistant",
        content: `Failed to generate schema: ${genResult && "error" in genResult ? genResult.error : "Unknown error"}`,
        timestamp: Date.now(),
      });
    }

    setPendingConfirmation(null, null);
  },

  rejectSchema: () => {
    const { addMessage, setPendingConfirmation } = get();
    setPendingConfirmation(null, null);
    set({ activeGate: null, activePlanId: null });
    addMessage({
      id: makeId(),
      role: "assistant",
      content: "Schema rejected. Try rephrasing your request or browsing a different page.",
      timestamp: Date.now(),
    });
  },
}));
