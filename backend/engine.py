"""Social Stockfish engine — streaming Monte Carlo search + position evaluation.

Two modes, both backed by a fast OpenAI-compatible model (Groq):

  ANALYZE (what should I say next):
    1. Candidate generation streams JSONL — line 1 carries the persona and a
       calibrated *position eval* (how likely the goal is from the current state),
       then one candidate "opening move" per line, appearing live.
    2. Each candidate's Monte Carlo rollouts fire as it streams in; the mean
       rollout score is its expected value (EV).
    3. Each move is classified like a chess move (Brilliant/Great/Good/Inaccuracy/
       Mistake/Blunder) by how much its EV swings the position eval.

  REVIEW (analyze a pasted game, move by move):
    One call returns the eval after every message — the eval curve — and each of
    YOUR messages is classified by the swing it caused. Like a chess.com game
    review for a conversation.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any, Awaitable, Callable

from llm import LLMClient

EventSink = Callable[[dict[str, Any]], Awaitable[None]]

ROLLOUT_DEPTH = 5  # moves looked ahead per rollout; also sizes the state grid

# Em dashes / en dashes are an AI tell — strip them from generated replies.
_DASH_RE = re.compile(r"\s*[—–]\s*|\s--\s")


def clean_reply(text: str) -> str:
    text = _DASH_RE.sub(", ", text)
    text = re.sub(r",\s*,", ", ", text)
    return re.sub(r"\s{2,}", " ", text).strip()


# --- chess.com-style move classification --------------------------------------
# swing = how much a move changes P(goal), in probability points. Tuned so a move
# that craters a position reads as a blunder and a strong save reads as brilliant.
def _c(kind: str, label: str, symbol: str, color: str) -> dict[str, str]:
    return {"kind": kind, "label": label, "symbol": symbol, "color": color}


def classify(swing: float) -> dict[str, str]:
    if swing >= 0.15:
        return _c("brilliant", "Brilliant", "!!", "#1bada6")
    if swing >= 0.08:
        return _c("great", "Great", "!", "#5b8baf")
    if swing >= 0.03:
        return _c("best", "Best", "*", "#7cae3e")
    if swing >= -0.015:
        return _c("excellent", "Excellent", "", "#7cae3e")
    if swing >= -0.05:
        return _c("good", "Good", "", "#95b776")
    if swing >= -0.10:
        return _c("inaccuracy", "Inaccuracy", "?!", "#e6b32a")
    if swing >= -0.18:
        return _c("mistake", "Mistake", "?", "#e0892a")
    return _c("blunder", "Blunder", "??", "#e0392a")


def _format_transcript(messages: list[dict[str, str]]) -> str:
    lines = []
    for m in messages:
        who = "ME" if m["sender"] == "me" else "THEM"
        lines.append(f"{who}: {m['text']}")
    return "\n".join(lines) if lines else "(no messages yet)"


def _clamp01(x: Any) -> float:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return 0.0


CANDIDATE_SYS = (
    "You are Social Stockfish, an elite, brutally honest conversation engine — like "
    "the chess engine Stockfish, but for human conversation. You read a text thread "
    "and a goal, evaluate the position honestly (if the other person is hostile, "
    "bored, or rejecting you, say so and score it low), then compute the strongest "
    "next messages.\n"
    "Output JSONL: ONE compact JSON object per line, nothing else."
)


def _candidate_prompt(transcript: str, goal: str, n: int) -> str:
    return (
        f"GOAL: {goal}\n\n"
        f"CONVERSATION (most recent last):\n{transcript}\n\n"
        "You are 'ME'. First, on line 1, output a persona read of THEM and a "
        "CALIBRATED position eval: the probability (0.00-1.00) that ME achieves the "
        "GOAL from the CURRENT state. Be honest and use the full range — rejection, "
        "hostility, 'not interested', 'stop' should be near 0; clear mutual interest "
        "near 1.\n"
        f"Then output the {n} strongest candidate next messages ME could send, "
        "genuinely different in strategy. Each must sound like a real casual text — "
        "natural, lowercase-ish, no emoji spam, no em dashes, 1-2 short sentences.\n\n"
        "Output exactly these lines, one JSON object per line, in order:\n"
        '{"persona": "<2-3 sentence read on THEM>", "position_eval": <0-1>, "position_note": "<short honest read of where things stand>"}\n'
        '{"text": "<candidate message>", "strategy": "<2-4 word label>"}\n'
        f"...({n} candidate lines total). No other text."
    )


ROLLOUT_SYS = (
    "You are the search core of Social Stockfish. You estimate, by self-play, the "
    "probability that an opening move leads to the GOAL — playing THEM realistically "
    "(warm, lukewarm, or cold depending on their actual mood) several moves ahead. "
    "Be CALIBRATED and decisive: if the current state is hostile or rejecting, most "
    "rollouts should score low. Output ONLY the scores, one decimal (0.0-1.0) per "
    "line, nothing else."
)


def _rollout_prompt(transcript: str, goal: str, persona: str, move: str, k: int) -> str:
    return (
        f"GOAL: {goal}\n\n"
        f"THEM (persona): {persona}\n\n"
        f"CONVERSATION SO FAR (most recent last):\n{transcript}\n\n"
        f'MY OPENING MOVE: "{move}"\n\n'
        f"Run {k} independent Monte Carlo rollouts of this move, each playing the "
        f"conversation ~{ROLLOUT_DEPTH} moves ahead with realistic uncertainty, then "
        "score each from 0.0 (goal lost / they disengage) to 1.0 (goal achieved). "
        "Anchor to their CURRENT mood — from a hostile state, most scores are low.\n"
        f"Output exactly {k} lines, each a single decimal between 0 and 1. No other text."
    )


REVIEW_SYS = (
    "You are Social Stockfish's game-review engine — like a chess.com game review, "
    "but for a conversation. You evaluate the position after every single message: "
    "the probability that the player pursuing the GOAL achieves it, given everything "
    "up to and including that message. You are brutally calibrated: rejection, "
    "hostility, boredom, 'not interested', 'stop', 'die' crater the eval toward 0; "
    "warmth, curiosity, and reciprocation raise it. Output ONLY JSON."
)


def _review_prompt(numbered: str, goal: str) -> str:
    return (
        f"GOAL (for YOU): {goal}\n\n"
        f"CONVERSATION (numbered, YOU vs THEM):\n{numbered}\n\n"
        "Review this like a chess.com game review. For EACH numbered message output "
        "the probability (0.00-1.00) that YOU achieve the GOAL given everything UP TO "
        "AND INCLUDING that message. Be calibrated and decisive across the full range "
        "(rejection/hostility crater it; warmth/reciprocation raise it).\n"
        "For each of YOUR messages, also add a short coach 'note' (one sentence, "
        "second-person) explaining how that move turned out GIVEN WHAT HAPPENED NEXT "
        "(their reaction and the eval change) — if it triggered a bad reaction, say "
        "so plainly — and 'better' (a stronger message you could have sent instead, "
        'or "" if it was already strong). No em dashes.\n'
        "Output ONLY a JSON array, one object per message in order:\n"
        '{"i": <index>, "eval": <0-1>}                              for THEM messages\n'
        '{"i": <index>, "eval": <0-1>, "note": "...", "better": "..."}  for YOUR messages\n'
        "No other text."
    )


class Engine:
    def __init__(self, client: LLMClient) -> None:
        self.client = client
        self.n_candidates = int(os.environ.get("CANDIDATES", "6"))
        self.rollouts = int(os.environ.get("ROLLOUTS_PER_CANDIDATE", "16"))
        self.candidate_model = os.environ.get("CANDIDATE_MODEL", "qwen/qwen3-32b")
        self.candidate_reasoning = os.environ.get("CANDIDATE_REASONING") or None
        self.rollout_model = os.environ.get("ROLLOUT_MODEL", "qwen/qwen3-32b")
        self.rollout_reasoning = os.environ.get("ROLLOUT_REASONING") or None

    # ---- ANALYZE: best next move ---------------------------------------------
    async def analyze(
        self, messages: list[dict[str, str]], goal: str, emit: EventSink
    ) -> None:
        transcript = _format_transcript(messages)
        persona = ""
        position_eval = 0.0
        persona_event = asyncio.Event()
        candidates: list[dict] = []
        scores: dict[int, list[float]] = {}
        rollout_tasks: list[asyncio.Task] = []

        async def emit_ranking(final: bool) -> None:
            ranked = []
            for c in candidates:
                ss = scores.get(c["id"], [])
                ev = sum(ss) / len(ss) if ss else 0.0
                ranked.append(
                    {
                        "id": c["id"],
                        "text": c["text"],
                        "strategy": c.get("strategy", ""),
                        "score": round(ev, 2),
                        "swing": round(ev - position_eval, 2),
                        "classification": classify(ev - position_eval),
                        "samples": len(ss),
                    }
                )
            ranked.sort(key=lambda r: r["score"], reverse=True)
            await emit({"type": "results", "ranked": ranked, "final": final,
                        "positionEval": round(position_eval, 2)})

        async def run_rollout(cand: dict) -> None:
            await persona_event.wait()
            cid = cand["id"]
            buf = ""
            got = 0
            async for phase, chunk in self.client.chat_stream(
                [
                    {"role": "system", "content": ROLLOUT_SYS},
                    {"role": "user", "content": _rollout_prompt(
                        transcript, goal, persona, cand["text"], self.rollouts)},
                ],
                model=self.rollout_model,
                reasoning=self.rollout_reasoning,
                temperature=0.8,
                max_tokens=700,
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
                    await emit({"type": "rollout", "candidateId": cid, "score": val,
                                "states": ROLLOUT_DEPTH})
            val = _parse_score(buf)
            if val is not None and got < self.rollouts:
                scores[cid].append(val)
                await emit({"type": "rollout", "candidateId": cid, "score": val,
                            "states": ROLLOUT_DEPTH})
            await emit_ranking(final=False)

        await emit({"type": "status", "text": "Evaluating the position..."})
        answer_buf = ""

        async def handle_line(raw: str) -> None:
            nonlocal persona, position_eval
            obj = _parse_jsonl(raw)
            if obj is None:
                return
            if "persona" in obj and not persona_event.is_set():
                p = obj["persona"]
                persona = (p if isinstance(p, str) else json.dumps(p)).strip()
                position_eval = _clamp01(obj.get("position_eval", 0.0))
                persona_event.set()
                await emit({"type": "position", "positionEval": round(position_eval, 2),
                            "note": str(obj.get("position_note", "")).strip(),
                            "persona": persona})
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
            temperature=0.85,
            max_tokens=1500,
        ):
            if phase == "think":
                continue
            answer_buf += chunk
            while "\n" in answer_buf:
                line, answer_buf = answer_buf.split("\n", 1)
                await handle_line(line)
        await handle_line(answer_buf)

        if not persona_event.is_set():
            persona_event.set()
        await emit({"type": "status", "text": "Running Monte Carlo simulations..."})
        if rollout_tasks:
            await asyncio.gather(*rollout_tasks)
        await emit_ranking(final=True)
        await emit({"type": "done"})

    # ---- SIMULATE: one detailed rollout trajectory (lazy, on dot click) ------
    async def simulate(
        self, messages: list[dict[str, str]], goal: str, move: str
    ) -> dict:
        transcript = _format_transcript(messages)
        prompt = (
            f"GOAL: {goal}\n\n"
            f"CONVERSATION SO FAR (most recent last):\n{transcript}\n\n"
            f'MY NEXT MESSAGE: "{move}"\n\n'
            "Simulate ONE realistic way this plays out over the next few exchanges "
            "(THEM replies, ME follows up, THEM replies, ME, THEM), sampling a "
            "plausible outcome. Then score 0.0-1.0 how much closer ME got to the GOAL.\n"
            "Output ONLY JSON:\n"
            '{"trajectory": [{"sender": "me", "text": "<my message>"}, '
            '{"sender": "them", "text": "..."}, ...], "score": <0-1>}\n'
            "Start the trajectory with MY NEXT MESSAGE as the first item. No em dashes."
        )
        data = await self.client.chat_json(
            [
                {"role": "system", "content": ROLLOUT_SYS},
                {"role": "user", "content": prompt},
            ],
            model=self.candidate_model,
            reasoning=self.candidate_reasoning,
            temperature=0.95,
            max_tokens=900,
        )
        traj = data.get("trajectory") if isinstance(data, dict) else None
        out = []
        for t in traj or []:
            sender = "me" if str(t.get("sender", "")).lower().startswith("m") else "them"
            text = clean_reply(str(t.get("text", "")).strip())
            if text:
                out.append({"sender": sender, "text": text})
        return {"trajectory": out, "score": _clamp01(data.get("score", 0.0)) if isinstance(data, dict) else 0.0}

    # ---- REVIEW: move-by-move game review ------------------------------------
    async def review(
        self, messages: list[dict[str, str]], goal: str, emit: EventSink
    ) -> dict:
        if not messages:
            await emit({"type": "error", "text": "Nothing to review."})
            return {}
        numbered = "\n".join(
            f"{i}. {'YOU' if m['sender'] == 'me' else 'THEM'}: {m['text']}"
            for i, m in enumerate(messages)
        )
        await emit({"type": "status", "text": "Reviewing the game..."})
        data = await self.client.chat_json(
            [
                {"role": "system", "content": REVIEW_SYS},
                {"role": "user", "content": _review_prompt(numbered, goal)},
            ],
            model=self.candidate_model,
            reasoning=self.candidate_reasoning,
            temperature=0.3,
            max_tokens=1500,
        )
        rows = data if isinstance(data, list) else data.get("results") or data.get("evals") or []
        evals: dict[int, float] = {}
        notes: dict[int, dict] = {}
        for r in rows:
            try:
                idx = int(r["i"])
            except (KeyError, TypeError, ValueError):
                continue
            evals[idx] = _clamp01(r.get("eval"))
            notes[idx] = {
                "note": str(r.get("note", "")).strip(),
                "better": clean_reply(str(r.get("better", "")).strip()) if r.get("better") else "",
            }

        # Fill any missing evals by carrying forward, so indexing is safe.
        curve: list[float] = []
        last = evals.get(0, 0.3)
        for i in range(len(messages)):
            last = evals.get(i, last)
            curve.append(last)

        reviewed = []
        for i, m in enumerate(messages):
            row = {"i": i, "sender": m["sender"], "text": m["text"], "eval": round(curve[i], 2)}
            if m["sender"] == "me":
                # Bracket the move by the opponent's reaction: compare the eval just
                # before my next move (after THEM responds) to the eval before mine.
                before = curve[i - 1] if i > 0 else curve[i]
                nxt = next((j for j in range(i + 1, len(messages))
                            if messages[j]["sender"] == "me"), len(messages))
                after = curve[nxt - 1]
                swing = after - before
                row["swing"] = round(swing, 2)
                row["classification"] = classify(swing)
                row["note"] = notes.get(i, {}).get("note", "")
                row["better"] = notes.get(i, {}).get("better", "")
            reviewed.append(row)

        result = {
            "type": "review",
            "rows": reviewed,
            "finalEval": round(curve[-1], 2),
            "goal": goal,
        }
        await emit(result)
        return result


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
    line = line.lstrip("[").rstrip("]").rstrip(",").strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None
