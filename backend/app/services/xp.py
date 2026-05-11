"""XP, level, and streak service (Phase 12, F13).

Concepts used:
- DMS Unit I — recurrence relation for level thresholds:
      T(L) = T(L-1) + 100 * L,  T(1) = 0
      Solution: T(L) = 50 * L * (L-1)

- Streak multiplier — caps daily-login bonus growth at 1.5x
"""
from __future__ import annotations

import logging
import math
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.gamification import XPEvent, XPEventType
from app.models.quiz import Difficulty, Quiz, QuizAttempt
from app.models.user import StudentProfile, User

logger = logging.getLogger(__name__)


# ── Base XP values per event type ──
BASE_XP: dict[XPEventType, int] = {
    XPEventType.QUIZ_COMPLETED: 30,
    XPEventType.MOCK_INTERVIEW_COMPLETED: 80,
    XPEventType.DOUBT_ANSWERED: 25,
    XPEventType.DOUBT_UPVOTED: 5,
    XPEventType.RESUME_UPDATED: 20,
    XPEventType.CONFIDENCE_SESSION: 35,
    XPEventType.SKILL_UNLOCKED: 50,
    XPEventType.DAILY_LOGIN: 10,
    XPEventType.BADGE_EARNED: 100,
    XPEventType.CODING_PROBLEM_SOLVED: 45,  # between doubt-answered and mock-interview
}

# Per-difficulty quiz multiplier on top of the base (DAA Unit IV greedy slope)
DIFFICULTY_MULTIPLIER: dict[Difficulty, float] = {
    Difficulty.EASY: 1.0,
    Difficulty.MEDIUM: 1.5,
    Difficulty.HARD: 2.2,
}

MAX_STREAK_BONUS_DAYS = 10  # streak past this point doesn't add more multiplier
MAX_STREAK_MULTIPLIER = 1.5  # cap


# ════════════════════════════════════════════════════════════════
# Level math (DMS Unit I — recurrence relation)
# ════════════════════════════════════════════════════════════════

def xp_threshold_for_level(level: int) -> int:
    """Cumulative XP required to *enter* `level`.

    T(L) = 50 * L * (L-1)  →  T(1)=0, T(2)=100, T(3)=300, T(4)=600, T(5)=1000…
    """
    if level <= 1:
        return 0
    return 50 * level * (level - 1)


def level_for_xp(xp_total: int) -> int:
    """Inverse of `xp_threshold_for_level()` — solve 50 * L * (L-1) ≤ xp_total.

    Quadratic 50L² - 50L - xp_total ≤ 0  →  L ≤ (1 + sqrt(1 + xp_total/12.5)) / 2
    """
    if xp_total <= 0:
        return 1
    inner = 1 + xp_total / 12.5
    return max(1, math.floor((1 + math.sqrt(inner)) / 2))


def xp_progress_to_next_level(xp_total: int) -> tuple[int, int, int]:
    """Returns (current_level_xp, current_level_floor, next_level_threshold).

    `current_level_xp` is how many XP into the current level the student is.
    `current_level_floor` is the cumulative XP at the start of this level.
    `next_level_threshold` is the cumulative XP at the start of the next level.
    """
    level = level_for_xp(xp_total)
    floor_xp = xp_threshold_for_level(level)
    next_xp = xp_threshold_for_level(level + 1)
    return xp_total - floor_xp, floor_xp, next_xp


# ════════════════════════════════════════════════════════════════
# Streak handling
# ════════════════════════════════════════════════════════════════

def streak_multiplier(streak_days: int) -> float:
    """Linearly grow the multiplier by 0.05 per day, capped at 1.5x."""
    bonus = min(streak_days, MAX_STREAK_BONUS_DAYS) * 0.05
    return min(MAX_STREAK_MULTIPLIER, 1.0 + bonus)


def update_streak(profile: StudentProfile, *, today: date | None = None) -> int:
    """Apply daily-login streak rules to the profile.

    - Last activity == today                  → streak unchanged
    - Last activity == yesterday                → streak += 1
    - Last activity ≥ 2 days ago, or never       → streak resets to 1
    """
    today = today or date.today()
    last = profile.last_active_date

    if last is None:
        profile.streak_days = 1
    elif last == today:
        # already counted today
        pass
    elif last == today - timedelta(days=1):
        profile.streak_days = (profile.streak_days or 0) + 1
    else:
        profile.streak_days = 1

    profile.last_active_date = today
    return profile.streak_days


# ════════════════════════════════════════════════════════════════
# XP awarding
# ════════════════════════════════════════════════════════════════

@dataclass
class AwardedXP:
    event: XPEvent
    leveled_up: bool
    new_level: int
    xp_total: int


def _ensure_profile(db: Session, user: User) -> StudentProfile:
    if user.student_profile is None:
        # The auth flow already creates this for student signups, but be safe
        profile = StudentProfile(user_id=user.id)
        db.add(profile)
        db.flush()
        user.student_profile = profile
    return user.student_profile


def award_xp(
    db: Session,
    user: User,
    event_type: XPEventType,
    *,
    reference_id: uuid.UUID | None = None,
    base_override: int | None = None,
    bonus_multiplier: float = 1.0,
) -> AwardedXP:
    """Persist an XP event, update the student profile, and return the result."""
    profile = _ensure_profile(db, user)
    update_streak(profile)

    base = base_override if base_override is not None else BASE_XP.get(event_type, 0)
    multiplier = streak_multiplier(profile.streak_days) * bonus_multiplier
    earned = max(0, int(round(base * multiplier)))

    event = XPEvent(
        student_id=user.id,
        event_type=event_type,
        xp_earned=earned,
        streak_multiplier=Decimal(f"{multiplier:.2f}"),
        reference_id=reference_id,
    )
    db.add(event)

    old_level = profile.current_level
    profile.xp_total = (profile.xp_total or 0) + earned
    profile.current_level = level_for_xp(profile.xp_total)
    leveled_up = profile.current_level > old_level

    db.flush()

    if leveled_up:
        logger.info(
            "Student %s leveled up: %d → %d (%d XP total)",
            user.id,
            old_level,
            profile.current_level,
            profile.xp_total,
        )

    return AwardedXP(
        event=event,
        leveled_up=leveled_up,
        new_level=profile.current_level,
        xp_total=profile.xp_total,
    )


def award_xp_for_quiz_attempt(
    db: Session,
    user: User,
    *,
    attempt: QuizAttempt,
    quiz: Quiz,
) -> AwardedXP:
    """Quiz-specific XP wrapper. Scales by score % and difficulty multiplier."""
    score_fraction = float(attempt.score) / 100.0
    difficulty_mul = DIFFICULTY_MULTIPLIER.get(quiz.difficulty, 1.0)
    base = BASE_XP[XPEventType.QUIZ_COMPLETED]
    earned_base = int(round(base * difficulty_mul * max(score_fraction, 0.2)))
    return award_xp(
        db,
        user,
        XPEventType.QUIZ_COMPLETED,
        reference_id=quiz.id,
        base_override=earned_base,
    )


# ════════════════════════════════════════════════════════════════
# Read helpers
# ════════════════════════════════════════════════════════════════

def recent_xp_events(db: Session, user: User, *, limit: int = 10) -> list[XPEvent]:
    return list(
        db.scalars(
            select(XPEvent)
            .where(XPEvent.student_id == user.id)
            .order_by(XPEvent.created_at.desc())
            .limit(limit)
        ).all()
    )
