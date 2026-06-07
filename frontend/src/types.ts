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

export interface RankedResult {
  id: number;
  text: string;
  strategy: string;
  score: number;
  samples: number;
}

export interface RolloutDot {
  candidateId: number;
  score: number;
}

export type EnginePhase = "idle" | "candidates" | "simulating" | "done" | "error";

// Server -> client websocket events (streamed)
export type ServerEvent =
  | { type: "status"; text: string }
  | { type: "persona"; persona: string }
  | { type: "candidate"; item: Candidate }
  | { type: "rollout"; candidateId: number; score: number; states: number }
  | { type: "results"; ranked: RankedResult[]; final?: boolean }
  | { type: "done" }
  | { type: "error"; text: string };
