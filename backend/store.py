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
    contact         TEXT,
    goal            TEXT    NOT NULL,
    messages        TEXT    NOT NULL,   -- JSON: [{sender, text}]
    persona         TEXT,
    ranked          TEXT,               -- JSON: [{id, text, strategy, score, samples}]
    best_score      REAL,
    num_candidates  INTEGER,
    num_rollouts    INTEGER,
    duration_ms     INTEGER,
    candidate_model TEXT,
    rollout_model   TEXT
);
CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at);
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

    def _save_sync(self, rec: dict[str, Any]) -> int:
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO analyses
                   (created_at, contact, goal, messages, persona, ranked, best_score,
                    num_candidates, num_rollouts, duration_ms, candidate_model, rollout_model)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    datetime.now(timezone.utc).isoformat(),
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

    def _count_sync(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0])

    async def count(self) -> int:
        return await asyncio.to_thread(self._count_sync)
