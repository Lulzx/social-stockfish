import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Candidate,
  EnginePhase,
  Message,
  RankedResult,
  ReviewRow,
  RolloutDot,
  ServerEvent,
} from "./types";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export interface EngineState {
  connected: boolean;
  mode: "analyze" | "review";
  phase: EnginePhase;
  status: string;
  persona: string;
  positionEval: number | null;
  positionNote: string;
  candidates: Candidate[];
  ranked: RankedResult[];
  rollouts: RolloutDot[];
  stateNodes: number;
  review: ReviewRow[] | null;
  finalEval: number | null;
  error: string | null;
}

const initial: EngineState = {
  connected: false,
  mode: "analyze",
  phase: "idle",
  status: "",
  persona: "",
  positionEval: null,
  positionNote: "",
  candidates: [],
  ranked: [],
  rollouts: [],
  stateNodes: 0,
  review: null,
  finalEval: null,
  error: null,
};

export function useEngine() {
  const [state, setState] = useState<EngineState>(initial);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      reconnectRef.current = setTimeout(connect, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerEvent;
      setState((s) => reduce(s, msg));
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = (payload: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const analyze = useCallback((messages: Message[], goal: string, contact?: string) => {
    if (!goal.trim()) return;
    setState((s) => ({
      ...s,
      mode: "analyze",
      phase: "candidates",
      status: "Evaluating the position...",
      persona: "",
      positionEval: null,
      positionNote: "",
      candidates: [],
      ranked: [],
      rollouts: [],
      stateNodes: 0,
      review: null,
      finalEval: null,
      error: null,
    }));
    send({
      type: "analyze",
      goal,
      contact,
      messages: messages.map((m) => ({ sender: m.sender, text: m.text })),
    });
  }, []);

  const review = useCallback((messages: Message[], goal: string, contact?: string) => {
    if (!goal.trim() || !messages.length) return;
    setState((s) => ({
      ...s,
      mode: "review",
      phase: "simulating",
      status: "Reviewing the game...",
      review: null,
      finalEval: null,
      error: null,
    }));
    send({
      type: "review",
      goal,
      contact,
      messages: messages.map((m) => ({ sender: m.sender, text: m.text })),
    });
  }, []);

  return { state, analyze, review };
}

function reduce(s: EngineState, ev: ServerEvent): EngineState {
  switch (ev.type) {
    case "status":
      return {
        ...s,
        status: ev.text,
        phase: ev.text.toLowerCase().includes("monte") ? "simulating" : s.phase,
      };
    case "position":
      return { ...s, positionEval: ev.positionEval, positionNote: ev.note, persona: ev.persona };
    case "persona":
      return { ...s, persona: ev.persona, phase: "candidates" };
    case "candidate":
      return { ...s, candidates: [...s.candidates, ev.item], phase: "candidates" };
    case "rollout":
      return {
        ...s,
        phase: "simulating",
        rollouts: [...s.rollouts, { candidateId: ev.candidateId, score: ev.score }],
        stateNodes: s.stateNodes + ev.states,
      };
    case "results":
      return { ...s, ranked: ev.ranked, positionEval: ev.positionEval };
    case "review":
      return { ...s, review: ev.rows, finalEval: ev.finalEval, phase: "done", status: "" };
    case "done":
      return { ...s, phase: "done", status: "" };
    case "error":
      return { ...s, phase: "error", status: "", error: ev.text };
    default:
      return s;
  }
}
