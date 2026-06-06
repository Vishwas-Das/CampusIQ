"""Teacher analytics service (Phase 13).

Aggregates quiz attempt data into headline numbers, score distribution,
weakest topics, and per-student performance — scoped to the teacher's own
subjects (or filtered to a specific subject_id).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.quiz import Quiz, QuizAttempt
from app.models.user import Subject, User, UserRole
from app.schemas.analytics import (
    AnalyticsHeadline,
    ClassAnalytics,
    ScoreBucket,
    StudentPerformanceRow,
    WeakTopicRow,
)


WEAK_TOPIC_THRESHOLD = 60.0
# Lowered from 2 -> 1 so even single-attempt subjects (e.g. a quiz where
# every question has a unique topic) surface in the weak-topics list. The
# old threshold filtered ALL topics out of small quizzes, making the page
# look broken. With real classroom-sized data this self-balances — many
# students answering the same questions = the genuine weak spots dominate.
WEAK_TOPIC_MIN_ATTEMPTS = 1
SCORE_BUCKETS = [
    (0, 19, "0-19"),
    (20, 39, "20-39"),
    (40, 59, "40-59"),
    (60, 79, "60-79"),
    (80, 100, "80-100"),
]


def _require_teacher(user: User) -> None:
    if user.role not in (UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers or admins can view class analytics.",
        )


def _quiz_filter(stmt, user: User, subject_id: uuid.UUID | None):
    """Restrict a SELECT statement to quizzes the teacher can see."""
    if user.role == UserRole.TEACHER:
        stmt = stmt.where(Quiz.created_by_id == user.id)
    if subject_id is not None:
        stmt = stmt.where(Quiz.subject_id == subject_id)
    return stmt


def get_class_analytics(
    db: Session,
    user: User,
    *,
    subject_id: uuid.UUID | None = None,
) -> ClassAnalytics:
    _require_teacher(user)

    # ── Pull every attempt + quiz + student in the teacher's scope ──
    stmt = (
        select(QuizAttempt, Quiz, User)
        .join(Quiz, QuizAttempt.quiz_id == Quiz.id)
        .join(User, QuizAttempt.student_id == User.id)
    )
    stmt = _quiz_filter(stmt, user, subject_id)
    rows = db.execute(stmt).all()

    # Headline aggregates
    scores: list[float] = []
    distinct_students: set[uuid.UUID] = set()
    student_attempts: dict[uuid.UUID, list[tuple[float, datetime, str]]] = defaultdict(list)
    student_names: dict[uuid.UUID, str] = {}
    student_topics: dict[uuid.UUID, dict] = defaultdict(lambda: defaultdict(lambda: {"correct": 0, "total": 0}))
    topic_bucket: dict[str, dict] = defaultdict(lambda: {"correct": 0, "total": 0, "subject": None})

    for attempt, quiz, student in rows:
        score_f = float(attempt.score)
        scores.append(score_f)
        distinct_students.add(student.id)
        student_names[student.id] = student.full_name
        student_attempts[student.id].append((score_f, attempt.completed_at, ""))

        if attempt.answers:
            for ans in attempt.answers:
                topic = (ans.get("topic") or "").strip()
                if not topic:
                    continue
                bucket = topic_bucket[topic]
                bucket["total"] += 1
                if ans.get("is_correct"):
                    bucket["correct"] += 1
                # Track per-student topic correctness
                stbucket = student_topics[student.id][topic]
                stbucket["total"] += 1
                if ans.get("is_correct"):
                    stbucket["correct"] += 1

    class_average = round(sum(scores) / len(scores), 2) if scores else None

    # Completion rate — distinct (student, quiz) pairs / (active_students * teacher_quiz_count)
    quiz_count_stmt = _quiz_filter(
        select(Quiz.id).where(Quiz.is_published.is_(True)), user, subject_id
    )
    published_quiz_ids = [r[0] for r in db.execute(quiz_count_stmt).all()]
    distinct_attempts = {(r[0], r[1]) for r in (
        (a.student_id, a.quiz_id) for a, *_ in rows
    )}
    if distinct_students and published_quiz_ids:
        completion_rate = round(
            len(distinct_attempts) / (len(distinct_students) * len(published_quiz_ids)) * 100,
            2,
        )
    else:
        completion_rate = None

    # Most-missed topic = topic with the lowest correctness %.
    # Tiebreaker: pick the topic with MORE attempts — it's a more confident
    # signal of class-wide struggle than a single-data-point fluke. Without
    # this, dict iteration order decides ties and the answer changes between
    # runs.
    most_missed = None
    most_missed_score = 101.0
    most_missed_attempts = -1
    for topic, b in topic_bucket.items():
        if b["total"] < WEAK_TOPIC_MIN_ATTEMPTS:
            continue
        pct = (b["correct"] / b["total"]) * 100
        if pct < most_missed_score or (
            pct == most_missed_score and b["total"] > most_missed_attempts
        ):
            most_missed_score = pct
            most_missed_attempts = b["total"]
            most_missed = topic

    headline = AnalyticsHeadline(
        class_average=class_average,
        completion_rate=completion_rate,
        most_missed_topic=most_missed,
        active_students=len(distinct_students),
    )

    # ── Weak topic rows ──
    weak_topics: list[WeakTopicRow] = []
    for topic, b in topic_bucket.items():
        if b["total"] < WEAK_TOPIC_MIN_ATTEMPTS:
            continue
        pct = round((b["correct"] / b["total"]) * 100, 2)
        if pct >= WEAK_TOPIC_THRESHOLD:
            continue
        weak_topics.append(
            WeakTopicRow(
                topic=topic,
                score_percent=pct,
                attempts=b["total"],
                subject_code=None,
            )
        )
    weak_topics.sort(key=lambda w: w.score_percent)
    weak_topics = weak_topics[:8]

    # ── Score distribution ──
    distribution: list[ScoreBucket] = []
    for low, high, label in SCORE_BUCKETS:
        count = sum(1 for s in scores if low <= s <= high)
        distribution.append(
            ScoreBucket(label=label, range_start=low, range_end=high, count=count)
        )

    # ── Per-student performance ──
    student_rows: list[StudentPerformanceRow] = []
    for sid, attempts in student_attempts.items():
        attempts.sort(key=lambda x: x[1])  # oldest first
        score_list = [a[0] for a in attempts]
        avg = round(sum(score_list) / len(score_list), 2)

        # Trend: compare avg of latter half vs former half
        trend = "flat"
        if len(score_list) >= 4:
            half = len(score_list) // 2
            first_avg = sum(score_list[:half]) / half
            last_avg = sum(score_list[half:]) / (len(score_list) - half)
            if last_avg - first_avg > 5:
                trend = "up"
            elif first_avg - last_avg > 5:
                trend = "down"
        elif len(score_list) >= 2:
            if score_list[-1] - score_list[0] > 5:
                trend = "up"
            elif score_list[0] - score_list[-1] > 5:
                trend = "down"

        # Weakest topic for this student
        weak_area = None
        worst_pct = 101.0
        for topic, b in student_topics[sid].items():
            if b["total"] == 0:
                continue
            pct = (b["correct"] / b["total"]) * 100
            if pct < worst_pct and pct < WEAK_TOPIC_THRESHOLD:
                worst_pct = pct
                weak_area = topic

        last_at = attempts[-1][1].isoformat() if attempts else None
        student_rows.append(
            StudentPerformanceRow(
                student_id=sid,
                name=student_names.get(sid, "Unknown"),
                quizzes_taken=len(score_list),
                avg_score=avg,
                last_attempt_at=last_at,
                trend=trend,
                weak_area=weak_area,
            )
        )

    student_rows.sort(key=lambda s: (s.avg_score or 0), reverse=True)

    return ClassAnalytics(
        teacher_id=user.id,
        subject_id=subject_id,
        headline=headline,
        weak_topics=weak_topics,
        score_distribution=distribution,
        student_performance=student_rows,
    )
