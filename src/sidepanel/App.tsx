import { useEffect, useRef } from "react";
import { useChatStore } from "./store/chat-store";
import ChatMessage from "./components/ChatMessage";
import ChatInput from "./components/ChatInput";
import ApiStatus from "./components/ApiStatus";
import CandidatePreview from "./components/CandidatePreview";
import SchemaPreview from "./components/SchemaPreview";
import ActionButtons from "./components/ActionButtons";
import VerificationBlock from "./components/VerificationBlock";
import { MessageType } from "@/shared/constants";
import { sendToBackground } from "@/shared/messages";
import { exportCapturesAsHtml } from "./utils/export-swagger-html";
import type { CapturedRequest } from "@/shared/types";

export default function App() {
  const messages = useChatStore((s) => s.messages);
  const isLoading = useChatStore((s) => s.isLoading);
  const currentSchema = useChatStore((s) => s.currentSchema);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const verifyStatus = useChatStore((s) => s.verifyStatus);
  const verifyStartTime = useChatStore((s) => s.verifyStartTime);
  const captureCount = useChatStore((s) => s.captureCount);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function handleExport() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const captures = await sendToBackground<CapturedRequest[]>(MessageType.GET_CAPTURES, { tabId: tab.id });
    if (!captures?.length) return;
    let domain: string;
    try { domain = new URL(tab.url || "").hostname; } catch { domain = "unknown"; }
    exportCapturesAsHtml(captures, domain);
  }

  useEffect(() => {
    const listener = (message: { type?: string; status?: string; payload?: { domain?: string; count?: number; text?: string } }) => {
      if (message?.type === MessageType.VERIFY_PROGRESS && message.status) {
        useChatStore.getState().setVerifyStatus(message.status);
      }
      if (message?.type === MessageType.TAB_DOMAIN_CHANGED && message.payload?.domain) {
        useChatStore.getState().rerunForDomainChange(message.payload.domain);
      }
      if (message?.type === MessageType.CAPTURE_COUNT_UPDATED && typeof message.payload?.count === "number") {
        useChatStore.getState().setCaptureCount(message.payload.count);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, currentSchema, verifyStatus]);

  return (
    <div className="flex h-screen flex-col bg-[#f3f5ec] text-[#272727]">
      <header className="border-b border-[#d8dec9] bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <img
            src="/icons/zkpass-logomark.svg"
            alt="zkPass"
            className="h-8 w-8 rounded-md border border-[#c5ff4a]/40 bg-[#3d3d3d]"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6f8f12]">
              Schema Copilot
            </p>
            <h1 className="truncate text-sm font-semibold text-[#272727]">zkPass AI</h1>
          </div>
          <button
            onClick={handleExport}
            disabled={captureCount === 0}
            title="Export captured APIs as HTML"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#3d3d3d] shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Export
          </button>
        </div>
        <div className="mt-1">
          <ApiStatus />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-[#65705d]">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-[#d8dec9] bg-white shadow-sm">
              <img
                src="/icons/zkpass-logomark.svg"
                alt=""
                className="h-9 w-9 rounded-md"
              />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#272727]">What do you want to verify?</p>
            <p className="max-w-[240px] text-xs leading-5">
              Browse a website while logged in, then describe what you want to prove.
            </p>
            <div className="mt-4 space-y-1.5 text-xs text-[#65705d]">
              <p className="rounded-md border border-[#d8dec9] bg-white px-3 py-1.5 shadow-sm">
                {'"Prove my GitHub followers > 100"'}
              </p>
              <p className="rounded-md border border-[#d8dec9] bg-white px-3 py-1.5 shadow-sm">
                {'"Verify my Binance BTC balance >= 1"'}
              </p>
              <p className="rounded-md border border-[#d8dec9] bg-white px-3 py-1.5 shadow-sm">
                {'"Show my Twitter account is verified"'}
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="mb-3 flex justify-start">
            <div className="rounded-lg border border-[#d8dec9] bg-white px-3 py-2 text-sm text-[#65705d] shadow-sm">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
              </span>
              {" "}Analyzing APIs...
            </div>
          </div>
        )}

        {verifyStatus !== null && verifyStartTime !== null && (
          <VerificationBlock status={verifyStatus} startTime={verifyStartTime} />
        )}
      </div>

      <CandidatePreview />

      {currentSchema && (
        <>
          <SchemaPreview schema={currentSchema} />
          <ActionButtons schema={currentSchema} />
        </>
      )}

      <ChatInput onSend={sendUserMessage} disabled={isLoading || verifyStatus !== null} />
    </div>
  );
}
