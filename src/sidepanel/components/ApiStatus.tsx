import { useEffect } from "react";
import { useChatStore } from "../store/chat-store";

export default function ApiStatus() {
  const captureCount = useChatStore((s) => s.captureCount);
  const refreshCaptureCount = useChatStore((s) => s.refreshCaptureCount);

  useEffect(() => {
    refreshCaptureCount();
    const interval = setInterval(refreshCaptureCount, 3000);
    return () => clearInterval(interval);
  }, [refreshCaptureCount]);

  const hasCaptures = captureCount > 0;

  return (
    <div className="flex items-center gap-2 text-xs text-[#65705d]">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          hasCaptures ? "bg-[#c5ff4a] ring-2 ring-[#c5ff4a]/35" : "bg-slate-300"
        }`}
      />
      <span>
        {hasCaptures
          ? `${captureCount} API${captureCount !== 1 ? "s" : ""} captured`
          : "No APIs captured — browse the website first"}
      </span>
    </div>
  );
}
