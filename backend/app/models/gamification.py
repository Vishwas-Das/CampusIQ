"""Gamification models: XP events, skill tree, badges, leaderboard, CampusIQ score."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models._enum_helper import enum_values


class XPEventType(str, enum.Enum):
    QUIZ_COMPLETED = "quiz_completed"
    MOCK_INTERVIEW_COMPLETED = "mock_interview_completed"
    DOUBT_ANSWERED = "doubt_answered"
    DOUBT_UPVOTED = "doubt_upvoted"
    RESUME_UPDATED = "resume_updated"
    CONFIDENCE_SESSION = "confidence_session"
    SKILL_UNLOCKED = "skill_unlocked"
    DAILY_LOGIN = "daily_login"
    BADGE_EARNED = "badge_earned"
    CODING_PROBLEM_SOLVED = "coding_problem_solved"


class XPEvent(Base):
    """Log of XP-earning actions (F13)."""

    __tablename__ = "xp_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[XPEventType] = mapped_column(
        Enum(XPEventType, name="xp_event_type", values_callable=enum_values),
        nullable=False,
    )
    xp_earned: Mapped[int] = mapped_column(Integer, nullable=False)
    streak_multiplier: Mapped[float] = mapped_column(Numeric(3, 2), default=1.0, nullable=False)
    # Reference to the event that triggered this (quiz_id, interview_id, etc)
    reference_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SkillTreeProgress(Base):
    """Student's progress across the 6 skill domains (F13)."""

    __tablename__ = "skill_tree_progress"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    domain: Mapped[str] = mapped_column(String(100), nullable=False)  # web_dev, ml, dsa, etc.
    current_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    max_level: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    progress_percentage: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    unlocked_skills: Mapped[list | None] = mapped_column(JSON, default=list)
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Badge(Base):
    """Earned badges (F15 Boss Battles, regular achievements)."""

    __tablename__ = "badges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    badge_type: Mapped[str] = mapped_column(String(100), nullable=False)
    badge_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(100))  # lucide icon name
    earned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    is_visible_to_recruiters: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ChallengeType(str, enum.Enum):
    QUIZ_BATTLE = "quiz_battle"
    MOCK_INTERVIEW_SCORE = "mock_interview_score"
    MOST_IMPROVED = "most_improved"
    BOSS_BATTLE = "boss_battle"


class Challenge(Base):
    """Weekly challenges + monthly boss battles (F14, F15)."""

    __tablename__ = "challenges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    college_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("colleges.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    challenge_type: Mapped[ChallengeType] = mapped_column(
        Enum(ChallengeType, name="challenge_type", values_callable=enum_values),
        nullable=False,
    )
    scoring_rules: Mapped[dict | None] = mapped_column(JSON)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ChallengeEntry(Base):
    """A student's score in a challenge."""

    __tablename__ = "challenge_entries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    challenge_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("challenges.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[float] = mapped_column(Numeric(7, 2), default=0, nullable=False)
    rank: Mapped[int | None] = mapped_column(Integer)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CampusIQScore(Base):
    """The composite CampusIQ Score (F16) — 4 pillars."""

    __tablename__ = "campus_iq_scores"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    total_score: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    academic_pillar: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    skill_pillar: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    interview_pillar: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    placement_pillar: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
