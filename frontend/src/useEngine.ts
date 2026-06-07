import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Candidate,
  EnginePhase,
  Message,
  RankedResult,
  RolloutDot,
  ServerEvent,
} from "./types";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export interface EngineState {
  connected: boolean;
  phase: EnginePhase;
  status: string;
  persona: string;
  candidates: Candidate[];
  ranked: RankedResult[];
  // full result buffers (targets); the UI reveals these progressively
  rollouts: RolloutDot[];
  stateNodes: number;
  error: string | null;
}

const initial: EngineState = {
  connected: false,
  phase: "idle",
  status: "",
  persona: "",
  candidates: [],
  ranked: [],
  rollouts: [],
  stateNodes: 0,
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

  const analyze = useCallback((messages: Message[], goal: string, contact?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !goal.trim()) return;
    setState((s) => ({
      ...s,
      phase: "candidates",
      status: "Generating candidate responses...",
      persona: "",
      candidates: [],
      ranked: [],
      rollouts: [],
      stateNodes: 0,
      error: null,
    }));
    ws.send(
      JSON.stringify({
        type: "analyze",
        goal,
        contact,
        messages: messages.map((m) => ({ sender: m.sender, text: m.text })),
      })
    );
  }, []);

  return { state, analyze };
}

function reduce(s: EngineState, ev: ServerEvent): EngineState {
  switch (ev.type) {
    case "status":
      return {
        ...s,
        status: ev.text,
        phase: ev.text.toLowerCase().includes("monte") ? "simulating" : s.phase,
      };
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
      return { ...s, ranked: ev.ranked };
    case "done":
      return { ...s, phase: "done", status: "" };
    case "error":
      return { ...s, phase: "error", status: "", error: ev.text };
    default:
      return s;
  }
}
