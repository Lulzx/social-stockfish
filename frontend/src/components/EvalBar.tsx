/**
 * Stockfish-style evaluation bar. Vertical (fills from the bottom) on desktop,
 * horizontal (fills from the left) on mobile. The fill is proportional to the
 * best move's expected value (0..1); the number is pinned to the filled end.
 */
export function EvalBar({
  score,
  orientation = "vertical",
  className = "",
}: {
  score: number | null;
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const v = score ?? 0;
  const pct = Math.max(0, Math.min(1, v)) * 100;
  const high = v >= 0.5;

  if (orientation === "horizontal") {
    return (
      <div
        className={`relative h-[24px] w-full shrink-0 overflow-hidden border-b border-default-200 bg-[#dfe1e6] ${className}`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-[#0a84ff] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-black/15" />
        {score !== null && (
          <div
            className="absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums transition-all duration-500"
            style={{ left: `calc(${pct}% ${high ? "- 30px" : "+ 6px"})`, color: high ? "#fff" : "#1d2433" }}
          >
            {v.toFixed(2)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative h-full w-[34px] shrink-0 overflow-hidden border-r border-default-200 bg-[#dfe1e6] ${className}`}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-[#0a84ff] transition-[height] duration-500 ease-out"
        style={{ height: `${pct}%` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/15" />
      {score !== null && (
        <div
          className="absolute inset-x-0 flex justify-center text-[11px] font-bold tabular-nums transition-all duration-500"
          style={{ bottom: `calc(${pct}% ${high ? "- 18px" : "+ 4px"})`, color: high ? "#fff" : "#1d2433" }}
        >
          {v.toFixed(2)}
        </div>
      )}
    </div>
  );
}
