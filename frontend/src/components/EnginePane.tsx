import { useMemo, useState } from "react";
import { Avatar, Button, Chip, Input, Spinner } from "@heroui/react";
import type { EngineState } from "../useEngine";
import type { Candidate, Message, RankedResult } from "../types";
import { type Dot, MonteCarloGrid, StateGrid } from "./DotGrid";
import { MoveBadge } from "./MoveBadge";
import { ReviewPanel } from "./ReviewPanel";
import { SimulateModal } from "./SimulateModal";

const STATE_PER_ROLLOUT = 5; // matches ROLLOUT_DEPTH on the backend

interface Props {
  engine: EngineState;
  goal: string;
  messages: Message[];
  onGoalChange: (g: string) => void;
  onPick: (r: RankedResult) => void;
  onAnalyze: () => void;
  onReview: () => void;
  onPaste: () => void;
  onActiveMove: (msgIndex: number | null) => void;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1.5 text-default-500">
        <span className="text-default-400">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

const card = "rounded-2xl bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-default-100";

export function EnginePane({
  engine,
  goal,
  messages,
  onGoalChange,
  onPick,
  onAnalyze,
  onReview,
  onPaste,
  onActiveMove,
}: Props) {
  const busy = engine.phase === "candidates" || engine.phase === "simulating";
  const [selDot, setSelDot] = useState<Dot | null>(null);

  // Monte Carlo dots = one per rollout; state-exploration dots = several per
  // rollout. Both carry the candidate id AND that rollout's score, so each dot
  // simulates its own outcome (a failed dot fizzles, a winning dot lands).
  const mcDots: Dot[] = engine.rollouts.map((r) => ({ candidateId: r.candidateId, score: r.score }));
  const stateDots: Dot[] = useMemo(
    () =>
      engine.rollouts.flatMap((r) =>
        Array.from({ length: STATE_PER_ROLLOUT }, () => ({ candidateId: r.candidateId, score: r.score }))
      ),
    [engine.rollouts]
  );
  const selected = selDot ? engine.candidates.find((c) => c.id === selDot.candidateId) ?? null : null;
  const reviewing = engine.mode === "review";
  const showReview = reviewing && engine.review && engine.review.length > 0;
  // Collapse the big header once the position has been evaluated at least once.
  const evaluated =
    engine.positionEval !== null || engine.ranked.length > 0 || showReview;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#f5f5f7] px-4 py-4 sm:px-5">
      {/* header — collapses to a slim bar once a position has been evaluated */}
      {evaluated ? (
        <div className="mb-3 flex items-center gap-2">
          <Avatar
            src="/stockfish.webp"
            radius="sm"
            className="h-6 w-6 bg-white ring-1 ring-default-200"
            imgProps={{ className: "object-contain p-0.5" }}
          />
          <span className="text-[14px] font-bold text-default-900">Social Stockfish</span>
          <span
            className={`ml-auto h-2 w-2 rounded-full ${engine.connected ? "bg-success-500" : "bg-default-300"}`}
            title={engine.connected ? "Connected" : "Offline"}
          />
        </div>
      ) : (
        <div className="relative mb-5 flex flex-col items-center pt-2">
          <span
            className={`absolute right-0 top-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
              engine.connected ? "bg-success-100 text-success-700" : "bg-default-200 text-default-500"
            }`}
          >
            {engine.connected ? "Connected" : "Offline"}
          </span>
          <Avatar
            src="/stockfish.webp"
            radius="lg"
            className="mb-2 h-14 w-14 bg-white ring-1 ring-default-200"
            imgProps={{ className: "object-contain p-1" }}
          />
          <h1 className="text-[19px] font-bold tracking-tight text-default-900">Social Stockfish</h1>
          <span className="text-[12px] text-default-400">v0.1</span>
        </div>
      )}

      {/* conversation goal */}
      <Section icon={<GoalIcon />} title="Conversation Goal">
        <Input
          value={goal}
          onValueChange={onGoalChange}
          placeholder="Enter your goal..."
          variant="bordered"
          radius="lg"
          onKeyDown={(e) => e.key === "Enter" && !busy && goal.trim() && onAnalyze()}
          classNames={{
            inputWrapper: "bg-white border-default-200 shadow-none data-[hover=true]:border-default-300",
            input: "text-[14px]",
          }}
        />
        {engine.positionEval !== null && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-default-100">
            <span className="rounded bg-default-900 px-1.5 py-0.5 font-bold tabular-nums text-white">
              {engine.positionEval.toFixed(2)}
            </span>
            <span className="text-default-500">{engine.positionNote || "position eval"}</span>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Button
            onPress={onAnalyze}
            isDisabled={!engine.connected || !goal.trim() || busy}
            isLoading={busy && !reviewing}
            radius="lg"
            className="flex-1 bg-[#0a84ff] font-semibold text-white"
          >
            {busy && !reviewing ? engine.status || "Analyzing..." : "Analyze position"}
          </Button>
          <Button
            onPress={onReview}
            isDisabled={!engine.connected || !goal.trim() || busy}
            isLoading={busy && reviewing}
            radius="lg"
            className="flex-1 bg-[#7cae3e] font-semibold text-white"
          >
            {busy && reviewing ? "Reviewing..." : "Game Review"}
          </Button>
        </div>
        <button
          onClick={onPaste}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-default-300 py-1.5 text-[12px] font-medium text-default-500 hover:border-default-400 hover:text-default-700"
        >
          <PasteIcon /> Paste a conversation (WhatsApp / Telegram)
        </button>
      </Section>

      {showReview ? (
        <Section icon={<StarIcon />} title="Game Review">
          <ReviewPanel rows={engine.review!} reviewId={engine.reviewId} onActive={onActiveMove} />
        </Section>
      ) : (
        <AnalysisView
          engine={engine}
          busy={busy}
          mcDots={mcDots}
          stateDots={stateDots}
          onPick={onPick}
          onSelect={setSelDot}
        />
      )}

      <SimulateModal
        candidate={selected}
        score={selDot?.score ?? null}
        goal={goal}
        messages={messages}
        onClose={() => setSelDot(null)}
      />
    </div>
  );
}

function AnalysisView({
  engine,
  busy,
  mcDots,
  stateDots,
  onPick,
  onSelect,
}: {
  engine: EngineState;
  busy: boolean;
  mcDots: Dot[];
  stateDots: Dot[];
  onPick: (r: RankedResult) => void;
  onSelect: (dot: Dot) => void;
}) {
  const candidates: Candidate[] = engine.candidates;
  return (
    <>
      {/* analysis results */}
      <Section icon={<SearchIcon />} title="Analysis Results">
        <div className="flex flex-col gap-1.5">
          {engine.ranked.length === 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-[13px] text-default-400 ring-1 ring-default-100">
              {busy ? <Spinner size="sm" color="default" /> : null}
              {busy ? engine.status || "Thinking..." : 'Set a goal and hit "Analyze position" to compute the best move.'}
            </div>
          )}
          {engine.ranked.map((r, idx) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="group flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 text-left ring-1 ring-default-100 transition hover:ring-[#0a84ff]/40 hover:shadow-sm"
            >
              <span
                className={`shrink-0 rounded-md px-1.5 py-1 text-[12px] font-bold tabular-nums text-white ${
                  idx === 0 ? "bg-[#0a84ff]" : "bg-[#0a84ff]/80"
                }`}
              >
                {r.score.toFixed(2)}
              </span>
              {r.classification && <MoveBadge c={r.classification} size={20} />}
              <span className="flex-1 text-[13.5px] leading-tight text-default-800">{r.text}</span>
              {r.strategy && (
                <Chip size="sm" variant="flat" className="hidden h-5 shrink-0 text-[10px] text-default-500 sm:flex">
                  {r.strategy}
                </Chip>
              )}
            </button>
          ))}
        </div>
      </Section>

      {/* conversation state exploration */}
      <Section icon={<TreeIcon />} title="Conversational State Exploration">
        <div className={card}>
          {stateDots.length === 0 ? (
            <div className="py-3 text-center text-[12px] text-default-300">
              {busy ? "Exploring conversation tree..." : "—"}
            </div>
          ) : (
            <>
              <StateGrid dots={stateDots} candidates={candidates} onSelect={onSelect} />
              <p className="mt-2 text-[10px] text-default-400">hover a node, or click to see a sample chat</p>
            </>
          )}
        </div>
      </Section>

      {/* monte carlo evaluation */}
      <Section icon={<PalmIcon />} title="Monte Carlo Evaluation">
        <div className={card}>
          {mcDots.length === 0 ? (
            <div className="py-3 text-center text-[12px] text-default-300">
              {busy ? "Running Monte Carlo simulations..." : "—"}
            </div>
          ) : (
            <>
              <MonteCarloGrid dots={mcDots} candidates={candidates} onSelect={onSelect} />
              <div className="mt-2.5 flex items-center gap-3 text-[10px] text-default-400">
                <Legend color="#34c759" label="goal reached" />
                <Legend color="#ffd60a" label="promising" />
                <Legend color="#ff3b30" label="failed" />
                <span className="ml-auto tabular-nums">{mcDots.length} sims</span>
              </div>
            </>
          )}
        </div>
      </Section>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/* --- tiny inline icons (no extra deps) --- */
const ico = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const GoalIcon = () => (<svg {...ico}><circle cx="12" cy="12" r="9" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>);
const SearchIcon = () => (<svg {...ico}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>);
const TreeIcon = () => (<svg {...ico}><circle cx="12" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /><path d="M12 7v4M12 11l-6 6M12 11l6 6" /></svg>);
const PalmIcon = () => (<svg {...ico}><path d="M12 22V9M12 9c0-3-3-5-6-4M12 9c0-3 3-5 6-4M12 9c-2-2-5-2-7 0M12 9c2-2 5-2 7 0" /></svg>);
const StarIcon = () => (<svg {...ico}><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01L12 2z" /></svg>);
const PasteIcon = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>);
