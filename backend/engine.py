"""Social Stockfish engine — streaming, pipelined Monte Carlo search.

Given a chat history and a social goal, the engine looks several moves ahead:
  1. Candidate generation streams JSONL (persona line, then one candidate
     "opening move" per line) so candidates appear live as the model writes them.
  2. The moment a candidate streams in, its Monte Carlo rollouts are dispatched
     (pipelined) — each rollout call streams a list of goal-achievement scores,
     one number per line, so the dot grids fill in real time.
  3. The mean rollout score is the candidate's probability-weighted expected
     value; an interim ranking is emitted as each candidate finishes, and a final
     ranking at the end -> ANALYSIS RESULTS.

Self-play (a "ME" model vs a "THEM" model) and value scoring happen inside the
model's reasoning, so the whole tree collapses into a handful of streaming calls
that stay within MiniMax-M3's rate limits.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Awaitable, Callable

from llm import LLMClient

EventSink = Callable[[dict[str, Any]], Awaitable[None]]

# How many moves ahead each rollout looks; also sizes the state-tree grid.
ROLLOUT_DEPTH = 5

# Em dashes / en dashes are an AI tell — strip them from generated replies.
_DASH_RE = re.compile(r"\s*[—–]\s*|\s--\s")


def clean_reply(text: str) -> str:
    text = _DASH_RE.sub(", ", text)
    text = re.sub(r",\s*,", ", ", text)          # collapse any double commas
    return re.sub(r"\s{2,}", " ", text).strip()


def _format_transcript(messages: list[dict[str, str]]) -> str:
    lines = []
    for m in messages:
        who = "ME" if m["sender"] == "me" else "THEM"
        lines.append(f"{who}: {m['text']}")
    return "\n".join(lines) if lines else "(no messages yet)"


CANDIDATE_SYS = (
    "You are Social Stockfish, an elite conversation strategist — like the chess "
    "engine Stockfish, but for human conversation. You read a text thread and a "
    "goal, then compute the strongest next messages to send. You are blunt, "
    "socially calibrated, and strategic.\n"
    "Output JSONL: ONE compact JSON object per line, nothing else (no markdown, no "
    "array brackets, no commentary)."
)


def _candidate_prompt(transcript: str, goal: str, n: int) -> str:
    return (
        f"GOAL: {goal}\n\n"
        f"CONVERSATION (most recent last):\n{transcript}\n\n"
        f"You are 'ME'. First infer a concise persona model of THEM, then propose "
        f"the {n} strongest candidate next messages ME could send to move toward the "
        "GOAL. Make them genuinely different in strategy (e.g. playful, sincere, "
        "curious, bold, low-key). Each must sound like a real casual text — natural, "
        "lowercase-ish, no emoji spam, 1-2 short sentences.\n\n"
        "Output exactly these lines, one JSON object per line, in order:\n"
        '{"persona": "<2-3 sentence read on THEM: vibe, interests, what they respond to>"}\n'
        '{"text": "<candidate message>", "strategy": "<2-4 word label>"}\n'
        f"...({n} candidate lines total). No other text."
    )


ROLLOUT_SYS = (
    "You are the search core of Social Stockfish — like Stockfish, but for "
    "conversation. You look several moves ahead by self-play: internally you run a "
    "'ME' model and a 'THEM' model that take turns continuing the conversation into "
    "many plausible futures, and a value model scores each finished path on how well "
    "it achieves the GOAL. You sample paths in proportion to how likely each message "
    "is, so the mean score is the opening move's expected value.\n"
    "Be decisive and FAST — do not write long reasoning. Output ONLY the scores, one "
    "decimal number (0.0-1.0) per line, nothing else."
)


def _rollout_prompt(transcript: str, goal: str, persona: str, move: str, k: int) -> str:
    return (
        f"GOAL: {goal}\n\n"
        f"THEM (persona for the opponent model): {persona}\n\n"
        f"CONVERSATION SO FAR (most recent last):\n{transcript}\n\n"
        f'MY OPENING MOVE: "{move}"\n\n'
        f"Run {k} independent Monte Carlo rollouts of this opening move. In each, "
        f"play the conversation forward ~{ROLLOUT_DEPTH} moves ahead via self-play "
        "(ME sends the move, THEM replies in persona, ME follows up, THEM replies, ME "
        "closes), sampling realistic uncertainty so some paths land and some fizzle. "
        "The value model scores each full path from 0.0 (goal lost / they disengage) "
        "to 1.0 (goal strongly achieved).\n\n"
        f"Output exactly {k} lines, each a single decimal number between 0 and 1 "
        "(one rollout's score). Vary them realistically. No other text."
    )


class Engine:
    def __init__(self, client: LLMClient) -> None:
        self.client = client
        self.n_candidates = int(os.environ.get("CANDIDATES", "6"))
        self.rollouts = int(os.environ.get("ROLLOUTS_PER_CANDIDATE", "16"))
        self.candidate_model = os.environ.get("CANDIDATE_MODEL", "qwen/qwen3-32b")
        self.candidate_reasoning = os.environ.get("CANDIDATE_REASONING") or None
        self.rollout_model = os.environ.get("ROLLOUT_MODEL", "llama-3.1-8b-instant")
        self.rollout_reasoning = os.environ.get("ROLLOUT_REASONING") or None

    async def analyze(
        self, messages: list[dict[str, str]], goal: str, emit: EventSink
    ) -> None:
        transcript = _format_transcript(messages)
        persona = ""
        persona_event = asyncio.Event()
        candidates: list[dict] = []
        scores: dict[int, list[float]] = {}
        rollout_tasks: list[asyncio.Task] = []

        async def emit_ranking(final: bool) -> None:
            ranked = []
            for c in candidates:
                ss = scores.get(c["id"], [])
                mean = sum(ss) / len(ss) if ss else 0.0
                ranked.append(
                    {
                        "id": c["id"],
                        "text": c["text"],
                        "strategy": c.get("strategy", ""),
                        "score": round(mean, 2),
                        "samples": len(ss),
                    }
                )
            ranked.sort(key=lambda r: r["score"], reverse=True)
            await emit({"type": "results", "ranked": ranked, "final": final})

        async def run_rollout(cand: dict) -> None:
            await persona_event.wait()
            cid = cand["id"]
            buf = ""
            prompt = _rollout_prompt(transcript, goal, persona, cand["text"], self.rollouts)
            got = 0
            async for phase, chunk in self.client.chat_stream(
                [
                    {"role": "system", "content": ROLLOUT_SYS},
                    {"role": "user", "content": prompt},
                ],
                model=self.rollout_model,
                reasoning=self.rollout_reasoning,
                temperature=1.0,
                max_tokens=900,
            ):
                if phase != "answer":
                    continue
                buf += chunk
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    val = _parse_score(line)
                    if val is None:
                        continue
                    scores[cid].append(val)
                    got += 1
                    await emit(
                        {"type": "rollout", "candidateId": cid, "score": val, "states": ROLLOUT_DEPTH}
                    )
            val = _parse_score(buf)
            if val is not None and got < self.rollouts:
                scores[cid].append(val)
                await emit(
                    {"type": "rollout", "candidateId": cid, "score": val, "states": ROLLOUT_DEPTH}
                )
            await emit_ranking(final=False)

        # ---- Stream candidate generation; pipeline rollouts as they arrive ----
        await emit({"type": "status", "text": "Reading the conversation..."})
        answer_buf = ""

        async def handle_line(raw: str) -> None:
            nonlocal persona
            obj = _parse_jsonl(raw)
            if obj is None:
                return
            if "persona" in obj and not persona_event.is_set():
                p = obj["persona"]
                persona = (p if isinstance(p, str) else json.dumps(p)).strip()
                persona_event.set()
                await emit({"type": "persona", "persona": persona})
                await emit({"type": "status", "text": "Searching the conversation tree..."})
            elif ("text" in obj or "reply" in obj) and len(candidates) < self.n_candidates:
                text = clean_reply(str(obj.get("text") or obj.get("reply")).strip())
                if not text:
                    return
                cid = len(candidates)
                cand = {"id": cid, "text": text, "strategy": str(obj.get("strategy", "")).strip()}
                candidates.append(cand)
                scores[cid] = []
                await emit({"type": "candidate", "item": cand})
                rollout_tasks.append(asyncio.create_task(run_rollout(cand)))

        async for phase, chunk in self.client.chat_stream(
            [
                {"role": "system", "content": CANDIDATE_SYS},
                {"role": "user", "content": _candidate_prompt(transcript, goal, self.n_candidates)},
            ],
            model=self.candidate_model,
            reasoning=self.candidate_reasoning,
            temperature=0.9,
            max_tokens=1500,
        ):
            if phase == "think":
                continue
            answer_buf += chunk
            while "\n" in answer_buf:
                line, answer_buf = answer_buf.split("\n", 1)
                await handle_line(line)
        await handle_line(answer_buf)

        # If the model never emitted a parseable persona, unblock rollouts anyway.
        if not persona_event.is_set():
            persona_event.set()

        await emit({"type": "status", "text": "Running Monte Carlo simulations..."})
        if rollout_tasks:
            await asyncio.gather(*rollout_tasks)
        await emit_ranking(final=True)
        await emit({"type": "done"})


_NUM_RE = re.compile(r"-?\d*\.?\d+")


def _parse_score(line: str) -> float | None:
    m = _NUM_RE.search(line)
    if not m:
        return None
    try:
        return max(0.0, min(1.0, float(m.group(0))))
    except ValueError:
        return None


def _parse_jsonl(line: str) -> dict | None:
    line = line.strip().strip("`").strip()
    # tolerate array-style framing: leading [ , trailing , or ]
    line = line.lstrip("[").rstrip("]").rstrip(",").strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None
