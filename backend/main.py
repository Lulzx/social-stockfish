"""Social Stockfish backend — FastAPI + WebSocket streaming engine."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import httpx  # noqa: E402
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import Response  # noqa: E402
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


@app.post("/simulate")
async def simulate(req: Request) -> dict:
    """Lazily simulate one detailed rollout for a clicked exploration/MC dot."""
    body = await req.json()
    move = (body.get("move") or "").strip()
    goal = (body.get("goal") or "").strip()
    if not move or not goal:
        raise HTTPException(status_code=400, detail="move and goal required")
    engine: Engine = app.state.engine
    score = body.get("score")
    return await engine.simulate(
        body.get("messages", []), goal, move,
        score=float(score) if score is not None else None,
    )


@app.get("/review/{review_id}")
async def get_review(review_id: int) -> dict:
    """Fetch a stored game review so it can be shared via a link."""
    store: Store = app.state.store
    row = await store.get(review_id)
    if not row or row.get("kind") != "review":
        raise HTTPException(status_code=404, detail="Review not found")
    return {
        "id": row["id"],
        "goal": row["goal"],
        "contact": row["contact"],
        "messages": row["messages"],
        "rows": row["ranked"],
        "finalEval": row["best_score"],
    }


# --- Coach voice: proxy to the Supertonic TTS server -------------------------
SUPERTONIC_URL = os.environ.get("SUPERTONIC_URL", "http://127.0.0.1:7788")
TTS_VOICE = os.environ.get("TTS_VOICE", "M2")  # "James" — built-in male voice


# --- Monetization: free-tier limits + Pro entitlement (per device) ----------
FREE_REVIEWS = int(os.environ.get("FREE_REVIEWS", "2"))
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
APP_URL = os.environ.get("APP_URL", "https://chat.lulzx.space")


@app.get("/entitlement")
async def entitlement(device: str = "") -> dict:
    store: Store = app.state.store
    ent = await store.entitlement(device) if device else {"pro": False, "reviews_used": 0}
    return {
        "pro": ent["pro"],
        "reviewsUsed": ent["reviews_used"],
        "freeReviews": FREE_REVIEWS,
        "billingEnabled": bool(STRIPE_SECRET_KEY and STRIPE_PRICE_ID),
    }


@app.post("/checkout")
async def checkout(req: Request) -> dict:
    """Create a Stripe Checkout session for Pro. Activates when STRIPE_* are set."""
    if not (STRIPE_SECRET_KEY and STRIPE_PRICE_ID):
        raise HTTPException(status_code=501, detail="Billing not configured yet")
    body = await req.json()
    device = (body.get("device") or "").strip()
    if not device:
        raise HTTPException(status_code=400, detail="device required")
    data = {
        "mode": "subscription",
        "line_items[0][price]": STRIPE_PRICE_ID,
        "line_items[0][quantity]": "1",
        "client_reference_id": device,
        "success_url": f"{APP_URL}/?pro=1",
        "cancel_url": f"{APP_URL}/?upgrade=cancel",
    }
    async with httpx.AsyncClient(timeout=20.0) as c:
        r = await c.post(
            "https://api.stripe.com/v1/checkout/sessions",
            data=data, auth=(STRIPE_SECRET_KEY, ""),
        )
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail="Stripe error")
    return {"url": r.json().get("url")}


@app.post("/stripe/webhook")
async def stripe_webhook(req: Request) -> dict:
    payload = await req.body()
    if STRIPE_WEBHOOK_SECRET:
        sig = req.headers.get("stripe-signature", "")
        parts = dict(p.split("=", 1) for p in sig.split(",") if "=" in p)
        signed = f"{parts.get('t','')}.{payload.decode()}".encode()
        expected = hmac.new(STRIPE_WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, parts.get("v1", "")):
            raise HTTPException(status_code=400, detail="bad signature")
    event = json.loads(payload)
    if event.get("type") == "checkout.session.completed":
        obj = event["data"]["object"]
        device = obj.get("client_reference_id")
        if device:
            await app.state.store.set_pro(device, obj.get("customer"))
    return {"ok": True}


@app.post("/waitlist")
async def waitlist(req: Request) -> dict:
    body = await req.json()
    email = (body.get("email") or "").strip()
    if "@" not in email or len(email) > 200:
        raise HTTPException(status_code=400, detail="valid email required")
    added = await app.state.store.add_waitlist(email, body.get("note"))
    return {"ok": True, "added": added}


@app.post("/share")
async def share(req: Request) -> dict:
    """Explicitly persist a review so it can be shared (sharing = consent to store)."""
    body = await req.json()
    store: Store = app.state.store
    rid = await store.save({
        "kind": "review", "contact": body.get("contact"), "goal": body.get("goal") or "",
        "messages": body.get("messages", []), "persona": None,
        "ranked": body.get("rows"), "best_score": body.get("finalEval"),
        "num_candidates": 0, "num_rollouts": 0, "duration_ms": 0,
        "candidate_model": None, "rollout_model": None,
    })
    return {"id": rid}


@app.post("/tts")
async def tts(req: Request) -> Response:
    body = await req.json()
    # Coach voice is a Pro perk.
    device = (body.get("device") or "").strip()
    ent = await app.state.store.entitlement(device) if device else {"pro": False}
    if not ent["pro"]:
        return Response(status_code=402)
    text = (body.get("text") or "").strip()[:600]
    if not text:
        return Response(status_code=400)
    try:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.post(
                f"{SUPERTONIC_URL}/v1/audio/speech",
                json={"model": "supertonic-3", "input": text,
                      "voice": body.get("voice") or TTS_VOICE, "speed": 1.05},
            )
        r.raise_for_status()
    except Exception:
        return Response(status_code=503)  # TTS unavailable — UI falls back silently
    return Response(content=r.content, media_type=r.headers.get("content-type", "audio/wav"))


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    engine: Engine = websocket.app.state.engine
    store: Store = websocket.app.state.store

    try:
        while True:
            req = await websocket.receive_json()
            kind = req.get("type")
            if kind not in ("analyze", "review"):
                continue
            messages = req.get("messages", [])
            goal = (req.get("goal") or "").strip()
            contact = (req.get("contact") or "").strip() or None
            if not goal:
                await websocket.send_json(
                    {"type": "error", "text": "A conversation goal is required."}
                )
                continue

            device = (req.get("device") or "").strip()
            opt_in_store = bool(req.get("store"))

            if kind == "review":
                # Game Review is the premium hook: free up to FREE_REVIEWS per device.
                ent = await store.entitlement(device) if device else {"pro": False, "reviews_used": 0}
                if not ent["pro"] and ent["reviews_used"] >= FREE_REVIEWS:
                    await websocket.send_json({
                        "type": "paywall", "feature": "review",
                        "reviewsUsed": ent["reviews_used"], "freeReviews": FREE_REVIEWS,
                    })
                    continue
                t0 = time.monotonic()
                try:
                    result = await engine.review(messages, goal, websocket.send_json)
                except Exception as e:
                    await websocket.send_json({"type": "error", "text": f"Engine error: {e}"})
                    continue
                if device and not ent["pro"]:
                    await store.bump_review(device)
                if opt_in_store:  # privacy: persist only when the user opts in
                    try:
                        rid = await store.save({
                            "kind": "review", "contact": contact, "goal": goal,
                            "messages": messages, "persona": None,
                            "ranked": result.get("rows"), "best_score": result.get("finalEval"),
                            "num_candidates": 0, "num_rollouts": 0,
                            "duration_ms": int((time.monotonic() - t0) * 1000),
                            "candidate_model": engine.candidate_model,
                            "rollout_model": engine.rollout_model,
                        })
                        await websocket.send_json({"type": "reviewSaved", "id": rid})
                    except Exception:
                        pass
                await websocket.send_json({"type": "done"})
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
            if opt_in_store:  # privacy: persist only when the user opts in
                try:
                    await store.save({
                        "contact": contact, "goal": goal, "messages": messages,
                        "persona": cap["persona"], "ranked": ranked,
                        "best_score": ranked[0]["score"] if ranked else None,
                        "num_candidates": cap["candidates"], "num_rollouts": cap["rollouts"],
                        "duration_ms": int((time.monotonic() - t0) * 1000),
                        "candidate_model": engine.candidate_model,
                        "rollout_model": engine.rollout_model,
                    })
                except Exception:  # never let persistence break the live session
                    pass
    except WebSocketDisconnect:
        return


# Serve the built SPA (frontend/dist copied here as ./static) at the root, if present.
# Mounted last so /health and /ws take precedence.
_static = Path(__file__).parent / "static"
if _static.is_dir():
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="spa")
