/**
 * Stockfish-style evaluation bar. The blue fill grows from the bottom in
 * proportion to the best move's expected value (0..1); the number is pinned to
 * the filled end like a chess eval gauge. Empty/grey = goal not yet reachable.
 */
export function EvalBar({ score }: { score: number | null }) {
  const v = score ?? 0;
  const pct = Math.max(0, Math.min(1, v)) * 100;
  const high = v >= 0.5;
  return (
    <div className="relative h-full w-[34px] shrink-0 overflow-hidden border-r border-default-200 bg-[#dfe1e6]">
      {/* fill */}
      <div
        className="absolute inset-x-0 bottom-0 bg-[#0a84ff] transition-[height] duration-500 ease-out"
        style={{ height: `${pct}%` }}
      />
      {/* midpoint tick */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-black/15" />
      {/* score, pinned just inside the filled end */}
      {score !== null && (
        <div
          className="absolute inset-x-0 flex justify-center text-[11px] font-bold tabular-nums transition-all duration-500"
          style={{
            bottom: `calc(${pct}% ${high ? "- 18px" : "+ 4px"})`,
            color: high ? "#fff" : "#1d2433",
          }}
        >
          {v.toFixed(2)}
        </div>
      )}
    </div>
  );
}
