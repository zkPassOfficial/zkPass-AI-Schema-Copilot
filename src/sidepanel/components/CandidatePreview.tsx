import { useChatStore } from "../store/chat-store";

export default function CandidatePreview() {
  const pendingConfirmation = useChatStore((s) => s.pendingConfirmation);
  const confirmSchema = useChatStore((s) => s.confirmSchema);
  const rejectSchema = useChatStore((s) => s.rejectSchema);

  if (!pendingConfirmation) return null;

  const { assertions, nullifier, confidence } = pendingConfirmation;
  const pct = Math.round(confidence * 100);

  return (
    <div className="mx-3 mb-3 rounded-lg border border-[#d8dec9] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#272727]">Confirm this match?</span>
        <span className="rounded-full bg-[#f4ffd8] px-2 py-0.5 text-xs font-medium text-[#456000] ring-1 ring-[#c5ff4a]/60">
          {pct}% confidence
        </span>
      </div>
      <div className="space-y-1 rounded-md border border-[#d8dec9] bg-[#f8fcef] p-2 text-xs text-[#3d3d3d]">
        {assertions.map((a, i) => (
          <div key={i}>
            <span className="font-medium">Assert:</span> {a.key} {a.operation} {a.value}
          </div>
        ))}
        {nullifier && (
          <div>
            <span className="font-medium">Nullifier:</span> {nullifier}
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={confirmSchema}
          className="flex-1 rounded-md bg-[#c5ff4a] px-3 py-1.5 text-xs font-semibold text-[#272727] shadow-sm transition hover:bg-[#b7f03f] focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
        >
          Confirm & Generate
        </button>
        <button
          onClick={rejectSchema}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#3d3d3d] shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-[#c5ff4a]/35"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
