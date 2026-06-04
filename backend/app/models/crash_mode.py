"""Crash Mode persistent plan — one active row per student."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CrashModePlan(Base):
    """A student's active crash-study plan.

    Exactly one row per student (unique constraint on student_id). The
    "Regenerate" action replaces the row in place.
    """

    __tablename__ = "crash_mode_plans"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    target_label: Mapped[str] = mapped_column(String(255), nullable=False)
    target_days: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    tasks: Mapped[list] = mapped_column(JSON, nullable=False)
    completed_topics: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    total_hours_scheduled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
