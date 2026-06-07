"""Generic OpenAI-compatible streaming LLM client (used with Groq).

A global token-bucket rate limiter + bounded concurrency + 429 backoff keep us
within the provider's limits regardless of how fast analyses are triggered.
Handles optional <think>...</think> reasoning prefixes (stripped) and exposes a
streaming generator that separates 'think' deltas from 'answer' deltas.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, AsyncIterator

import httpx

THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
JSON_OBJ_RE = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)


class RateLimiter:
    """Token bucket over a sliding 60s window + a concurrency semaphore."""

    def __init__(self, max_rpm: int, max_concurrency: int):
        self.max_rpm = max_rpm
        self._times: list[float] = []
        self._lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(max_concurrency)

    async def acquire(self) -> None:
        await self._sem.acquire()
        while True:
            async with self._lock:
                now = time.monotonic()
                self._times = [t for t in self._times if now - t < 60.0]
                if len(self._times) < self.max_rpm:
                    self._times.append(now)
                    return
                wait = 60.0 - (now - self._times[0]) + 0.01
            await asyncio.sleep(wait)

    def release(self) -> None:
        self._sem.release()


class LLMClient:
    def __init__(self) -> None:
        self.api_key = os.environ["LLM_API_KEY"]
        self.base_url = os.environ.get("LLM_BASE_URL", "https://api.groq.com/openai/v1")
        self.limiter = RateLimiter(
            max_rpm=int(os.environ.get("MAX_RPM", "200")),
            max_concurrency=int(os.environ.get("MAX_CONCURRENCY", "8")),
        )
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0),
            headers={"User-Agent": "social-stockfish/0.1"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _payload(self, model, messages, temperature, max_tokens, reasoning, stream):
        p: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if reasoning:
            p["reasoning_effort"] = reasoning
        return p

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.9,
        max_tokens: int = 2048,
        reasoning: str | None = None,
        max_retries: int = 4,
    ) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = self._payload(model, messages, temperature, max_tokens, reasoning, False)
        backoff = 1.0
        last_err: Exception | None = None
        for _ in range(max_retries):
            await self.limiter.acquire()
            try:
                resp = await self._client.post(url, headers=headers, json=payload)
            except httpx.HTTPError as e:
                last_err = e
                self.limiter.release()
                await asyncio.sleep(backoff)
                backoff *= 2
                continue
            else:
                self.limiter.release()
            if resp.status_code == 429 or resp.status_code >= 500:
                delay = float(resp.headers.get("Retry-After", backoff))
                await asyncio.sleep(delay)
                backoff *= 2
                last_err = RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
                continue
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"].get("content") or ""
            return THINK_RE.sub("", content).strip()
        raise RuntimeError(f"LLM request failed after {max_retries} retries: {last_err}")

    async def chat_json(self, messages: list[dict[str, str]], **kw: Any) -> Any:
        return _extract_json(await self.chat(messages, **kw))

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float = 0.9,
        max_tokens: int = 2048,
        reasoning: str | None = None,
    ) -> AsyncIterator[tuple[str, str]]:
        """Stream a response yielding (phase, delta), phase in {'think','answer'}."""
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = self._payload(model, messages, temperature, max_tokens, reasoning, True)
        await self.limiter.acquire()
        try:
            async with self._client.stream("POST", url, headers=headers, json=payload) as resp:
                resp.raise_for_status()
                full = ""
                think_closed = False
                emitted = 0
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        j = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = j.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content") or ""
                    if not delta:
                        continue
                    full += delta
                    if not think_closed:
                        stripped = full.lstrip()
                        if "</think>" in full:
                            think_closed = True
                            emitted = full.index("</think>") + len("</think>")
                        elif stripped and not stripped.startswith("<"):
                            think_closed = True
                            emitted = 0
                        else:
                            yield ("think", delta)
                            continue
                    if len(full) > emitted:
                        yield ("answer", full[emitted:])
                        emitted = len(full)
        finally:
            self.limiter.release()


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    for candidate in (text, _balanced_slice(text)):
        if not candidate:
            continue
        for attempt in (candidate, _strip_trailing_commas(candidate)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse JSON from model output: {text[:300]!r}")


def _balanced_slice(text: str) -> str | None:
    start = next((i for i, ch in enumerate(text) if ch in "{["), None)
    if start is None:
        return None
    open_ch = text[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _strip_trailing_commas(text: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", text)
