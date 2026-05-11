"""Student / Teacher / Admin dashboard aggregators (Phase 12 + Phase 4 wiring).

Bundles XP / level / streak, CampusIQ score, basic stats, the heap-based task
feed, and a feed of recent XP events into a single response.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.content import Announcement
from app.models.gamification import XPEvent, XPEventType
from app.models.community import Doubt, DoubtAnswer
from app.models.quiz import Quiz, QuizAttempt
from app.models.user import (
    Document,
    DocumentStatus,
    StudentProfile,
    Subject,
    TeacherProfile,
    User,
    UserRole,
)
from app.schemas.dashboard import (
    ActivityItem,
    AdminDashboardResponse,
    AdminStat,
    AdminUserListResponse,
    AdminUserRow,
    CampusIQScoreBreakdown,
    DashboardResponse,
    DashboardStats,
    PlatformActivityItem,
    PlatformHealth,
    RecentUploadRow,
    StudentDetailResponse,
    StudentQuizScore,
    MissedQuestionRow,
    ScoreBucketRow,
    SubjectPerformanceRow,
    TaskItemResponse,
    TeacherActivityItem,
    TeacherAnalyticsResponse,
    TeacherDashboardResponse,
    TeacherStat,
    TopicAccuracyRow,
    UserBreakdownRow,
    XPProgress,
)
from app.services import announcement, campus_iq_score, task_feed, xp


# ── Friendly labels for XP event types ──
EVENT_LABELS: dict[XPEventType, str] = {
    XPEventType.QUIZ_COMPLETED: "Completed a quiz",
    XPEventType.MOCK_INTERVIEW_COMPLETED: "Finished a mock interview",
    XPEventType.DOUBT_ANSWERED: "Answered a community doubt",
    XPEventType.DOUBT_UPVOTED: "Got upvoted",
    XPEventType.RESUME_UPDATED: "Updated resume",
    XPEventType.CONFIDENCE_SESSION: "Confidence Coach session",
    XPEventType.SKILL_UNLOCKED: "Unlocked a skill",
    XPEventType.DAILY_LOGIN: "Daily login bonus",
    XPEventType.BADGE_EARNED: "Earned a badge",
    XPEventType.CODING_PROBLEM_SOLVED: "Solved a coding problem",
}


def _xp_progress(user: User) -> XPProgress:
    profile = user.student_profile
    xp_total = (profile.xp_total if profile else 0) or 0
    streak_days = (profile.streak_days if profile else 0) or 0

    into_level, _floor, next_threshold = xp.xp_progress_to_next_level(xp_total)
    return XPProgress(
        xp_total=xp_total,
        current_level=xp.level_for_xp(xp_total),
        streak_days=streak_days,
        streak_multiplier=xp.streak_multiplier(streak_days),
        xp_into_level=into_level,
        next_level_threshold=next_threshold,
        xp_to_next_level=max(0, next_threshold - xp_total),
    )


def _quiz_stats(db: Session, user: User) -> DashboardStats:
    attempted = (
        db.scalar(select(func.count(QuizAttempt.id)).where(QuizAttempt.student_id == user.id))
        or 0
    )
    passed = (
        db.scalar(
            select(func.count(QuizAttempt.id))
            .where(QuizAttempt.student_id == user.id)
            .where(QuizAttempt.score >= 60)
        )
        or 0
    )
    avg = db.scalar(
        select(func.avg(QuizAttempt.score)).where(QuizAttempt.student_id == user.id)
    )
    return DashboardStats(
        quizzes_attempted=int(attempted),
        quizzes_passed=int(passed),
        avg_quiz_score=float(avg) if avg is not None else None,
    )


def _recent_activity(db: Session, user: User, *, limit: int = 8) -> list[ActivityItem]:
    events = xp.recent_xp_events(db, user, limit=limit)
    return [
        ActivityItem(
            id=e.id,
            event_type=e.event_type.value,
            xp_earned=e.xp_earned,
            created_at=e.created_at,
            title=EVENT_LABELS.get(e.event_type, e.event_type.value.replace("_", " ").title()),
        )
        for e in events
    ]


def _to_task_response(task) -> TaskItemResponse:
    return TaskItemResponse(
        title=task.title,
        reason=task.reason,
        priority=task.priority,
        score=round(task.score, 2),
        kind=task.kind,
        action_url=task.action_url,
        quiz_id=task.quiz_id,
        subject_code=task.subject_code,
    )


def get_student_dashboard(db: Session, user: User) -> DashboardResponse:
    profile = user.student_profile
    score = campus_iq_score.get_or_create(db, user)
    db.commit()  # persist any score row created on first call
    db.refresh(user)

    return DashboardResponse(
        student_id=user.id,
        full_name=user.full_name,
        semester=profile.semester if profile else None,
        branch=profile.branch if profile else None,
        xp=_xp_progress(user),
        score=CampusIQScoreBreakdown(
            total=score.total,
            academic=score.academic,
            skill=score.skill,
            interview=score.interview,
            placement=score.placement,
            last_calculated_at=score.last_calculated_at,
        ),
        stats=_quiz_stats(db, user),
        tasks=[_to_task_response(t) for t in task_feed.build_task_feed(db, user)],
        recent_activity=_recent_activity(db, user),
        announcements=announcement.list_announcements(db, user, limit=5),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Teacher dashboard
# ──────────────────────────────────────────────────────────────────────────────


# ════════════════════════════════════════════════════════════════
# Teacher per-subject analytics (drill-down inside Class Performance)
# ════════════════════════════════════════════════════════════════

# Score bins for the distribution histogram. Five even buckets makes the
# chart readable; finer-grained bins create a sparse histogram with most
# columns at zero.
_SCORE_BUCKETS = [
    ("0–20%", 0, 20),
    ("21–40%", 21, 40),
    ("41–60%", 41, 60),
    ("61–80%", 61, 80),
    ("81–100%", 81, 100),
]


def get_teacher_analytics(
    db: Session,
    user: User,
    *,
    subject_id: uuid.UUID | None = None,
) -> TeacherAnalyticsResponse:
    """Compute weakest-topic, most-missed-question, and score-distribution
    breakdowns for the given teacher and (optionally) a single subject.

    subject_id=None means "all of this teacher's subjects combined".
    """
    if user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can view their own class analytics.",
        )

    # Look up the subject row once if filtering, so the response carries the
    # subject's code/name for the frontend header.
    subject: Subject | None = None
    if subject_id is not None:
        subject = db.get(Subject, subject_id)
        if subject is None or subject.teacher_id != user.id:
            raise HTTPException(
                status_code=404, detail="Subject not found or not yours."
            )

    # Pull every attempt on this teacher's quizzes (optionally scoped to one
    # subject). We need both the attempt (for score + answers JSON) and the
    # quiz (for title) to build the most-missed-questions list.
    stmt = (
        select(QuizAttempt, Quiz)
        .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        .where(Quiz.created_by_id == user.id)
    )
    if subject_id is not None:
        stmt = stmt.where(Quiz.subject_id == subject_id)
    rows = db.execute(stmt).all()

    if not rows:
        return TeacherAnalyticsResponse(
            subject_id=subject_id,
            subject_code=subject.code if subject else None,
            subject_name=subject.name if subject else None,
        )

    # ── Score distribution ──
    # Count how many attempts fall in each bucket. Inclusive on both ends so
    # 20 lands in 0–20 and 21 lands in 21–40 (no gap).
    buckets = {label: 0 for label, _, _ in _SCORE_BUCKETS}
    for attempt, _quiz in rows:
        score = float(attempt.score)
        for label, lo, hi in _SCORE_BUCKETS:
            if lo <= score <= hi:
                buckets[label] += 1
                break

    # ── Walk the answers JSON to gather per-question + per-topic accuracy ──
    # Each attempt.answers is a list of dicts: {question_id, is_correct, topic, ...}
    topic_correct: dict[str, int] = defaultdict(int)
    topic_total: dict[str, int] = defaultdict(int)
    q_correct: dict[str, int] = defaultdict(int)
    q_total: dict[str, int] = defaultdict(int)
    q_meta: dict[str, dict] = {}  # question_id -> {question_text, quiz_id, quiz_title}

    for attempt, quiz in rows:
        for ans in (attempt.answers or []):
            qid = str(ans.get("question_id") or "")
            if not qid:
                continue
            is_correct = bool(ans.get("is_correct"))
            topic = (ans.get("topic") or "General").strip() or "General"

            topic_total[topic] += 1
            if is_correct:
                topic_correct[topic] += 1

            q_total[qid] += 1
            if is_correct:
                q_correct[qid] += 1
            # Remember meta from the most recent attempt — we'll resolve
            # question_text from the DB later (cheaper to batch).
            q_meta[qid] = {
                "quiz_id": str(quiz.id),
                "quiz_title": quiz.title,
            }

    # ── Build weakest topics: ascending by accuracy, top 5. Threshold of 1
    # so small quizzes (where each question has a unique topic) still show
    # up — matches analytics.py WEAK_TOPIC_MIN_ATTEMPTS=1. ──
    topic_rows: list[TopicAccuracyRow] = []
    for topic, total in topic_total.items():
        if total < 1:
            continue
        correct = topic_correct[topic]
        accuracy = (correct / total) * 100
        topic_rows.append(
            TopicAccuracyRow(
                topic=topic,
                attempts=total,
                correct=correct,
                accuracy_pct=round(accuracy, 1),
            )
        )
    topic_rows.sort(key=lambda r: r.accuracy_pct)
    weakest_topics = topic_rows[:5]

    # ── Build most missed questions: fetch text for the top candidates,
    # then sort ascending by accuracy. Threshold of 1 (same reasoning as
    # topics above — small classes / fresh data shouldn't disappear). ──
    candidate_ids = [qid for qid, total in q_total.items() if total >= 1]
    question_text_map: dict[str, str] = {}
    if candidate_ids:
        from app.models.quiz import Question
        # We need to filter by UUID. Convert + bulk SELECT.
        try:
            uuid_list = [uuid.UUID(q) for q in candidate_ids]
        except (ValueError, AttributeError):
            uuid_list = []
        if uuid_list:
            qrows = db.execute(
                select(Question.id, Question.question_text)
                .where(Question.id.in_(uuid_list))
            ).all()
            question_text_map = {str(qid): text for qid, text in qrows}

    missed_rows: list[MissedQuestionRow] = []
    for qid in candidate_ids:
        text = question_text_map.get(qid)
        meta = q_meta.get(qid, {})
        if not text or "quiz_id" not in meta:
            continue
        total = q_total[qid]
        correct = q_correct[qid]
        accuracy = (correct / total) * 100
        try:
            missed_rows.append(
                MissedQuestionRow(
                    question_id=uuid.UUID(qid),
                    question_text=text,
                    quiz_id=uuid.UUID(meta["quiz_id"]),
                    quiz_title=meta["quiz_title"],
                    times_asked=total,
                    times_correct=correct,
                    accuracy_pct=round(accuracy, 1),
                )
            )
        except (ValueError, KeyError):
            continue
    missed_rows.sort(key=lambda r: r.accuracy_pct)
    most_missed = missed_rows[:5]

    # ── Score distribution rows in canonical order ──
    distribution = [
        ScoreBucketRow(bucket_label=label, bucket_min=lo, bucket_max=hi, count=buckets[label])
        for label, lo, hi in _SCORE_BUCKETS
    ]

    return TeacherAnalyticsResponse(
        subject_id=subject_id,
        subject_code=subject.code if subject else None,
        subject_name=subject.name if subject else None,
        weakest_topics=weakest_topics,
        most_missed_questions=most_missed,
        score_distribution=distribution,
        total_attempts=len(rows),
    )


def _teacher_recent_activity(
    db: Session, user: User, *, limit: int = 15
) -> list[TeacherActivityItem]:
    """Aggregate the teacher's recent actions across documents, quizzes,
    announcements, and student attempts on their quizzes.

    We query each source separately (5 from each, sorted desc), merge them in
    Python, then sort by occurred_at and trim to `limit`. Per-source cap keeps
    each SELECT cheap; the final merge is O(N) over ≤20 items.
    """
    items: list[TeacherActivityItem] = []

    # 1) Uploads — file name as title, subject as subtitle.
    docs = db.execute(
        select(Document, Subject)
        .join(Subject, Subject.id == Document.subject_id)
        .where(Document.uploaded_by_id == user.id)
        .order_by(Document.created_at.desc())
        .limit(5)
    ).all()
    for doc, subj in docs:
        items.append(
            TeacherActivityItem(
                type="doc_uploaded",
                title=f"Uploaded {doc.chapter or doc.title or doc.file_name}",
                subtitle=subj.code if subj else None,
                occurred_at=doc.created_at,
                action_url="/teacher/documents",
            )
        )

    # 2) Quizzes — both create and publish events. We don't have a separate
    # published_at column, so we treat created_at as the moment for both;
    # `is_published` toggles the message label.
    quizzes = list(
        db.scalars(
            select(Quiz)
            .where(Quiz.created_by_id == user.id)
            .order_by(Quiz.created_at.desc())
            .limit(5)
        ).all()
    )
    for q in quizzes:
        items.append(
            TeacherActivityItem(
                type="quiz_published" if q.is_published else "quiz_created",
                title=f"{'Published' if q.is_published else 'Created'} quiz: {q.title}",
                subtitle=f"{q.question_count if hasattr(q, 'question_count') else ''}" or None,
                occurred_at=q.created_at,
                action_url="/teacher/quizzes",
            )
        )

    # 3) Announcements — title of the announcement is the headline.
    announcements = list(
        db.scalars(
            select(Announcement)
            .where(Announcement.author_id == user.id)
            .order_by(Announcement.created_at.desc())
            .limit(5)
        ).all()
    )
    for a in announcements:
        items.append(
            TeacherActivityItem(
                type="announcement",
                title=f"Announced: {a.title}",
                subtitle=(a.body[:80] + "…") if a.body and len(a.body) > 80 else a.body,
                occurred_at=a.created_at,
                action_url=None,
            )
        )

    # 4) Student attempts on quizzes this teacher owns.
    teacher_quiz_ids = list(
        db.scalars(
            select(Quiz.id).where(Quiz.created_by_id == user.id)
        ).all()
    )
    if teacher_quiz_ids:
        attempt_rows = db.execute(
            select(QuizAttempt, Quiz, User)
            .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
            .join(User, User.id == QuizAttempt.student_id)
            .where(QuizAttempt.quiz_id.in_(teacher_quiz_ids))
            .order_by(QuizAttempt.completed_at.desc())
            .limit(5)
        ).all()
        for attempt, quiz, student in attempt_rows:
            items.append(
                TeacherActivityItem(
                    type="attempt_received",
                    title=f"{student.full_name} scored {float(attempt.score):.0f}% on “{quiz.title}”",
                    subtitle=None,
                    occurred_at=attempt.completed_at,
                    action_url="/teacher/quizzes",
                )
            )

    # Sort merged feed and trim. Python sort is stable, fine for ≤20 items.
    items.sort(key=lambda it: it.occurred_at, reverse=True)
    return items[:limit]


def _document_status_value(status_enum: DocumentStatus | str) -> str:
    return status_enum.value if isinstance(status_enum, DocumentStatus) else str(status_enum)


def get_teacher_dashboard(db: Session, user: User) -> TeacherDashboardResponse:
    if user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can view the teacher dashboard.",
        )

    teacher_profile = user.teacher_profile

    # All subjects this teacher owns.
    subject_ids = list(
        db.scalars(select(Subject.id).where(Subject.teacher_id == user.id)).all()
    )

    # Documents this teacher has uploaded.
    documents_count = (
        db.scalar(
            select(func.count(Document.id)).where(Document.uploaded_by_id == user.id)
        )
        or 0
    )

    # Quizzes this teacher created.
    quizzes_total = (
        db.scalar(select(func.count(Quiz.id)).where(Quiz.created_by_id == user.id))
        or 0
    )
    quizzes_published = (
        db.scalar(
            select(func.count(Quiz.id))
            .where(Quiz.created_by_id == user.id)
            .where(Quiz.is_published.is_(True))
        )
        or 0
    )

    # Distinct students who have attempted any of this teacher's quizzes.
    students_total = (
        db.scalar(
            select(func.count(func.distinct(QuizAttempt.student_id)))
            .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
            .where(Quiz.created_by_id == user.id)
        )
        or 0
    )

    # Class average across all attempts on this teacher's quizzes.
    avg_score = db.scalar(
        select(func.avg(QuizAttempt.score))
        .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
        .where(Quiz.created_by_id == user.id)
    )
    class_average = round(float(avg_score), 2) if avg_score is not None else None

    # Per-subject performance: group attempts on this teacher's quizzes by
    # subject, then average + count. Only subjects with attempts appear
    # (teachers don't want noise for subjects no one has touched yet).
    subject_rows = db.execute(
        select(
            Subject.id,
            Subject.code,
            Subject.name,
            func.count(QuizAttempt.id).label("attempts_count"),
            func.count(func.distinct(QuizAttempt.student_id)).label("students_count"),
            func.avg(QuizAttempt.score).label("avg_score"),
        )
        .join(Quiz, Quiz.subject_id == Subject.id)
        .join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
        .where(Quiz.created_by_id == user.id)
        .group_by(Subject.id, Subject.code, Subject.name)
        .order_by(func.avg(QuizAttempt.score).desc())
    ).all()
    class_performance_by_subject = [
        SubjectPerformanceRow(
            subject_id=row.id,
            subject_code=row.code,
            subject_name=row.name,
            attempts_count=int(row.attempts_count or 0),
            students_count=int(row.students_count or 0),
            avg_score=round(float(row.avg_score or 0), 2),
        )
        for row in subject_rows
    ]

    stats = [
        TeacherStat(label="TOTAL STUDENTS", value=str(students_total)),
        TeacherStat(label="DOCUMENTS", value=str(documents_count)),
        TeacherStat(label="QUIZZES PUBLISHED", value=str(quizzes_published)),
        TeacherStat(
            label="CLASS AVERAGE",
            value=f"{class_average:.0f}%" if class_average is not None else "—",
        ),
    ]

    # Most recent uploads (by this teacher).
    recent_doc_rows = (
        db.execute(
            select(Document, Subject)
            .join(Subject, Subject.id == Document.subject_id)
            .where(Document.uploaded_by_id == user.id)
            .order_by(Document.created_at.desc())
            .limit(8)
        ).all()
    )
    recent_uploads = [
        RecentUploadRow(
            id=doc.id,
            name=doc.file_name,
            subject_code=subject.code if subject else None,
            subject_name=subject.name if subject else None,
            created_at=doc.created_at,
            status=_document_status_value(doc.processing_status),  # type: ignore[arg-type]
        )
        for doc, subject in recent_doc_rows
    ]

    return TeacherDashboardResponse(
        teacher_id=user.id,
        full_name=user.full_name,
        department=teacher_profile.department_name if teacher_profile else None,
        stats=stats,
        recent_uploads=recent_uploads,
        recent_activity=_teacher_recent_activity(db, user, limit=15),
        class_average=class_average,
        class_performance_by_subject=class_performance_by_subject,
        students_total=int(students_total),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Admin dashboard
# ──────────────────────────────────────────────────────────────────────────────


def _format_relative_text(event: XPEvent | Document | Quiz | User) -> str:
    """Produce a one-line human-readable text for the platform activity feed."""
    if isinstance(event, Document):
        return f"{event.uploaded_by.full_name if event.uploaded_by else 'A teacher'} uploaded {event.file_name}"
    if isinstance(event, Quiz):
        return f"Quiz “{event.title}” {'published' if event.is_published else 'created'}"
    if isinstance(event, User):
        return f"New {event.role.value} registration: {event.full_name}"
    return event.event_type.value


def get_admin_dashboard(db: Session, user: User) -> AdminDashboardResponse:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view the admin dashboard.",
        )

    # Headline counts.
    total_users = db.scalar(select(func.count(User.id))) or 0
    one_day_ago = datetime.now(tz=timezone.utc) - timedelta(hours=24)
    active_today = (
        db.scalar(
            select(func.count(User.id)).where(User.last_login >= one_day_ago)
        )
        or 0
    )
    documents_count = db.scalar(select(func.count(Document.id))) or 0
    quizzes_count = db.scalar(select(func.count(Quiz.id))) or 0

    stats = [
        AdminStat(label="TOTAL USERS", value=f"{int(total_users):,}"),
        AdminStat(label="ACTIVE TODAY", value=str(int(active_today))),
        AdminStat(label="DOCUMENTS", value=str(int(documents_count))),
        AdminStat(label="QUIZZES", value=str(int(quizzes_count))),
    ]

    # Role breakdown.
    role_rows = db.execute(
        select(User.role, func.count(User.id)).group_by(User.role)
    ).all()
    role_counts: dict[str, int] = {role.value: 0 for role in UserRole}
    for role, count in role_rows:
        key = role.value if isinstance(role, UserRole) else str(role)
        role_counts[key] = int(count)
    user_breakdown = [
        UserBreakdownRow(role="student", count=role_counts.get("student", 0)),  # type: ignore[arg-type]
        UserBreakdownRow(role="teacher", count=role_counts.get("teacher", 0)),  # type: ignore[arg-type]
        UserBreakdownRow(role="admin", count=role_counts.get("admin", 0)),  # type: ignore[arg-type]
    ]

    # Recent platform activity — newest 5 from a few sources, merged & sorted.
    recent: list[tuple[datetime, str]] = []
    for doc in db.scalars(
        select(Document).order_by(Document.created_at.desc()).limit(5)
    ).all():
        recent.append((doc.created_at, _format_relative_text(doc)))
    for quiz in db.scalars(
        select(Quiz).order_by(Quiz.created_at.desc()).limit(5)
    ).all():
        recent.append((quiz.created_at, _format_relative_text(quiz)))
    for new_user in db.scalars(
        select(User).order_by(User.created_at.desc()).limit(5)
    ).all():
        recent.append((new_user.created_at, _format_relative_text(new_user)))

    recent.sort(key=lambda r: r[0], reverse=True)
    recent_activity = [
        PlatformActivityItem(text=text, created_at=ts) for ts, text in recent[:8]
    ]

    # Platform health — best-effort numbers; storage is a rough estimate of doc bytes.
    total_bytes = (
        db.scalar(select(func.coalesce(func.sum(Document.file_size_bytes), 0))) or 0
    )
    storage_used_gb = round(int(total_bytes) / (1024 * 1024 * 1024), 2)
    health = PlatformHealth(
        api_response_ms=120,
        storage_used_gb=storage_used_gb,
        storage_quota_gb=10.0,
        uptime_pct=99.9,
    )

    return AdminDashboardResponse(
        stats=stats,
        user_breakdown=user_breakdown,
        recent_activity=recent_activity,
        platform_health=health,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Admin user listing
# ──────────────────────────────────────────────────────────────────────────────


def list_users(
    db: Session,
    actor: User,
    *,
    role: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AdminUserListResponse:
    if actor.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can list platform users.",
        )

    stmt = (
        select(User, StudentProfile, TeacherProfile)
        .outerjoin(StudentProfile, StudentProfile.user_id == User.id)
        .outerjoin(TeacherProfile, TeacherProfile.user_id == User.id)
    )
    count_stmt = select(func.count(User.id))

    if role and role != "all":
        try:
            role_value = UserRole(role)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown role: {role}",
            ) from exc
        stmt = stmt.where(User.role == role_value)
        count_stmt = count_stmt.where(User.role == role_value)

    if search:
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(User.full_name).like(like) | func.lower(User.email).like(like)
        )
        count_stmt = count_stmt.where(
            func.lower(User.full_name).like(like) | func.lower(User.email).like(like)
        )

    total = int(db.scalar(count_stmt) or 0)
    rows = (
        db.execute(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset))
        .all()
    )

    items: list[AdminUserRow] = []
    for user_row, student_profile, teacher_profile in rows:
        items.append(
            AdminUserRow(
                id=user_row.id,
                email=user_row.email,
                full_name=user_row.full_name,
                role=user_row.role.value,  # type: ignore[arg-type]
                is_active=user_row.is_active,
                branch=student_profile.branch if student_profile else None,
                semester=student_profile.semester if student_profile else None,
                department=teacher_profile.department_name if teacher_profile else None,
                last_login=user_row.last_login,
                created_at=user_row.created_at,
            )
        )
    return AdminUserListResponse(total=total, items=items)


# ──────────────────────────────────────────────────────────────────────────────
# Per-student detail (teacher / admin)
# ──────────────────────────────────────────────────────────────────────────────


def get_student_detail(
    db: Session, actor: User, student_id: uuid.UUID
) -> StudentDetailResponse:
    if actor.role not in (UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers or admins can view student details.",
        )
    student = db.get(User, student_id)
    if student is None or student.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found.",
        )

    # Teachers can only see students who attempted their quizzes.
    if actor.role == UserRole.TEACHER:
        seen = db.scalar(
            select(func.count(QuizAttempt.id))
            .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
            .where(Quiz.created_by_id == actor.id)
            .where(QuizAttempt.student_id == student_id)
        )
        if not seen:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This student has not engaged with your quizzes yet.",
            )

    profile = student.student_profile

    # Recent quiz attempts on this student (latest 6).
    quiz_score_rows = (
        db.execute(
            select(QuizAttempt, Quiz)
            .join(Quiz, Quiz.id == QuizAttempt.quiz_id)
            .where(QuizAttempt.student_id == student_id)
            .order_by(QuizAttempt.completed_at.desc())
            .limit(6)
        ).all()
    )
    quiz_scores = [
        StudentQuizScore(
            quiz_id=quiz.id,
            label=quiz.title,
            value=float(attempt.score),
            completed_at=attempt.completed_at,
        )
        for attempt, quiz in quiz_score_rows
    ]

    # Weak areas — topics with <60% correctness across this student's attempts.
    weak_areas: list[str] = []
    topic_buckets: dict[str, dict[str, int]] = {}
    for attempt, _quiz in quiz_score_rows:
        if not attempt.answers:
            continue
        for ans in attempt.answers:
            topic = (ans.get("topic") or "").strip()
            if not topic:
                continue
            bucket = topic_buckets.setdefault(topic, {"correct": 0, "total": 0})
            bucket["total"] += 1
            if ans.get("is_correct"):
                bucket["correct"] += 1
    for topic, b in topic_buckets.items():
        if b["total"] >= 2 and (b["correct"] / b["total"]) * 100 < 60:
            weak_areas.append(topic)

    # Community contributions = answers posted by this student.
    community_contributions = (
        db.scalar(
            select(func.count(DoubtAnswer.id)).where(DoubtAnswer.answered_by_id == student_id)
        )
        or 0
    )

    return StudentDetailResponse(
        student_id=student.id,
        name=student.full_name,
        branch=profile.branch if profile else None,
        semester=profile.semester if profile else None,
        quiz_scores=quiz_scores,
        weak_areas=weak_areas[:8],
        xp_total=profile.xp_total if profile else 0,
        streak_days=profile.streak_days if profile else 0,
        community_contributions=int(community_contributions),
    )
