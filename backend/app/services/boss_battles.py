"""Boss Battles service (Phase 10).

Boss battles are short, high-difficulty timed challenges. Each one is stored
as a `Challenge` row with `challenge_type=BOSS_BATTLE`. Students submit
answers, which we score against the embedded answer key in `scoring_rules`,
persist a `ChallengeEntry`, and award XP weighted by score + speed.

Three sample battles are auto-seeded on first call so the page has content
immediately even on a fresh database.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.gamification import (
    Challenge,
    ChallengeEntry,
    ChallengeType,
    XPEvent,
    XPEventType,
)
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


# ── Sample battles ───────────────────────────────────────────────────────

_SAMPLE_BATTLES: list[dict[str, Any]] = [
    {
        "title": "Algorithms Boss Battle",
        "description": "Five rapid-fire DAA questions. 90 seconds. No mercy.",
        "duration_hours": 24,
        "scoring_rules": {
            "time_limit_seconds": 90,
            "xp_reward": 250,
            "questions": [
                {
                    "id": "q1",
                    "question": "Worst-case time complexity of quicksort?",
                    "options": ["O(n)", "O(n log n)", "O(n²)", "O(2^n)"],
                    "answer": "O(n²)",
                },
                {
                    "id": "q2",
                    "question": "Which algorithm finds shortest paths in a weighted graph (no negative edges)?",
                    "options": ["Bellman-Ford", "Dijkstra", "Floyd-Warshall", "Prim's"],
                    "answer": "Dijkstra",
                },
                {
                    "id": "q3",
                    "question": "Heap operations: insertion is O(?)",
                    "options": ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
                    "answer": "O(log n)",
                },
                {
                    "id": "q4",
                    "question": "Knapsack DP runs in?",
                    "options": ["O(nW)", "O(n log n)", "O(n²)", "O(2^n)"],
                    "answer": "O(nW)",
                },
                {
                    "id": "q5",
                    "question": "Branch-and-bound is best for?",
                    "options": [
                        "String matching",
                        "Optimisation with pruning",
                        "Sorting",
                        "Hashing",
                    ],
                    "answer": "Optimisation with pruning",
                },
            ],
        },
    },
    {
        "title": "Discrete Math Speed Round",
        "description": "Five questions across logic, sets, and graph theory. 60 seconds.",
        "duration_hours": 48,
        "scoring_rules": {
            "time_limit_seconds": 60,
            "xp_reward": 200,
            "questions": [
                {
                    "id": "q1",
                    "question": "Hamming distance between 1011 and 1101?",
                    "options": ["1", "2", "3", "4"],
                    "answer": "2",
                },
                {
                    "id": "q2",
                    "question": "|A∪B∪C| =",
                    "options": [
                        "|A| + |B| + |C|",
                        "|A| + |B| + |C| − |A∩B| − |A∩C| − |B∩C| + |A∩B∩C|",
                        "|A∩B∩C|",
                        "|A| × |B| × |C|",
                    ],
                    "answer": "|A| + |B| + |C| − |A∩B| − |A∩C| − |B∩C| + |A∩B∩C|",
                },
                {
                    "id": "q3",
                    "question": "Chromatic number of K₄?",
                    "options": ["2", "3", "4", "5"],
                    "answer": "4",
                },
                {
                    "id": "q4",
                    "question": "Number of equivalence classes on a 3-element set?",
                    "options": ["3", "5", "8", "15"],
                    "answer": "5",
                },
                {
                    "id": "q5",
                    "question": "MST of n vertices has how many edges?",
                    "options": ["n", "n − 1", "n + 1", "2n"],
                    "answer": "n − 1",
                },
            ],
        },
    },
    {
        "title": "Computer Networks Sprint",
        "description": "Five CN questions, 90 seconds — TCP, routing, layers.",
        "duration_hours": 72,
        "scoring_rules": {
            "time_limit_seconds": 90,
            "xp_reward": 220,
            "questions": [
                {
                    "id": "q1",
                    "question": "Which TCP flag opens a connection?",
                    "options": ["SYN", "ACK", "FIN", "RST"],
                    "answer": "SYN",
                },
                {
                    "id": "q2",
                    "question": "OSI layer 4 is?",
                    "options": ["Network", "Transport", "Session", "Application"],
                    "answer": "Transport",
                },
                {
                    "id": "q3",
                    "question": "TCP retransmission backoff is typically?",
                    "options": ["Linear", "Exponential", "Logarithmic", "Constant"],
                    "answer": "Exponential",
                },
                {
                    "id": "q4",
                    "question": "UDP guarantees delivery?",
                    "options": ["Yes", "No", "Only over IPv6", "With ECN"],
                    "answer": "No",
                },
                {
                    "id": "q5",
                    "question": "DNS primarily uses which transport?",
                    "options": ["TCP", "UDP", "QUIC", "SCTP"],
                    "answer": "UDP",
                },
            ],
        },
    },
]


def seed_sample_battles(db: Session) -> int:
    """Create any missing demo battles. Idempotent — keyed on title.

    Per-title idempotency (rather than "skip if any boss battle exists")
    lets the seed recover from a partial wipe: e.g. a teacher deleted
    one of the three. Returns the count newly inserted.
    """
    existing_titles = set(
        db.scalars(
            select(Challenge.title).where(
                Challenge.challenge_type == ChallengeType.BOSS_BATTLE
            )
        ).all()
    )

    now = datetime.now(tz=timezone.utc)
    created = 0
    for entry in _SAMPLE_BATTLES:
        if entry["title"] in existing_titles:
            continue
        battle = Challenge(
            title=entry["title"],
            description=entry["description"],
            challenge_type=ChallengeType.BOSS_BATTLE,
            scoring_rules=entry["scoring_rules"],
            start_time=now,
            end_time=now + timedelta(hours=int(entry["duration_hours"])),
            is_active=True,
        )
        db.add(battle)
        created += 1
    if created:
        db.commit()
    return created


# ── Listing / fetching ────────────────────────────────────────────────────


def _as_utc(dt: datetime) -> datetime:
    """SQLite stores datetimes naive; coerce to UTC for safe comparisons."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _battle_status(now: datetime, battle: Challenge) -> str:
    start = _as_utc(battle.start_time)
    end = _as_utc(battle.end_time)
    if start > now:
        return "upcoming"
    if end < now:
        return "past"
    return "active"


def _serialize_for_student(battle: Challenge, my_entry: ChallengeEntry | None) -> dict[str, Any]:
    rules = battle.scoring_rules or {}
    questions = rules.get("questions", [])
    # Strip answers from the public payload — students see options, not the key.
    public_questions = [
        {
            "id": q.get("id"),
            "question": q.get("question"),
            "options": q.get("options", []),
        }
        for q in questions
    ]
    return {
        "id": str(battle.id),
        "title": battle.title,
        "description": battle.description,
        "challenge_type": battle.challenge_type.value,
        "is_active": battle.is_active,
        "start_time": battle.start_time.isoformat(),
        "end_time": battle.end_time.isoformat(),
        "time_limit_seconds": rules.get("time_limit_seconds"),
        "xp_reward": rules.get("xp_reward", 0),
        "question_count": len(questions),
        "questions": public_questions,
        "my_entry": _entry_payload(my_entry) if my_entry else None,
    }


def _entry_payload(entry: ChallengeEntry) -> dict[str, Any]:
    return {
        "id": str(entry.id),
        "score": float(entry.score),
        "rank": entry.rank,
        "submitted_at": entry.submitted_at.isoformat(),
    }


def list_battles(db: Session, current_user: User) -> dict[str, Any]:
    """List all boss battles, bucketed into active/upcoming/past."""
    seed_sample_battles(db)

    now = datetime.now(tz=timezone.utc)
    battles = (
        db.scalars(
            select(Challenge)
            .where(Challenge.challenge_type == ChallengeType.BOSS_BATTLE)
            .order_by(Challenge.start_time.asc())
        ).all()
    )

    my_entries_by_battle: dict[uuid.UUID, ChallengeEntry] = {}
    if current_user.role == UserRole.STUDENT:
        rows = db.scalars(
            select(ChallengeEntry).where(ChallengeEntry.student_id == current_user.id)
        ).all()
        for row in rows:
            my_entries_by_battle[row.challenge_id] = row

    serialized = []
    for battle in battles:
        my_entry = my_entries_by_battle.get(battle.id)
        payload = _serialize_for_student(battle, my_entry)
        payload["status"] = _battle_status(now, battle)
        serialized.append(payload)

    return {
        "active": [b for b in serialized if b["status"] == "active"],
        "upcoming": [b for b in serialized if b["status"] == "upcoming"],
        "past": [b for b in serialized if b["status"] == "past"],
    }


def get_battle_with_leaderboard(
    db: Session, battle_id: uuid.UUID, current_user: User
) -> dict[str, Any]:
    battle = db.get(Challenge, battle_id)
    if battle is None or battle.challenge_type != ChallengeType.BOSS_BATTLE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Boss battle not found")

    now = datetime.now(tz=timezone.utc)
    my_entry = (
        db.scalar(
            select(ChallengeEntry).where(
                ChallengeEntry.challenge_id == battle.id,
                ChallengeEntry.student_id == current_user.id,
            )
        )
        if current_user.role == UserRole.STUDENT
        else None
    )

    payload = _serialize_for_student(battle, my_entry)
    payload["status"] = _battle_status(now, battle)
    payload["leaderboard"] = _leaderboard(db, battle.id)
    return payload


def _leaderboard(db: Session, battle_id: uuid.UUID, limit: int = 10) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            select(ChallengeEntry, User)
            .join(User, User.id == ChallengeEntry.student_id)
            .where(ChallengeEntry.challenge_id == battle_id)
            .order_by(ChallengeEntry.score.desc(), ChallengeEntry.submitted_at.asc())
            .limit(limit)
        ).all()
    )
    out: list[dict[str, Any]] = []
    for rank, (entry, user) in enumerate(rows, start=1):
        out.append(
            {
                "rank": rank,
                "student_id": str(user.id),
                "name": user.full_name,
                "score": float(entry.score),
                "submitted_at": entry.submitted_at.isoformat(),
            }
        )
    return out


# ── Submitting a battle ───────────────────────────────────────────────────


def submit_battle(
    db: Session,
    user: User,
    *,
    battle_id: uuid.UUID,
    answers: dict[str, str],
    elapsed_seconds: int,
) -> dict[str, Any]:
    if user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can submit a boss battle.",
        )
    battle = db.get(Challenge, battle_id)
    if battle is None or battle.challenge_type != ChallengeType.BOSS_BATTLE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Boss battle not found")

    now = datetime.now(tz=timezone.utc)
    if _as_utc(battle.start_time) > now:
        raise HTTPException(status_code=400, detail="This boss battle hasn't started yet.")
    if _as_utc(battle.end_time) < now:
        raise HTTPException(status_code=400, detail="This boss battle has already ended.")

    rules = battle.scoring_rules or {}
    questions = rules.get("questions", [])
    if not questions:
        raise HTTPException(status_code=400, detail="Boss battle has no questions configured.")

    # Score: % correct, then time bonus up to +20 if finished well under limit.
    # Also build a per-question correctness breakdown so the frontend can
    # show "you got Q3 wrong — the answer was X" after submission.
    correct = 0
    breakdown: list[dict[str, Any]] = []
    for q in questions:
        student_answer = (answers.get(q.get("id"), "") or "").strip()
        right_answer = q.get("answer")
        is_correct = student_answer == right_answer
        if is_correct:
            correct += 1
        breakdown.append(
            {
                "question_id": q.get("id"),
                "question": q.get("question"),
                "student_answer": student_answer or None,
                "correct_answer": right_answer,
                "is_correct": is_correct,
            }
        )
    base_pct = round(100 * correct / len(questions), 2)

    time_limit = max(1, int(rules.get("time_limit_seconds") or 60))
    speed_ratio = max(0.0, 1.0 - (elapsed_seconds / time_limit))
    speed_bonus = round(20 * speed_ratio, 2)
    final_score = min(120.0, round(base_pct + speed_bonus, 2))

    # Upsert entry: one entry per (challenge, student). New attempts can overwrite
    # the prior one only if they score higher — this keeps the leaderboard "best of".
    existing = db.scalar(
        select(ChallengeEntry).where(
            ChallengeEntry.challenge_id == battle.id,
            ChallengeEntry.student_id == user.id,
        )
    )
    if existing is None:
        entry = ChallengeEntry(
            challenge_id=battle.id,
            student_id=user.id,
            score=Decimal(str(final_score)),
        )
        db.add(entry)
    else:
        entry = existing
        if float(existing.score) < final_score:
            existing.score = Decimal(str(final_score))
            existing.submitted_at = datetime.now(tz=timezone.utc)

    db.flush()

    # Award XP scaled by score on a fresh attempt only.
    if existing is None:
        xp_reward = int(rules.get("xp_reward", 0))
        xp_earned = int(round(xp_reward * (final_score / 100.0)))
        if xp_earned > 0:
            event = XPEvent(
                student_id=user.id,
                event_type=XPEventType.BADGE_EARNED,  # nearest fit; no dedicated boss-battle enum yet
                xp_earned=xp_earned,
                reference_id=battle.id,
            )
            db.add(event)
            profile = user.student_profile
            if profile is not None:
                profile.xp_total = int(profile.xp_total or 0) + xp_earned

    # Recompute rank for this entry by counting higher scores. Cheap on a small
    # board, and avoids a second pass over every entry.
    higher = (
        db.scalar(
            select(_count_func()).where(
                ChallengeEntry.challenge_id == battle.id,
                ChallengeEntry.score > entry.score,
            )
        )
        or 0
    )
    entry.rank = int(higher) + 1

    db.commit()
    db.refresh(entry)

    # Phase 9 — push a real-time toast about the boss battle result.
    try:
        from app.models.algorithm import NotificationType
        from app.services import notifications as notifications_service

        notifications_service.publish_sync(
            db,
            user_id=user.id,
            notification_type=NotificationType.BADGE_EARNED,
            title=f"Boss battle: {battle.title}",
            content=f"You scored {final_score:.0f} (rank #{entry.rank}).",
            extra={"battle_id": str(battle.id)},
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Boss battle notification failed: %s", exc)

    return {
        "entry": _entry_payload(entry),
        "score": final_score,
        "correct_count": correct,
        "total_questions": len(questions),
        "speed_bonus": speed_bonus,
        "breakdown": breakdown,
    }


def _count_func():
    """Lazy import sqlalchemy.func.count to keep top-of-module clean."""
    from sqlalchemy import func

    return func.count(ChallengeEntry.id)
