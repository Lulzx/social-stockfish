"""SQLite persistence for every analysis (conversation + goal + result).

Uses the stdlib sqlite3 driver run off the event loop via asyncio.to_thread, so
no extra dependency and no blocking the async server. One row per analyze call.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DDL = """
CREATE TABLE IF NOT EXISTS analyses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL,
    kind            TEXT    DEFAULT 'analyze',  -- 'analyze' | 'review'
    contact         TEXT,
    goal            TEXT    NOT NULL,
    messages        TEXT    NOT NULL,   -- JSON: [{sender, text}]
    persona         TEXT,
    ranked          TEXT,               -- JSON: ranked moves (analyze) or review rows
    best_score      REAL,               -- best move EV (analyze) or final eval (review)
    num_candidates  INTEGER,
    num_rollouts    INTEGER,
    duration_ms     INTEGER,
    candidate_model TEXT,
    rollout_model   TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at);

CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    email      TEXT UNIQUE,
    note       TEXT
);

CREATE TABLE IF NOT EXISTS entitlements (
    device       TEXT PRIMARY KEY,
    pro          INTEGER DEFAULT 0,
    reviews_used INTEGER DEFAULT 0,
    customer     TEXT,
    created_at   TEXT
);
"""


class Store:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.environ.get("SS_DB_PATH", "data/conversations.db")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init(self) -> None:
        with self._connect() as conn:
            conn.executescript(_DDL)
            # migrate older DBs that predate the `kind` column
            cols = {r[1] for r in conn.execute("PRAGMA table_info(analyses)")}
            if "kind" not in cols:
                conn.execute("ALTER TABLE analyses ADD COLUMN kind TEXT DEFAULT 'analyze'")

    def _save_sync(self, rec: dict[str, Any]) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO analyses
                   (created_at, kind, contact, goal, messages, persona, ranked, best_score,
                    num_candidates, num_rollouts, duration_ms, candidate_model, rollout_model)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    datetime.now(timezone.utc).isoformat(),
                    rec.get("kind", "analyze"),
                    rec.get("contact"),
                    rec.get("goal"),
                    json.dumps(rec.get("messages", []), ensure_ascii=False),
                    rec.get("persona"),
                    json.dumps(rec.get("ranked"), ensure_ascii=False) if rec.get("ranked") is not None else None,
                    rec.get("best_score"),
                    rec.get("num_candidates"),
                    rec.get("num_rollouts"),
                    rec.get("duration_ms"),
                    rec.get("candidate_model"),
                    rec.get("rollout_model"),
                ),
            )
            return int(cur.lastrowid)

    async def save(self, rec: dict[str, Any]) -> int:
        return await asyncio.to_thread(self._save_sync, rec)

    def _recent_sync(self, limit: int) -> list[dict[str, Any]]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM analyses ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["messages"] = json.loads(d["messages"]) if d["messages"] else []
            d["ranked"] = json.loads(d["ranked"]) if d["ranked"] else None
            out.append(d)
        return out

    async def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._recent_sync, max(1, min(limit, 200)))

    def _get_sync(self, row_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            r = conn.execute("SELECT * FROM analyses WHERE id = ?", (row_id,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["messages"] = json.loads(d["messages"]) if d["messages"] else []
        d["ranked"] = json.loads(d["ranked"]) if d["ranked"] else None
        return d

    async def get(self, row_id: int) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_sync, row_id)

    # ---- waitlist ----
    def _add_waitlist_sync(self, email: str, note: str | None) -> bool:
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO waitlist (created_at, email, note) VALUES (?,?,?)",
                    (datetime.now(timezone.utc).isoformat(), email.lower(), note),
                )
                return True
            except sqlite3.IntegrityError:
                return False  # already on the list

    async def add_waitlist(self, email: str, note: str | None = None) -> bool:
        return await asyncio.to_thread(self._add_waitlist_sync, email, note)

    # ---- entitlements (per anonymous device id) ----
    def _entitlement_sync(self, device: str) -> dict[str, Any]:
        with self._connect() as conn:
            conn.row_factory = sqlite3.Row
            r = conn.execute("SELECT * FROM entitlements WHERE device = ?", (device,)).fetchone()
            if not r:
                conn.execute(
                    "INSERT INTO entitlements (device, created_at) VALUES (?,?)",
                    (device, datetime.now(timezone.utc).isoformat()),
                )
                return {"device": device, "pro": False, "reviews_used": 0}
            return {"device": device, "pro": bool(r["pro"]), "reviews_used": r["reviews_used"]}

    async def entitlement(self, device: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._entitlement_sync, device)

    def _bump_review_sync(self, device: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE entitlements SET reviews_used = reviews_used + 1 WHERE device = ?",
                (device,),
            )

    async def bump_review(self, device: str) -> None:
        await asyncio.to_thread(self._bump_review_sync, device)

    def _set_pro_sync(self, device: str, customer: str | None) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO entitlements (device, pro, customer, created_at) VALUES (?,1,?,?) "
                "ON CONFLICT(device) DO UPDATE SET pro = 1, customer = excluded.customer",
                (device, customer, datetime.now(timezone.utc).isoformat()),
            )

    async def set_pro(self, device: str, customer: str | None = None) -> None:
        await asyncio.to_thread(self._set_pro_sync, device, customer)

    def _count_sync(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0])

    async def count(self) -> int:
        return await asyncio.to_thread(self._count_sync)
