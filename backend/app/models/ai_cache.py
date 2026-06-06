"""Tables that protect Claude spend.

`AIResponseCache` — cache for deterministic-ish completions. One row per
(system, user, model, max_tokens, temperature) tuple, keyed by sha256 hex
digest. Used by `claude_client.generate_completion_cached`.

`AIUsageLog` — audit trail of every real Claude call. One row per call, with
token counts + estimated USD cost. Powers the daily budget cap (lever 5)
and gives us per-endpoint spend visibility.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AIResponseCache(Base):
    __tablename__ = "ai_response_cache"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    # sha256 hex digest of (system + user + model + max_tokens + temperature).
    # 64 chars, indexed + unique — concurrent writes that race fall back to
    # the IntegrityError path in claude_client.
    cache_key: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )

    # Denormalised for observability — we can `SELECT model, COUNT(*) ... GROUP BY model`
    # to see which model is responsible for cache pressure.
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)

    # First 200 chars of each prompt — debug-only, never used for matching.
    system_prompt_preview: Mapped[str] = mapped_column(String(200), nullable=False)
    user_prompt_preview: Mapped[str] = mapped_column(String(200), nullable=False)

    response_text: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AIUsageLog(Base):
    """One row per real Claude API call.

    Cached calls do NOT produce a row here — they're already free. Used by
    `claude_client._today_spend_usd()` to enforce the daily budget cap, and
    by future dashboards to break spend down by endpoint / model / day.
    """

    __tablename__ = "ai_usage_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    # Indexed because the budget check runs `SUM(cost_usd) WHERE created_at >= today`
    # on every Claude call — must stay fast as the table grows.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    model: Mapped[str] = mapped_column(String(100), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Optional context — which feature triggered the call. Helps later when
    # we want to know "which endpoint is burning the most budget".
    endpoint: Mapped[str | None] = mapped_column(String(100), nullable=True)
