import { useEffect, useState } from "react";

// Animated ellipsis: '' -> '.' -> '..' -> '...' looping
function AnimatedDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const t = setInterval(() => setDots((p) => (p.length >= 3 ? "" : p + ".")), 400);
    return () => clearInterval(t);
  }, []);
  return <span className="inline-block w-3 text-left">{dots}</span>;
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${(sec % 60).toString().padStart(2, "0")}s`;
}

interface VerificationBlockProps {
  status: string;
  startTime: number;
}

export default function VerificationBlock({ status, startTime }: VerificationBlockProps) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startTime) / 1000));
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startTime]);

  return (
    <div className="mb-3 flex justify-start">
      <div className="rounded-lg border border-[#d8dec9] bg-white px-3 py-2 text-sm shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#3d3d3d]">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="#d8dec9" strokeWidth="2" />
            <path d="M12.5 7a5.5 5.5 0 00-5.5-5.5" stroke="#c5ff4a" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>Verifying</span>
          <span className="text-[#65705d]">{formatElapsed(elapsed)}</span>
        </div>
        <div className="mt-1 flex items-center text-xs text-[#65705d]">
          {status}
          <AnimatedDots />
        </div>
      </div>
    </div>
  );
}
