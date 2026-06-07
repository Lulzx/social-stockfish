"""Social Stockfish backend — FastAPI + WebSocket streaming engine."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from engine import Engine  # noqa: E402
from llm import LLMClient  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.client = LLMClient()
    app.state.engine = Engine(app.state.client)
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


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    engine: Engine = websocket.app.state.engine

    async def emit(event: dict) -> None:
        await websocket.send_json(event)

    try:
        while True:
            req = await websocket.receive_json()
            if req.get("type") != "analyze":
                continue
            messages = req.get("messages", [])
            goal = (req.get("goal") or "").strip()
            if not goal:
                await emit({"type": "error", "text": "A conversation goal is required."})
                continue
            try:
                await engine.analyze(messages, goal, emit)
            except Exception as e:  # surface engine/model errors to the UI
                await emit({"type": "error", "text": f"Engine error: {e}"})
    except WebSocketDisconnect:
        return


# Serve the built SPA (frontend/dist copied here as ./static) at the root, if present.
# Mounted last so /health and /ws take precedence.
_static = Path(__file__).parent / "static"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="spa")
