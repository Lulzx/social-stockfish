import { Avatar, Button, Chip, Input, Spinner } from "@heroui/react";
import type { EngineState } from "../useEngine";
import type { RankedResult } from "../types";
import { MonteCarloGrid, StateGrid } from "./DotGrid";

interface Props {
  engine: EngineState;
  goal: string;
  onGoalChange: (g: string) => void;
  onPick: (r: RankedResult) => void;
  onAnalyze: () => void;
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

export function EnginePane({ engine, goal, onGoalChange, onPick, onAnalyze }: Props) {
  const busy = engine.phase === "candidates" || engine.phase === "simulating";
  const scores = engine.rollouts.map((r) => r.score);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#f5f5f7] px-5 py-4">
      {/* header */}
      <div className="relative mb-5 flex flex-col items-center pt-2">
        <span
          className={`absolute right-0 top-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            engine.connected
              ? "bg-success-100 text-success-700"
              : "bg-default-200 text-default-500"
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
        <Button
          onPress={onAnalyze}
          isDisabled={!engine.connected || !goal.trim() || busy}
          isLoading={busy}
          radius="lg"
          className="mt-2 w-full bg-[#0a84ff] font-semibold text-white"
        >
          {busy ? engine.status || "Analyzing..." : "Analyze position"}
        </Button>
      </Section>

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
          {engine.stateNodes === 0 ? (
            <div className="py-3 text-center text-[12px] text-default-300">
              {busy ? "Exploring conversation tree..." : "—"}
            </div>
          ) : (
            <StateGrid count={engine.stateNodes} />
          )}
        </div>
      </Section>

      {/* monte carlo evaluation */}
      <Section icon={<PalmIcon />} title="Monte Carlo Evaluation">
        <div className={card}>
          {scores.length === 0 ? (
            <div className="py-3 text-center text-[12px] text-default-300">
              {busy ? "Running Monte Carlo simulations..." : "—"}
            </div>
          ) : (
            <>
              <MonteCarloGrid scores={scores} />
              <div className="mt-2.5 flex items-center gap-3 text-[10px] text-default-400">
                <Legend color="#34c759" label="goal reached" />
                <Legend color="#ffd60a" label="promising" />
                <Legend color="#ff3b30" label="failed" />
                <span className="ml-auto tabular-nums">{scores.length} sims</span>
              </div>
            </>
          )}
        </div>
      </Section>
    </div>
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
