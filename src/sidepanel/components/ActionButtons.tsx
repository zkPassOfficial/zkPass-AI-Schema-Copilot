import { useState } from "react";
import type { ZkPassSchema } from "@/shared/types";
import type { SupervisorResult } from "@/agents/types";
import { sendToBackground } from "@/shared/messages";
import { MessageType } from "@/shared/constants";
import { useChatStore } from "../store/chat-store";

interface ActionButtonsProps {
  schema: ZkPassSchema;
}

export default function ActionButtons({ schema }: ActionButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [trying, setTrying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const clearChat = useChatStore((s) => s.clearChat);
  const setCurrentSchema = useChatStore((s) => s.setCurrentSchema);
  const refreshCaptureCount = useChatStore((s) => s.refreshCaptureCount);
  const addMessage = useChatStore((s) => s.addMessage);
  const startVerify = useChatStore((s) => s.startVerify);
  const endVerify = useChatStore((s) => s.endVerify);

  function msgId() {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const json = JSON.stringify(schema, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const host = schema.APIs[0]?.host || "unknown";
    const name = host.replace(/^(www\.|api\.)/, "").split(".")[0];
    a.href = url;
    a.download = `zkpass-schema-${name}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRescan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    setScanning(true);
    setCurrentSchema(null);

    try {
      await sendToBackground(MessageType.CLEAR_CAPTURES, { tabId: tab.id });
      await chrome.tabs.reload(tab.id);
      addMessage({ id: msgId(), role: "system", content: "Re-scanning page for API traffic...", timestamp: Date.now() });
      await new Promise((r) => setTimeout(r, 3000));
      await refreshCaptureCount();
      addMessage({ id: msgId(), role: "system", content: "Page re-scanned. You can now ask a new verification question.", timestamp: Date.now() });
    } catch {
      addMessage({ id: msgId(), role: "system", content: "Re-scan failed. Please try refreshing the page manually.", timestamp: Date.now() });
    } finally {
      setScanning(false);
    }
  }

  async function handleTryIt() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    setTrying(true);
    startVerify();

    try {
      const result = await sendToBackground<SupervisorResult & { progressMessages?: string[] }>(
        MessageType.AGENT_VERIFY,
        { tabId: tab.id, schema },
      );

      if (!result) {
        addMessage({ id: msgId(), role: "assistant", content: "Verification failed: no response.", timestamp: Date.now() });
      } else if (result.type === "error") {
        addMessage({ id: msgId(), role: "assistant", content: `Verification failed: ${result.error || "Unknown error"}`, timestamp: Date.now() });
      } else {
        addMessage({
          id: msgId(),
          role: "assistant",
          content: `Verification successful!\n\n**Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
          timestamp: Date.now(),
        });
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      addMessage({ id: msgId(), role: "assistant", content: `Verification failed: ${errorMsg}`, timestamp: Date.now() });
    } finally {
      setTrying(false);
      endVerify();
    }
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-[#d8dec9] bg-white px-3 pb-3 pt-3">
      <button
        onClick={handleTryIt}
        disabled={trying}
        className="rounded-md bg-[#c5ff4a] px-3 py-1.5 text-xs font-semibold text-[#272727] shadow-sm transition hover:bg-[#b7f03f] focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {trying ? "Verifying..." : "Try It"}
      </button>
      <button
        onClick={handleCopy}
        className="rounded-md bg-[#3d3d3d] px-3 py-1.5 text-xs font-semibold text-[#f8fcef] shadow-sm transition hover:bg-[#272727] focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
      >
        {copied ? "Copied!" : "Copy JSON"}
      </button>
      <button
        onClick={handleDownload}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#3d3d3d] shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
      >
        Download
      </button>
      <button
        onClick={handleRescan}
        disabled={scanning}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#3d3d3d] shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {scanning ? "Scanning..." : "Re-scan"}
      </button>
      <button
        onClick={clearChat}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#3d3d3d] shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
      >
        New Query
      </button>
    </div>
  );
}
