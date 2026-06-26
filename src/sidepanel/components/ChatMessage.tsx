import type { ChatMessage as ChatMessageType } from "@/shared/types";
import { CONFIDENCE } from "@/shared/constants";

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence >= CONFIDENCE.HIGH
      ? "bg-[#f4ffd8] text-[#456000] ring-1 ring-[#c5ff4a]/60"
      : confidence >= CONFIDENCE.MEDIUM
      ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
      : "bg-red-50 text-red-700 ring-1 ring-red-200";

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {pct}% confidence
    </span>
  );
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block ```lang ... ```: render in <pre> to preserve indentation/whitespace and allow horizontal scroll (e.g. verification result JSON)
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre
          key={`code-${i}`}
          className="my-1 overflow-x-auto rounded-md border border-[#d8dec9] bg-[#f8fcef] p-2 font-mono text-xs leading-relaxed text-[#272727]"
        >
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.trim() === "---") {
      elements.push(<hr key={i} className="my-2 border-[#d8dec9]" />);
      continue;
    }

    elements.push(
      <div key={i}>
        {renderInline(line)}
      </div>
    );
  }

  return <>{elements}</>;
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(
        <code key={key++} className="rounded bg-[#f4ffd8] px-1 py-0.5 font-mono text-xs text-[#3d3d3d]">
          {match[3]}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
          isUser
            ? "bg-[#3d3d3d] text-[#f8fcef]"
            : message.role === "system"
            ? "border border-[#d8dec9] bg-[#f8fcef] text-center text-xs text-[#65705d]"
            : "border border-[#d8dec9] bg-white text-[#272727]"
        }`}
      >
        <div className="break-words">
          {isUser || message.role === "system"
            ? <span className="whitespace-pre-wrap">{message.content}</span>
            : renderMarkdown(message.content)}
        </div>
        {message.metadata?.confidence !== undefined && (
          <div className="mt-2">
            <ConfidenceBadge confidence={message.metadata.confidence} />
          </div>
        )}
      </div>
    </div>
  );
}
