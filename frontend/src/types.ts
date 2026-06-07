export type Sender = "me" | "them";

export interface Message {
  id: string;
  sender: Sender;
  text: string;
}

export interface Candidate {
  id: number;
  text: string;
  strategy: string;
}

export interface Classification {
  kind: string; // brilliant | great | best | excellent | good | inaccuracy | mistake | blunder
  label: string;
  symbol: string; // !! | ! | * | "" | ?! | ? | ??
  color: string; // hex
}

export interface RankedResult {
  id: number;
  text: string;
  strategy: string;
  score: number;
  swing: number;
  classification: Classification;
  samples: number;
}

export interface ReviewRow {
  i: number;
  sender: Sender;
  text: string;
  eval: number;
  swing?: number;
  classification?: Classification;
  note?: string;
  better?: string;
}

export interface RolloutDot {
  candidateId: number;
  score: number;
}

export type EnginePhase = "idle" | "candidates" | "simulating" | "done" | "error";

// Server -> client websocket events (streamed)
export type ServerEvent =
  | { type: "status"; text: string }
  | { type: "position"; positionEval: number; note: string; persona: string }
  | { type: "persona"; persona: string }
  | { type: "candidate"; item: Candidate }
  | { type: "rollout"; candidateId: number; score: number; states: number }
  | { type: "results"; ranked: RankedResult[]; final?: boolean; positionEval: number }
  | { type: "review"; rows: ReviewRow[]; finalEval: number; goal: string }
  | { type: "done" }
  | { type: "error"; text: string };
