import { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [disabled]);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // !e.nativeEvent.isComposing: during IME composition, Enter only confirms the candidate and must not send
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-[#d8dec9] bg-white p-3 shadow-[0_-8px_24px_rgba(61,61,61,0.06)]">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to prove..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-[#272727] shadow-sm outline-none transition placeholder:text-[#bfc8b3] focus:border-[#3d3d3d] focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:bg-[#f3f5ec] disabled:text-[#9ca68f]"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="rounded-md bg-[#c5ff4a] px-4 py-2 text-sm font-semibold text-[#272727] shadow-sm transition hover:bg-[#b7f03f] focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {disabled ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
