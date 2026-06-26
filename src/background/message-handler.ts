import { MessageType } from "@/shared/constants";
import type { AiConfig } from "@/shared/constants";
import type { ZkPassSchema } from "@/shared/types";
import {
  getCapturedRequests,
  getCaptureCount,
  clearCapturedRequests,
  getAiConfig,
  setAiConfig,
} from "./storage";
import { getTabDomain } from "./capture";
import { testConnection } from "@/ai/client";
import type { ChatTurn } from "@/ai/client";
import { buildSchema } from "@/schema/builder";
import { execute as supervisorExecute, resume as supervisorResume, executeVerify as supervisorVerify } from "@/agents/supervisor";

export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { type, payload } = message;

    switch (type) {
      case MessageType.GET_CAPTURES: {
        const tabId = payload?.tabId;
        if (tabId === undefined) return false;
        getTabDomain(tabId).then((domain) => {
          if (!domain) {
            sendResponse([]);
            return;
          }
          getCapturedRequests(domain).then(sendResponse);
        });
        return true;
      }

      case MessageType.GET_CAPTURE_COUNT: {
        const tabId = payload?.tabId;
        if (tabId === undefined) {
          sendResponse(0);
          return false;
        }
        getTabDomain(tabId).then((domain) => {
          if (!domain) {
            sendResponse(0);
            return;
          }
          getCaptureCount(domain).then(sendResponse);
        });
        return true;
      }

      case MessageType.CLEAR_CAPTURES: {
        const tabId = payload?.tabId;
        if (tabId === undefined) {
          clearCapturedRequests().then(() => sendResponse(true));
          return true;
        }
        getTabDomain(tabId).then((domain) =>
          clearCapturedRequests(domain ?? undefined).then(() => sendResponse(true))
        );
        return true;
      }

      case MessageType.GET_AI_CONFIG: {
        getAiConfig().then(sendResponse);
        return true;
      }

      case MessageType.SET_AI_CONFIG: {
        const config = payload as AiConfig | undefined;
        if (!config) {
          sendResponse(false);
          return false;
        }
        setAiConfig(config).then(() => sendResponse(true));
        return true;
      }

      case MessageType.TEST_CONNECTION: {
        const config = payload as AiConfig | undefined;
        if (!config?.apiKey) {
          sendResponse(false);
          return false;
        }
        testConnection(config)
          .then(sendResponse)
          .catch(() => sendResponse(false));
        return true;
      }

      case MessageType.GENERATE_SCHEMA: {
        const { tabId, aiResult, userQuery } = payload || {};
        if (!tabId || !aiResult || !userQuery) {
          sendResponse({ success: false, error: "Missing required parameters." });
          return false;
        }
        getTabDomain(tabId).then((domain) => {
          if (!domain) {
            sendResponse({ success: false, error: "Cannot determine the current page's domain." });
            return;
          }
          getCapturedRequests(domain).then((captures) => {
            const schema = buildSchema({ aiResult, captures, userQuery });
            if ("error" in schema) {
              sendResponse({ success: false, error: schema.error });
              return;
            }
            sendResponse({ success: true, schema });
          });
        });
        return true;
      }

      case MessageType.AGENT_EXECUTE: {
        const { tabId, userMessage, chatHistory: agentHistory, retryContext: agentRetry } = payload || {};
        if (!userMessage) {
          sendResponse({ type: "error", error: "Empty message." });
          return false;
        }
        const progressMsgs: string[] = [];
        supervisorExecute(
          tabId ?? -1,
          userMessage,
          (msg) => progressMsgs.push(msg),
          agentHistory as ChatTurn[] | undefined,
          agentRetry as { originalQuery: string } | undefined,
        ).then((result) => {
          sendResponse({ ...result, progressMessages: progressMsgs });
        }).catch((err) => {
          sendResponse({ type: "error", error: err instanceof Error ? err.message : "Unexpected error in agent." });
        });
        return true;
      }

      case MessageType.AGENT_RESUME: {
        const { planId } = payload || {};
        if (!planId) {
          sendResponse({ type: "error", error: "No plan ID provided." });
          return false;
        }
        const resumeMsgs: string[] = [];
        supervisorResume(planId, (msg) => resumeMsgs.push(msg)).then((result) => {
          sendResponse({ ...result, progressMessages: resumeMsgs });
        }).catch((err) => {
          sendResponse({ type: "error", error: err instanceof Error ? err.message : "Unexpected error resuming agent." });
        });
        return true;
      }

      case MessageType.AGENT_VERIFY: {
        const { tabId: verifyTabId, schema: verifySchema } = payload || {};
        if (!verifyTabId || !verifySchema) {
          sendResponse({ type: "error", error: "Missing tabId or schema." });
          return false;
        }
        const verifyMsgs: string[] = [];
        supervisorVerify(
          verifyTabId,
          verifySchema as ZkPassSchema,
          (msg) => verifyMsgs.push(msg),
        ).then((result) => {
          sendResponse({ ...result, progressMessages: verifyMsgs });
        }).catch((err) => {
          sendResponse({ type: "error", error: err instanceof Error ? err.message : "Unexpected error in verification." });
        });
        return true;
      }

      default:
        return false;
    }
  });
}
