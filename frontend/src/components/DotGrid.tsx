import { useEffect, useRef, useState } from "react";

/** Smoothly climbs a revealed counter toward `target` for a live "filling" feel. */
function useProgressive(target: number, perTick = 3, intervalMs = 16) {
  const [revealed, setRevealed] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (target === 0) {
      setRevealed(0);
      return;
    }
    const id = setInterval(() => {
      setRevealed((r) => {
        if (r >= targetRef.current) return r;
        return Math.min(targetRef.current, r + perTick);
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [target, perTick, intervalMs]);

  // snap down instantly on reset
  useEffect(() => {
    if (target < revealed) setRevealed(target);
  }, [target, revealed]);

  return revealed;
}

function scoreColor(score: number): string {
  if (score >= 0.7) return "#34c759"; // green — goal achieved
  if (score >= 0.45) return "#ffd60a"; // gold — promising
  if (score >= 0.25) return "#ff9f0a"; // orange — shaky
  return "#ff3b30"; // red — failed rollout
}

export function StateGrid({ count, max = 320 }: { count: number; max?: number }) {
  const target = Math.min(count, max);
  const revealed = useProgressive(target, 4);
  return (
    <div className="flex flex-wrap gap-[5px]">
      {Array.from({ length: revealed }).map((_, i) => (
        <span
          key={i}
          className="dot-pop h-[7px] w-[7px] rounded-full"
          style={{ background: "#0a84ff", animationDelay: `${(i % 12) * 4}ms` }}
        />
      ))}
    </div>
  );
}

export function MonteCarloGrid({
  scores,
  max = 240,
}: {
  scores: number[];
  max?: number;
}) {
  const target = Math.min(scores.length, max);
  const revealed = useProgressive(target, 3);
  return (
    <div className="flex flex-wrap gap-[5px]">
      {scores.slice(0, revealed).map((sc, i) => (
        <span
          key={i}
          className="dot-pop h-[8px] w-[8px] rounded-full"
          style={{ background: scoreColor(sc), animationDelay: `${(i % 12) * 4}ms` }}
          title={sc.toFixed(2)}
        />
      ))}
    </div>
  );
}
