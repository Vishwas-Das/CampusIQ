"""Peer doubt community models (F4)."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models._enum_helper import enum_values


class DoubtVisibility(str, enum.Enum):
    PUBLIC = "public"          # whole-class Discord-style feed
    PRIVATE = "private"        # WhatsApp-style DM to one teacher


class Doubt(Base):
    __tablename__ = "doubts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="SET NULL"), index=True
    )
    visibility: Mapped[DoubtVisibility] = mapped_column(
        Enum(DoubtVisibility, name="doubt_visibility", values_callable=enum_values),
        default=DoubtVisibility.PUBLIC,
        nullable=False,
        index=True,
    )
    # Only set when visibility=PRIVATE. The teacher who will see this DM.
    assigned_teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list | None] = mapped_column(JSON, default=list)  # ["DAA", "Graph"]
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    upvote_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # "Delete from my view" — PRIVATE DMs use the boolean pair (hard-delete when
    # both sides hide). PUBLIC posts use the user-id list (any user can hide a
    # public doubt for themselves without affecting other readers).
    hidden_for_student: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hidden_for_teacher: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hidden_by_user_ids: Mapped[list | None] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    answers: Mapped[list["DoubtAnswer"]] = relationship(
        back_populates="doubt", cascade="all, delete-orphan"
    )


class DoubtAnswer(Base):
    __tablename__ = "doubt_answers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    doubt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("doubts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    answered_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    upvote_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    doubt: Mapped["Doubt"] = relationship(back_populates="answers")
