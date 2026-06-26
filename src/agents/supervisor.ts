import type { ChatTurn } from "@/ai/client";
import type {
  AgentPlan,
  AgentTask,
  GateRequest,
  Scratchpad,
  SupervisorResult,
} from "./types";
import type { AiMatchResult, AnalysisResult, MissingDataResult } from "@/shared/types";
import { CONFIDENCE } from "@/shared/constants";
import { getTabDomain } from "@/background/capture";
import { getCapturedRequests } from "@/background/storage";
import { saveScratchpad, loadScratchpad, clearScratchpad } from "./context";
import { captureAgent, reloadOnly } from "./capture-agent";
import { lookupAgent } from "./lookup-agent";
import { analysisAgent } from "./analysis-agent";
import { schemaAgent } from "./schema-agent";
import { verifyAgent } from "./verify-agent";
import { chatAgent } from "./chat-agent";

// ─── Intent classification (stays in supervisor — pure keyword matching) ───

const SCHEMA_KEYWORDS = [
  "prove", "verify", "schema", "assert", "check",
  "balance", "follower", "following", "reputation", "score",
  "greater", "less", "equal", "above", "below", "more than", "at least",
  ">", "<", ">=", "<=", "!=",
  "证明", "验证", "余额", "粉丝", "关注", "大于", "小于", "等于", "超过", "至少",
  "生成", "创建schema", "创建 schema",
];

const RELOAD_KEYWORDS = [
  "reload page", "reload", "refresh page", "refresh", "rescan", "re-scan", "recapture",
  "重新加载", "刷新页面", "刷新", "重新扫描", "重新捕获",
];

const CONTINUE_KEYWORDS = [
  "好了", "打开了", "继续", "可以了", "到了", "进去了",
  "已经", "看看", "试试", "再试", "好的", "可以继续", "已打开", "进入了",
  "done", "ready", "i'm on", "im on", "opened", "continue", "go ahead", "try again", "retry",
  "i've", "let's go", "proceed", "yes", "yep", "sure", "ok",
];

function classifyIntent(userMessage: string, chatHistory?: ChatTurn[]): "schema" | "chat" | "reload" {
  const lower = userMessage.toLowerCase();

  for (const kw of RELOAD_KEYWORDS) {
    if (lower.includes(kw)) return "reload";
  }
  for (const kw of SCHEMA_KEYWORDS) {
    if (lower.includes(kw)) return "schema";
  }

  if (chatHistory?.length) {
    const recent = chatHistory.slice(-4);
    const hasSchemaContext = recent.some(
      (t) =>
        t.role === "assistant" &&
        (t.content.includes('"selectedApi"') ||
          t.content.includes('"assertions"') ||
          t.content.includes('"apis"') ||
          t.content.includes('"confidence"')),
    );
    if (hasSchemaContext) return "schema";

    const hasAnalysisContext = recent.some(
      (t) => t.role === "assistant" && t.content.includes('"status":"analysis"'),
    );
    if (hasAnalysisContext) return "schema";

    const hasMissingDataContext = recent.some(
      (t) => t.role === "assistant" && t.content.includes('"missing_data"'),
    );
    if (hasMissingDataContext && CONTINUE_KEYWORDS.some((kw) => lower.includes(kw))) {
      return "schema";
    }
  }

  return "chat";
}

function shouldReuseCaptures(chatHistory?: ChatTurn[], hasRetryContext?: boolean): boolean {
  if (hasRetryContext) return true;
  if (!chatHistory?.length) return false;
  return chatHistory.slice(-6).some(
    (t) =>
      t.role === "assistant" &&
      (t.content.includes('"apis"') ||
        t.content.includes('"selectedApi"') ||
        t.content.includes('"status":"analysis"')),
  );
}

// ─── Plan helpers ───

let planCounter = 0;

function createTask(label: string, agentName: AgentPlan["tasks"][0]["agentName"]): AgentTask {
  return { id: `task_${++planCounter}`, label, status: "pending", agentName };
}

function createPlan(tasks: AgentTask[]): AgentPlan {
  return {
    id: `plan_${Date.now()}_${++planCounter}`,
    tasks,
    currentTaskIndex: 0,
    createdAt: Date.now(),
    status: "running",
  };
}

function markTask(plan: AgentPlan, index: number, status: AgentTask["status"], error?: string) {
  const task = plan.tasks[index];
  if (!task) return;
  task.status = status;
  if (status === "running") task.startedAt = Date.now();
  if (status === "completed" || status === "failed") task.completedAt = Date.now();
  if (error) task.error = error;
}

// ─── Core supervisor ───

export async function execute(
  tabId: number,
  userMessage: string,
  sendProgress: (msg: string) => void,
  chatHistory?: ChatTurn[],
  retryContext?: { originalQuery: string },
): Promise<SupervisorResult> {
  const domain = await getTabDomain(tabId);
  const intent = retryContext ? "schema" : classifyIntent(userMessage, chatHistory);

  // ── Reload intent: lightweight, no plan needed beyond capture ──
  if (intent === "reload") {
    const plan = createPlan([createTask("Reload & capture", "capture")]);
    markTask(plan, 0, "running");

    const result = await reloadOnly(tabId);
    if (!result.success) {
      markTask(plan, 0, "failed", result.error);
      plan.status = "failed";
      return { type: "error", plan, error: result.error };
    }

    markTask(plan, 0, "completed");
    plan.status = "completed";
    return {
      type: "reload_done",
      plan,
      reply: `Page reloaded. Captured ${result.captureCount} API source(s). You can now ask a verification question.`,
      captureCount: result.captureCount,
    };
  }

  // ── Chat intent: single-step ──
  if (intent === "chat") {
    const plan = createPlan([createTask("Chat response", "chat")]);
    markTask(plan, 0, "running");

    const scratchpad: Scratchpad = { tabId, domain, userMessage, chatHistory, intent };
    const out = await chatAgent.execute({ scratchpad, sendProgress });

    if (!out.success) {
      markTask(plan, 0, "failed", out.error);
      plan.status = "failed";
      return { type: "error", plan, error: out.error };
    }

    markTask(plan, 0, "completed");
    plan.status = "completed";
    return {
      type: "chat",
      plan,
      reply: out.scratchpadUpdates.rawAiResponse ?? "",
      rawAiContent: out.scratchpadUpdates.rawAiResponse,
    };
  }

  // ── Schema intent: multi-step pipeline ──
  return executeSchemaFlow(tabId, domain, userMessage, sendProgress, chatHistory, retryContext);
}

async function executeSchemaFlow(
  tabId: number,
  domain: string | null,
  userMessage: string,
  sendProgress: (msg: string) => void,
  chatHistory?: ChatTurn[],
  retryContext?: { originalQuery: string },
): Promise<SupervisorResult> {
  if (!domain) {
    const plan = createPlan([]);
    plan.status = "failed";
    return { type: "error", plan, error: "Cannot determine the current page's domain. Please open a regular website tab." };
  }

  const reuseCaptures = shouldReuseCaptures(chatHistory, !!retryContext);
  const needsReuse = reuseCaptures && (await getCapturedRequests(domain)).length > 0;

  const tasks = [
    createTask("Lookup reusable fields", "lookup"),
    createTask(needsReuse ? "Reuse captures" : "Capture API traffic", "capture"),
    createTask("AI analysis", "analysis"),
    createTask("Build schema", "schema"),
  ];
  const plan = createPlan(tasks);

  const scratchpad: Scratchpad = {
    tabId,
    domain,
    userMessage,
    chatHistory,
    retryContext,
    intent: "schema",
    reuseCaptures: needsReuse,
  };

  // Step 1: Lookup reusable endpoint and field knowledge
  markTask(plan, 0, "running");
  const lookupOut = await lookupAgent.execute({ scratchpad, sendProgress });
  if (!lookupOut.success) {
    markTask(plan, 0, "failed", lookupOut.error);
    plan.status = "failed";
    return { type: "error", plan, error: lookupOut.error };
  }
  Object.assign(scratchpad, lookupOut.scratchpadUpdates);
  markTask(plan, 0, "completed");

  // Step 2: Capture
  markTask(plan, 1, "running");
  const captureOut = await captureAgent.execute({ scratchpad, sendProgress });
  if (!captureOut.success) {
    markTask(plan, 1, "failed", captureOut.error);
    plan.status = "failed";
    return { type: "error", plan, error: captureOut.error };
  }
  Object.assign(scratchpad, captureOut.scratchpadUpdates);
  markTask(plan, 1, "completed");

  if (!scratchpad.candidates?.length) {
    markTask(plan, 2, "skipped");
    markTask(plan, 3, "skipped");
    plan.status = "completed";
    return {
      type: "chat",
      plan,
      reply: "I reloaded the page but didn't find any JSON API responses or meaningful HTML content. This could mean:\n\n- The page doesn't expose data in a capturable format\n- You might not be logged in\n- Try navigating to the specific page that shows the data you want to verify",
    };
  }

  // Step 3: Analysis
  markTask(plan, 2, "running");
  const analysisOut = await analysisAgent.execute({ scratchpad, sendProgress });
  if (!analysisOut.success) {
    markTask(plan, 2, "failed", analysisOut.error);
    plan.status = "failed";
    return { type: "error", plan, error: analysisOut.error, candidates: scratchpad.candidates };
  }
  Object.assign(scratchpad, analysisOut.scratchpadUpdates);
  markTask(plan, 2, "completed");

  // Check analysis result for gates
  const parsed = scratchpad.parsedResult;

  if (parsed && "error" in parsed) {
    markTask(plan, 3, "skipped");
    plan.status = "failed";
    return { type: "error", plan, error: `AI analysis error: ${parsed.error}`, candidates: scratchpad.candidates };
  }

  if (parsed && "status" in parsed) {
    const statusResult = parsed as MissingDataResult | AnalysisResult;

    if (statusResult.status === "missing_data") {
      markTask(plan, 3, "waiting");
      plan.status = "paused";
      await saveScratchpad(plan.id, scratchpad);
      const gate: GateRequest = {
        type: "missing_data",
        message: statusResult.message,
        data: { missing: statusResult.missing, candidates: scratchpad.candidates },
      };
      return {
        type: "missing_data",
        plan,
        gate,
        rawAiContent: scratchpad.rawAiResponse,
        candidates: scratchpad.candidates,
      };
    }

    if (statusResult.status === "analysis") {
      markTask(plan, 3, "waiting");
      plan.status = "paused";
      await saveScratchpad(plan.id, scratchpad);
      const gate: GateRequest = {
        type: "analysis_questions",
        message: statusResult.message,
        data: {
          understanding: statusResult.understanding,
          readyToBuild: statusResult.readyToBuild,
          candidates: scratchpad.candidates,
        },
      };
      return {
        type: "analysis",
        plan,
        gate,
        rawAiContent: scratchpad.rawAiResponse,
        candidates: scratchpad.candidates,
      };
    }
  }

  // Parsed is an AiMatchResult
  const aiResult = parsed as AiMatchResult;

  // Validate that selected APIs still exist in captures
  const captures = scratchpad.captures ?? [];
  const selections = aiResult.apis ?? [];
  const missingSelection = selections.find((s) => !captures.some((c) => c.id === s.apiId));
  if (missingSelection || !captures.some((c) => c.id === aiResult.selectedApi)) {
    markTask(plan, 3, "skipped");
    plan.status = "completed";
    return {
      type: "chat",
      plan,
      reply: "The AI referenced an API that's no longer in the captured traffic — the capture pool may have changed. Please try again, or browse the relevant page first.",
      rawAiContent: scratchpad.rawAiResponse,
      candidates: scratchpad.candidates,
    };
  }

  // Medium confidence gate
  if (aiResult.confidence < CONFIDENCE.HIGH) {
    markTask(plan, 3, "waiting");
    plan.status = "paused";
    await saveScratchpad(plan.id, scratchpad);
    const gate: GateRequest = {
      type: "confirm_medium_confidence",
      message: `Confidence: ${Math.round(aiResult.confidence * 100)}%. ${aiResult.reason}`,
      data: { aiResult, candidates: scratchpad.candidates },
    };
    return {
      type: "schema_pending",
      plan,
      aiResult,
      gate,
      rawAiContent: scratchpad.rawAiResponse,
      candidates: scratchpad.candidates,
    };
  }

  // Step 4: Build schema (high confidence)
  return buildSchemaStep(plan, scratchpad, sendProgress);
}

async function buildSchemaStep(
  plan: AgentPlan,
  scratchpad: Scratchpad,
  sendProgress: (msg: string) => void,
): Promise<SupervisorResult> {
  markTask(plan, 3, "running");
  const schemaOut = await schemaAgent.execute({ scratchpad, sendProgress });
  if (!schemaOut.success) {
    markTask(plan, 3, "failed", schemaOut.error);
    plan.status = "failed";
    return { type: "error", plan, error: schemaOut.error, candidates: scratchpad.candidates };
  }
  Object.assign(scratchpad, schemaOut.scratchpadUpdates);
  markTask(plan, 3, "completed");
  plan.status = "completed";

  return {
    type: "schema",
    plan,
    schema: scratchpad.schema,
    aiResult: scratchpad.parsedResult as AiMatchResult,
    rawAiContent: scratchpad.rawAiResponse,
    candidates: scratchpad.candidates,
  };
}

// ─── Resume after a gate ───

export async function resume(
  planId: string,
  sendProgress: (msg: string) => void,
): Promise<SupervisorResult> {
  const scratchpad = await loadScratchpad(planId);
  if (!scratchpad) {
    const plan = createPlan([]);
    plan.status = "failed";
    return { type: "error", plan, error: "Could not resume — session context was lost. Please try again." };
  }

  // Scratchpad was saved with only the AI-referenced captures (responseBody stripped).
  // Merge with fresh storage captures so buildSchema can find full capture metadata.
  if (scratchpad.domain) {
    const freshCaptures = await getCapturedRequests(scratchpad.domain);
    const savedCaptures = scratchpad.captures ?? [];
    // Build a map: saved captures (guaranteed to match AI apiIds) take priority,
    // then fill in from fresh storage for any additional entries.
    const byId = new Map(savedCaptures.map((c) => [c.id, c]));
    for (const fc of freshCaptures) {
      if (!byId.has(fc.id)) byId.set(fc.id, fc);
      else {
        // Prefer the fresh version if it has a responseBody (saved ones have it stripped)
        const saved = byId.get(fc.id)!;
        if (!saved.responseBody && fc.responseBody) byId.set(fc.id, fc);
      }
    }
    scratchpad.captures = Array.from(byId.values());
  }

  // Reconstruct a plan to reflect "resuming after gate"
  const tasks = [
    { ...createTask("Lookup reusable fields", "lookup"), status: "completed" as const, completedAt: Date.now() },
    { ...createTask("Capture API traffic", "capture"), status: "completed" as const, completedAt: Date.now() },
    { ...createTask("AI analysis", "analysis"), status: "completed" as const, completedAt: Date.now() },
    createTask("Build schema", "schema"),
  ];
  const plan = createPlan(tasks);

  await clearScratchpad(planId);
  return buildSchemaStep(plan, scratchpad, sendProgress);
}

// ─── Verify flow ───

export async function executeVerify(
  tabId: number,
  schema: import("@/shared/types").ZkPassSchema,
  sendProgress: (msg: string) => void,
): Promise<SupervisorResult> {
  const plan = createPlan([createTask("Submit & verify", "verify")]);
  markTask(plan, 0, "running");

  const scratchpad: Scratchpad = {
    tabId,
    domain: null,
    userMessage: "",
    schema,
  };

  const out = await verifyAgent.execute({ scratchpad, sendProgress });
  if (!out.success) {
    markTask(plan, 0, "failed", out.error);
    plan.status = "failed";
    return { type: "error", plan, error: out.error };
  }

  markTask(plan, 0, "completed");
  plan.status = "completed";
  return {
    type: "schema",
    plan,
    schema,
    ...(out.scratchpadUpdates.verifyResult ?? {}),
  };
}
