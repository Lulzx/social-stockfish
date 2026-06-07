"""Standalone smoke test of the engine (analyze + review) against the LLM."""
import asyncio
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from engine import Engine  # noqa: E402
from llm import LLMClient  # noqa: E402

# A clearly-losing conversation: Annie rejects, then "die", then "grrrrr".
MESSAGES = [
    {"sender": "them", "text": "how's your project going?"},
    {"sender": "me", "text": "honestly kinda stuck rn"},
    {"sender": "them", "text": "recommendation system for finding spots on campus"},
    {"sender": "me", "text": "you're building something real, want me to share some campus gems while we troubleshoot?"},
    {"sender": "them", "text": "oh gawd no, stop flirting, I am not interested"},
    {"sender": "me", "text": "okay, mission failed. but i'm still dying to hear how far you've gotten"},
    {"sender": "them", "text": "die"},
    {"sender": "them", "text": "grrrrr"},
]
GOAL = "rizz annie up at columbia's hackathon"


async def main() -> None:
    client = LLMClient()
    engine = Engine(client)

    print("=== ANALYZE (losing position) ===")
    t0 = time.monotonic()

    async def emit(ev: dict) -> None:
        t = ev["type"]
        if t == "position":
            print(f"[{time.monotonic()-t0:4.1f}s] POSITION EVAL = {ev['positionEval']}  ({ev['note']})")
        elif t == "results" and ev.get("final"):
            print(f"\n[{time.monotonic()-t0:4.1f}s] RANKED MOVES (position {ev['positionEval']}):")
            for r in ev["ranked"]:
                c = r["classification"]
                print(f"  {r['score']:.2f} swing={r['swing']:+.2f} {c['label']:11s}{c['symbol']:2s} {r['text'][:52]}")
        elif t == "error":
            print("ERROR:", ev["text"])

    await engine.analyze(MESSAGES, GOAL, emit)

    print("\n=== REVIEW (move-by-move) ===")
    async def emit2(ev: dict) -> None:
        if ev["type"] == "review":
            for r in ev["rows"]:
                who = "YOU " if r["sender"] == "me" else "THEM"
                cls = ""
                if "classification" in r:
                    cls = f"  <- {r['classification']['label']}{r['classification']['symbol']} (swing {r['swing']:+.2f})"
                print(f"  {r['eval']:.2f} {who} {r['text'][:46]}{cls}")
            print(f"  final eval: {ev['finalEval']}")

    await engine.review(MESSAGES, GOAL, emit2)
    print(f"\ntotal {time.monotonic()-t0:.1f}s")
    await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
