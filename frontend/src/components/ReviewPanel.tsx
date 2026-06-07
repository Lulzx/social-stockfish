import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import type { ReviewRow } from "../types";
import { MoveBadge } from "./MoveBadge";

// chess.com-style classification order for the breakdown table
const ORDER = [
  ["brilliant", "Brilliant", "!!", "#1bada6"],
  ["great", "Great", "!", "#5b8baf"],
  ["best", "Best", "*", "#7cae3e"],
  ["excellent", "Excellent", "", "#7cae3e"],
  ["good", "Good", "", "#95b776"],
  ["inaccuracy", "Inaccuracy", "?!", "#e6b32a"],
  ["mistake", "Mistake", "?", "#e0892a"],
  ["blunder", "Blunder", "??", "#e0392a"],
] as const;

function moveAccuracy(swing: number): number {
  // 0 or positive swing ≈ 100; penalize negative swings (a -0.3 blunder ≈ 20)
  return Math.max(0, Math.min(100, 100 * (1 - Math.max(0, -swing) * 2.6)));
}

export function ReviewPanel({
  rows,
  reviewId,
  onActive,
}: {
  rows: ReviewRow[];
  reviewId: number | null;
  onActive: (msgIndex: number | null) => void;
}) {
  const myMoves = useMemo(() => rows.filter((r) => r.sender === "me" && r.classification), [rows]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of myMoves) c[r.classification!.kind] = (c[r.classification!.kind] || 0) + 1;
    return c;
  }, [myMoves]);
  const accuracy = useMemo(() => {
    if (!myMoves.length) return 0;
    return myMoves.reduce((a, r) => a + moveAccuracy(r.swing ?? 0), 0) / myMoves.length;
  }, [myMoves]);

  const [step, setStep] = useState(0);
  const cur = myMoves[step];
  const [showBest, setShowBest] = useState(false);
  const [shared, setShared] = useState(false);

  const share = async () => {
    const url = reviewId ? `${location.origin}/?review=${reviewId}` : location.href;
    const blunders = counts["blunder"] || 0;
    const text = `My Social Stockfish game review: ${accuracy.toFixed(1)} accuracy${
      blunders ? `, ${blunders} blunder${blunders > 1 ? "s" : ""}` : ""
    }.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Social Stockfish Game Review", text, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      /* user cancelled share */
    }
  };

  useEffect(() => setShowBest(false), [step]);
  useEffect(() => {
    onActive(cur ? cur.i : null);
    return () => onActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.i]);

  if (!myMoves.length) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* eval graph */}
      <EvalGraph rows={rows} activeIndex={cur?.i} />

      {/* accuracy + breakdown */}
      <div className="rounded-2xl bg-white p-3.5 ring-1 ring-default-100">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-default-500">
            Your accuracy
          </span>
          <span className="text-[20px] font-bold tabular-nums text-default-900">
            {accuracy.toFixed(1)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {ORDER.filter(([k]) => counts[k]).map(([kind, label, symbol, color]) => (
            <div key={kind} className="flex items-center gap-2 text-[13px]">
              <MoveBadge c={{ kind, label, symbol, color }} size={20} />
              <span className="text-default-600">{label}</span>
              <span className="ml-auto font-semibold tabular-nums" style={{ color }}>
                {counts[kind]}
              </span>
            </div>
          ))}
        </div>
        <Button
          onPress={share}
          size="sm"
          radius="lg"
          startContent={<ShareIcon />}
          className="mt-3 w-full bg-default-900 font-semibold text-white"
        >
          {shared ? "Link copied!" : "Share review"}
        </Button>
      </div>

      {/* coach stepper */}
      <Coach row={cur} showBest={showBest} onBest={() => setShowBest((v) => !v)} />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="flat"
          isDisabled={step === 0}
          onPress={() => setStep((s) => Math.max(0, s - 1))}
          className="flex-1"
        >
          ← Prev
        </Button>
        <span className="text-[12px] tabular-nums text-default-400">
          move {step + 1} / {myMoves.length}
        </span>
        <Button
          size="sm"
          isDisabled={step >= myMoves.length - 1}
          onPress={() => setStep((s) => Math.min(myMoves.length - 1, s + 1))}
          className="flex-1 bg-[#7cae3e] font-semibold text-white"
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

function Coach({
  row,
  showBest,
  onBest,
}: {
  row: ReviewRow;
  showBest: boolean;
  onBest: () => void;
}) {
  const c = row.classification!;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const stop = () => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  };

  // Stop any playing audio when the move changes or the coach unmounts, so two
  // clips never overlap when you play one then step to the next move.
  useEffect(() => {
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.i]);

  const speak = async () => {
    stop(); // never let a previous clip keep playing
    const line = `Your message "${row.text}" is ${article(c.label)} ${c.label}. ${row.note || ""}`;
    try {
      setSpeaking(true);
      const r = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line }),
      });
      if (!r.ok) throw new Error("tts");
      const a = new Audio(URL.createObjectURL(await r.blob()));
      audioRef.current = a;
      a.onended = () => setSpeaking(false);
      await a.play();
    } catch {
      setSpeaking(false);
    }
  };

  return (
    <div className="flex gap-2.5">
      <div className="flex shrink-0 flex-col items-center gap-0.5 self-start">
        <img
          src="/stockfish.webp"
          alt="Coach James"
          className="h-10 w-10 rounded-lg bg-white object-contain p-0.5 ring-1 ring-default-200"
        />
        <span className="text-[10px] font-semibold text-default-500">James</span>
      </div>
      <div className="relative flex-1 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-default-100">
        {/* bubble tail */}
        <span className="absolute -left-1.5 top-3 h-3 w-3 rotate-45 border-b border-l border-default-100 bg-white" />
        <div className="mb-1.5 flex items-center gap-2">
          <MoveBadge c={c} size={22} />
          <span className="text-[15px] font-bold" style={{ color: c.color }}>
            {c.label}
            {c.symbol ? ` ${c.symbol}` : ""}
          </span>
          <span className="ml-auto rounded-md bg-default-100 px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-default-700">
            {row.eval.toFixed(2)}
          </span>
          <button
            onClick={() => (speaking ? stop() : speak())}
            title={speaking ? "Stop" : "Hear the coach"}
            className={`flex h-6 w-6 items-center justify-center rounded-md text-default-500 hover:bg-default-100 ${
              speaking ? "animate-pulse text-[#0a84ff]" : ""
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3z" />
              <path
                d="M16 8a4 4 0 0 1 0 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="mb-1 text-[13.5px] leading-snug text-default-800">
          “{row.text}” {row.swing !== undefined ? (
            <span className="tabular-nums text-default-400">({row.swing >= 0 ? "+" : ""}{row.swing.toFixed(2)})</span>
          ) : null}
        </p>
        {row.note && <p className="text-[13.5px] leading-snug text-default-600">{row.note}</p>}
        {row.better && (
          <div className="mt-2">
            <button
              onClick={onBest}
              className="flex items-center gap-1.5 rounded-md bg-default-100 px-2 py-1 text-[12px] font-semibold text-default-700 hover:bg-default-200"
            >
              <MoveBadge c={{ kind: "best", label: "Best", symbol: "*", color: "#7cae3e" }} size={16} />
              {showBest ? "Hide best move" : "Show best move"}
            </button>
            {showBest && (
              <p className="mt-1.5 rounded-lg bg-[#7cae3e]/10 px-2.5 py-1.5 text-[13px] text-default-800">
                {row.better}
              </p>
            )}
          </div>
        )}
        <p className="mt-1 text-[11px] text-default-400">— James, your coach</p>
      </div>
    </div>
  );
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

const ShareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

function EvalGraph({ rows, activeIndex }: { rows: ReviewRow[]; activeIndex?: number }) {
  const W = 100;
  const H = 56;
  const n = rows.length;
  const pts = rows.map((r, idx) => {
    const x = n > 1 ? (idx / (n - 1)) * W : 0;
    const y = H - r.eval * H;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <div className="overflow-hidden rounded-2xl bg-[#262421] p-0 ring-1 ring-default-100">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[68px] w-full">
        {/* upper half (you winning) lighter */}
        <rect x="0" y="0" width={W} height={H / 2} fill="#ffffff14" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#ffffff30" strokeWidth="0.4" />
        <polygon points={area} fill="#ffffffcc" />
        <polyline points={line} fill="none" stroke="#ffffff" strokeWidth="0.6" />
        {rows.map((r, idx) =>
          r.classification ? (
            <circle
              key={idx}
              cx={pts[idx][0]}
              cy={pts[idx][1]}
              r={idx === activeIndex ? 2.2 : 1.5}
              fill={r.classification.color}
              stroke={idx === activeIndex ? "#fff" : "none"}
              strokeWidth="0.6"
            />
          ) : null
        )}
      </svg>
    </div>
  );
}
