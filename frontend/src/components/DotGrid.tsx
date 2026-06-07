import { useEffect, useRef, useState } from "react";
import type { Candidate } from "../types";

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
      setRevealed((r) => (r >= targetRef.current ? r : Math.min(targetRef.current, r + perTick)));
    }, intervalMs);
    return () => clearInterval(id);
  }, [target, perTick, intervalMs]);

  useEffect(() => {
    if (target < revealed) setRevealed(target);
  }, [target, revealed]);

  return revealed;
}

function scoreColor(score: number): string {
  if (score >= 0.7) return "#34c759";
  if (score >= 0.45) return "#ffd60a";
  if (score >= 0.25) return "#ff9f0a";
  return "#ff3b30";
}

function labelFor(candidates: Candidate[], cid: number): string {
  return candidates.find((c) => c.id === cid)?.text ?? `move ${cid}`;
}

export interface Dot {
  candidateId: number;
  score?: number;
}

export function StateGrid({
  dots,
  candidates,
  onSelect,
  max = 400,
}: {
  dots: Dot[];
  candidates: Candidate[];
  onSelect: (dot: Dot) => void;
  max?: number;
}) {
  const target = Math.min(dots.length, max);
  const revealed = useProgressive(target, 4);
  return (
    <div className="flex flex-wrap gap-[5px]">
      {dots.slice(0, revealed).map((d, i) => (
        <button
          key={i}
          onClick={() => onSelect(d)}
          title={labelFor(candidates, d.candidateId)}
          className="dot-pop h-[7px] w-[7px] rounded-full transition-transform hover:scale-150"
          style={{ background: "#0a84ff", animationDelay: `${(i % 12) * 4}ms` }}
        />
      ))}
    </div>
  );
}

export function MonteCarloGrid({
  dots,
  candidates,
  onSelect,
  max = 240,
}: {
  dots: Dot[];
  candidates: Candidate[];
  onSelect: (dot: Dot) => void;
  max?: number;
}) {
  const target = Math.min(dots.length, max);
  const revealed = useProgressive(target, 3);
  return (
    <div className="flex flex-wrap gap-[5px]">
      {dots.slice(0, revealed).map((d, i) => (
        <button
          key={i}
          onClick={() => onSelect(d)}
          title={`${labelFor(candidates, d.candidateId)} · ${(d.score ?? 0).toFixed(2)}`}
          className="dot-pop h-[8px] w-[8px] rounded-full transition-transform hover:scale-150"
          style={{ background: scoreColor(d.score ?? 0), animationDelay: `${(i % 12) * 4}ms` }}
        />
      ))}
    </div>
  );
}
