"""Social Stockfish backend — FastAPI + WebSocket streaming engine."""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from engine import Engine  # noqa: E402
from llm import LLMClient  # noqa: E402
from store import Store  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = LLMClient()
    app.state.engine = Engine(app.state.client)
    app.state.store = Store()
    yield
    await app.state.client.aclose()


app = FastAPI(title="Social Stockfish", version="0.1", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "candidate_model": os.environ.get("CANDIDATE_MODEL", "qwen/qwen3-32b"),
        "rollout_model": os.environ.get("ROLLOUT_MODEL", "llama-3.1-8b-instant"),
    }


@app.get("/history")
async def history(limit: int = 20) -> dict:
    store: Store = app.state.store
    return {"count": await store.count(), "items": await store.recent(limit)}


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    engine: Engine = websocket.app.state.engine
    store: Store = websocket.app.state.store

    try:
        while True:
            req = await websocket.receive_json()
            if req.get("type") != "analyze":
                continue
            messages = req.get("messages", [])
            goal = (req.get("goal") or "").strip()
            contact = (req.get("contact") or "").strip() or None
            if not goal:
                await websocket.send_json(
                    {"type": "error", "text": "A conversation goal is required."}
                )
                continue

            # Capture the outcome as events stream past, to persist after the run.
            cap = {"persona": None, "candidates": 0, "rollouts": 0, "ranked": None}

            async def emit(event: dict) -> None:
                t = event.get("type")
                if t == "persona":
                    cap["persona"] = event.get("persona")
                elif t == "candidate":
                    cap["candidates"] += 1
                elif t == "rollout":
                    cap["rollouts"] += 1
                elif t == "results" and event.get("final"):
                    cap["ranked"] = event.get("ranked")
                await websocket.send_json(event)

            t0 = time.monotonic()
            try:
                await engine.analyze(messages, goal, emit)
            except Exception as e:  # surface engine/model errors to the UI
                await websocket.send_json({"type": "error", "text": f"Engine error: {e}"})
                continue

            ranked = cap["ranked"]
            try:
                await store.save(
                    {
                        "contact": contact,
                        "goal": goal,
                        "messages": messages,
                        "persona": cap["persona"],
                        "ranked": ranked,
                        "best_score": ranked[0]["score"] if ranked else None,
                        "num_candidates": cap["candidates"],
                        "num_rollouts": cap["rollouts"],
                        "duration_ms": int((time.monotonic() - t0) * 1000),
                        "candidate_model": engine.candidate_model,
                        "rollout_model": engine.rollout_model,
                    }
                )
            except Exception:  # never let persistence break the live session
                pass
    except WebSocketDisconnect:
        return


# Serve the built SPA (frontend/dist copied here as ./static) at the root, if present.
# Mounted last so /health and /ws take precedence.
_static = Path(__file__).parent / "static"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="spa")
