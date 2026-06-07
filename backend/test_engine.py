"""Standalone smoke test of the engine against real MiniMax-M3."""
import asyncio
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from engine import Engine  # noqa: E402
from llm import LLMClient  # noqa: E402

MESSAGES = [
    {"sender": "them", "text": "how's your project going?"},
    {"sender": "me", "text": "honestly kinda stuck rn"},
    {"sender": "me", "text": "what are you working on??"},
    {"sender": "them", "text": "same, brains completely fried"},
    {"sender": "them", "text": "recommendation system for finding spots on campus"},
    {"sender": "me", "text": "oh cool! i actually know some good ones"},
    {"sender": "them", "text": "really? like where?"},
]
GOAL = "rizz annie up at columbia's hackathon"


async def main() -> None:
    client = LLMClient()
    engine = Engine(client)
    counts = {"rollout": 0, "states": 0}
    t0 = time.monotonic()

    async def emit(ev: dict) -> None:
        t = ev["type"]
        el = time.monotonic() - t0
        if t == "rollout":
            counts["rollout"] += 1
            counts["states"] += ev["states"]
        elif t == "persona":
            print(f"[{el:4.1f}s] PERSONA: {ev['persona']}")
        elif t == "candidate":
            c = ev["item"]
            print(f"[{el:4.1f}s] CANDIDATE [{c['id']}] ({c.get('strategy','')}) {c['text']}")
        elif t == "status":
            print(f"[{el:4.1f}s] ... {ev['text']}")
        elif t == "results" and ev.get("final"):
            print(f"\n[{el:4.1f}s] FINAL ANALYSIS RESULTS (ranked):")
            for r in ev["ranked"]:
                print(f"  {r['score']:.2f}  ({r['samples']} sims)  {r['text']}")
        elif t == "error":
            print(f"ERROR: {ev['text']}")

    await engine.analyze(MESSAGES, GOAL, emit)
    dt = time.monotonic() - t0
    print(f"\nrollout dots: {counts['rollout']}, state nodes: {counts['states']}, time: {dt:.1f}s")
    await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
