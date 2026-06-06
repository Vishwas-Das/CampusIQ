"""Shared Claude (Anthropic) API wrapper.

Reused across phases: document summaries (P7), quiz generation (P11),
RAG chat (P9), mock interviews (P16), etc.

Cost management rule (from the project skill):
    - ALL dev/testing uses claude-haiku-4-5-20251001
    - Only the final demo flips USE_PRODUCTION_MODEL=true to Opus
"""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterator
from datetime import datetime, timezone
from functools import lru_cache

import anthropic
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_client() -> anthropic.Anthropic | None:
    """Return a cached Anthropic client, or None if the key isn't set."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def is_available() -> bool:
    """Whether Claude API calls can succeed (i.e. the key is configured)."""
    return _get_client() is not None


# ═══════════════════════════════════════════════════════════════
# Daily budget cap (lever 5)
# ═══════════════════════════════════════════════════════════════
# USD per million tokens. Update if Anthropic changes prices.
# Numbers as of 2026-01 — Haiku 4.5 is the dev default, Opus 4.6 is the
# production flip target. Unknown models fall back to Haiku pricing so we
# don't accidentally under-bill ourselves.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    # (input_per_million_usd, output_per_million_usd)
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "claude-opus-4-6": (15.0, 75.0),
}
_DEFAULT_PRICING = (1.0, 5.0)


def _estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Compute the USD cost of one Claude call from its token counts."""
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens / 1_000_000.0) * in_price + (output_tokens / 1_000_000.0) * out_price


def _today_spend_usd() -> float:
    """Sum of USD cost from AIUsageLog rows created today (UTC).

    Opens a short-lived DB session. Called as a pre-flight check before every
    real Claude call, so it must stay fast — that's why ai_usage_log.created_at
    is indexed.
    """
    from sqlalchemy import func as sql_func
    from app.core.database import SessionLocal
    from app.models.ai_cache import AIUsageLog

    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

    session = SessionLocal()
    try:
        total = (
            session.query(sql_func.coalesce(sql_func.sum(AIUsageLog.cost_usd), 0.0))
            .filter(AIUsageLog.created_at >= start_of_day)
            .scalar()
        )
        return float(total or 0.0)
    finally:
        session.close()


def _is_over_budget() -> bool:
    """True iff a configured daily cap is set AND today's spend has hit it.

    Returns False when the cap is 0 (= unlimited, the dev default).
    """
    settings = get_settings()
    cap = settings.anthropic_daily_budget_usd
    if cap <= 0:
        return False  # unlimited
    spend = _today_spend_usd()
    over = spend >= cap
    if over:
        logger.warning(
            "Claude daily budget hit: spent $%.6f >= cap $%.6f. New calls refused.",
            spend,
            cap,
        )
    return over


def _log_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    *,
    endpoint: str | None = None,
) -> None:
    """Insert one AIUsageLog row for the just-completed Claude call.

    Never raises — usage logging failures must not break the actual feature.
    """
    from app.core.database import SessionLocal
    from app.models.ai_cache import AIUsageLog

    cost = _estimate_cost_usd(model, input_tokens, output_tokens)
    session = SessionLocal()
    try:
        row = AIUsageLog(
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            endpoint=endpoint,
        )
        session.add(row)
        session.commit()
        logger.info(
            "AI usage logged: model=%s in=%d out=%d cost=$%.5f endpoint=%s",
            model,
            input_tokens,
            output_tokens,
            cost,
            endpoint or "-",
        )
    except Exception:  # noqa: BLE001 — logging must never break the call
        logger.exception("Failed to log AI usage; continuing.")
        session.rollback()
    finally:
        session.close()


def today_spend_usd() -> float:
    """Public read of today's logged Claude spend in USD.

    Exposed for admin dashboards / health endpoints. Same semantics as the
    internal `_today_spend_usd`.
    """
    return _today_spend_usd()


def generate_completion(
    system: str,
    user_message: str,
    *,
    max_tokens: int = 1024,
    temperature: float = 0.3,
    endpoint: str | None = None,
) -> str:
    """Run a single-turn completion. Returns the text content, or "" on failure.

    Errors are logged but never raised — the caller decides whether missing
    output is fatal (e.g. summary generation is best-effort).

    Budget cap: if the daily spend has hit `anthropic_daily_budget_usd`, this
    returns "" without calling Claude. `endpoint` is an optional tag stored in
    the usage log (e.g. "summarize", "quiz_gen") for later spend analysis.
    """
    client = _get_client()
    if client is None:
        logger.info("Claude client not configured — skipping completion")
        return ""

    if _is_over_budget():
        return ""  # graceful degradation — frontend already handles empty replies

    settings = get_settings()
    model = settings.active_anthropic_model  # haiku for dev, opus for demo

    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.APIError as e:
        logger.exception("Claude API error: %s", e)
        return ""
    except Exception as e:
        logger.exception("Unexpected Claude error: %s", e)
        return ""

    # Log usage BEFORE returning so the budget reflects this call right away.
    usage = getattr(response, "usage", None)
    if usage is not None:
        _log_usage(
            model=model,
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            endpoint=endpoint,
        )

    # Pull the first text block
    if not response.content:
        return ""
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", ""))
    return "".join(parts).strip()


def _cache_key(
    system: str, user_message: str, model: str, max_tokens: int, temperature: float
) -> str:
    """SHA-256 fingerprint of the call params.

    Any change to system/user/model/max_tokens/temperature produces a different
    hash, so we never return a stale answer for new inputs. Temperature is
    rounded to 2 decimals to avoid float-precision drift between identical
    Python literals.
    """
    parts = [
        f"model={model}",
        f"mt={max_tokens}",
        f"temp={round(temperature, 2)}",
        f"sys={system}",
        f"usr={user_message}",
    ]
    raw = "\n|\n".join(parts).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def generate_completion_cached(
    system: str,
    user_message: str,
    *,
    max_tokens: int = 1024,
    temperature: float = 0.3,
) -> str:
    """Cache-aware variant of `generate_completion`.

    Identical signature otherwise. On a cache hit, returns the stored response
    text without calling Claude. On a miss, calls Claude and stores the result.
    Failed calls (empty response) are NOT cached — next call will retry.

    Use for deterministic-ish helpers (summarize_document, quiz_generator,
    knowledge_suggest). Do NOT use for live chat or interview turns — those
    aren't deterministic and we don't want their answers reused.
    """
    # Imports are local to avoid circular imports at module load time
    # (models/__init__.py transitively imports this module via services).
    from app.core.database import SessionLocal
    from app.models.ai_cache import AIResponseCache

    settings = get_settings()
    model = settings.active_anthropic_model
    key = _cache_key(system, user_message, model, max_tokens, temperature)

    # ── Lookup ──
    session = SessionLocal()
    try:
        cached = (
            session.query(AIResponseCache)
            .filter(AIResponseCache.cache_key == key)
            .first()
        )
        if cached is not None:
            cached.hit_count += 1
            cached.last_accessed_at = datetime.now(timezone.utc)
            session.commit()
            logger.info(
                "AI cache HIT key=%s... hits=%d", key[:8], cached.hit_count
            )
            return cached.response_text
    finally:
        session.close()

    # ── Miss: call Claude (no DB session held during the API call) ──
    response = generate_completion(
        system=system,
        user_message=user_message,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    if not response:
        return ""  # never cache failures

    # ── Store ──
    session = SessionLocal()
    try:
        row = AIResponseCache(
            cache_key=key,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system_prompt_preview=system[:200],
            user_prompt_preview=user_message[:200],
            response_text=response,
        )
        session.add(row)
        session.commit()
        logger.info(
            "AI cache MISS stored key=%s... bytes=%d", key[:8], len(response)
        )
    except IntegrityError:
        # Race: another worker stored the same key first — harmless, the
        # cached row wins. Next call will get the cache hit path.
        session.rollback()
    finally:
        session.close()

    return response


def generate_completion_multiturn(
    system: str,
    messages: list[dict],
    *,
    max_tokens: int = 1024,
    temperature: float = 0.3,
    endpoint: str | None = None,
) -> str:
    """Multi-turn blocking completion. Takes a full conversation history in
    Claude's chat format (alternating user/assistant turns). Returns the
    assistant's next message text, or "" on failure.

    Use this when you need Claude to remember previous turns but don't care
    about streaming — e.g. the Resume Coach, which needs conversation memory
    to avoid asking the same questions twice.
    """
    client = _get_client()
    if client is None:
        logger.info("Claude client not configured — skipping multiturn completion")
        return ""

    if not messages:
        return ""

    if _is_over_budget():
        return ""

    settings = get_settings()
    model = settings.active_anthropic_model

    # Claude requires alternating user/assistant, starting with user
    cleaned: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant") or not content:
            continue
        cleaned.append({"role": role, "content": content})
    if not cleaned or cleaned[0]["role"] != "user":
        return ""

    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=cleaned,
        )
    except anthropic.APIError as e:
        logger.exception("Claude multiturn API error: %s", e)
        return ""
    except Exception as e:
        logger.exception("Unexpected Claude multiturn error: %s", e)
        return ""

    usage = getattr(response, "usage", None)
    if usage is not None:
        _log_usage(
            model=model,
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            endpoint=endpoint,
        )

    if not response.content:
        return ""
    parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", ""))
    return "".join(parts).strip()


def stream_completion(
    system: str,
    messages: list[dict],
    *,
    max_tokens: int = 1024,
    temperature: float = 0.4,
    endpoint: str | None = None,
) -> Iterator[str]:
    """Stream Claude's response as text deltas.

    `messages` is a list of {role, content} dicts in Claude's chat format.
    Yields plain string chunks suitable for SSE / chunked HTTP.

    If the API key is missing or an error occurs, yields a single fallback
    string explaining the situation — never raises.

    Honors the daily budget cap (lever 5): if we're over budget, yields a
    short notice and stops. Logs token usage after the stream finishes so
    the cap reflects this call on subsequent requests.
    """
    client = _get_client()
    if client is None:
        yield "[AI is not configured. Set ANTHROPIC_API_KEY in backend/.env to enable streaming responses.]"
        return

    if _is_over_budget():
        yield "[The AI assistant is paused for today — daily budget reached. Try again after UTC midnight.]"
        return

    settings = get_settings()
    model = settings.active_anthropic_model

    try:
        with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                if text:
                    yield text
            # Log usage from the finalised message once the stream completes.
            try:
                final = stream.get_final_message()
                usage = getattr(final, "usage", None)
                if usage is not None:
                    _log_usage(
                        model=model,
                        input_tokens=getattr(usage, "input_tokens", 0) or 0,
                        output_tokens=getattr(usage, "output_tokens", 0) or 0,
                        endpoint=endpoint,
                    )
            except Exception:  # noqa: BLE001
                logger.exception("Could not log streaming usage; continuing.")
    except anthropic.APIError as e:
        logger.exception("Claude streaming error: %s", e)
        yield f"\n\n[An error occurred while talking to the AI: {e}]"
    except Exception as e:
        logger.exception("Unexpected Claude streaming error: %s", e)
        yield f"\n\n[Unexpected error: {e}]"


# ═══════════════════════════════════════════════════════════════
# Document summary helper (Phase 7)
# ═══════════════════════════════════════════════════════════════

SUMMARY_SYSTEM_PROMPT = """You are a helpful teaching assistant for engineering students.
When given the text of a course document, produce a concise summary suitable for
students reviewing before an exam. Follow these rules:
- 3-5 short paragraphs
- Plain prose, no markdown headers or lists
- Focus on the key concepts, definitions, and anything a student should remember
- Use simple language, avoid jargon when possible
- Do NOT start with phrases like "This document discusses..." — dive straight in"""


def summarize_document(text: str, max_input_chars: int = 12_000) -> str:
    """Generate a short summary of a document's text content.

    Truncates to `max_input_chars` to keep cost bounded. Returns empty string
    if the API key is not set or if the call fails.
    """
    if not text.strip():
        return ""

    truncated = text if len(text) <= max_input_chars else text[:max_input_chars]
    user_message = (
        f"Here is the content of a course document. Write a summary for students.\n\n"
        f"---\n{truncated}\n---"
    )
    # Cached: same document text → same summary, no need to re-pay Claude.
    return generate_completion_cached(
        system=SUMMARY_SYSTEM_PROMPT,
        user_message=user_message,
        max_tokens=800,
        temperature=0.4,
    )
