"""Peer Doubt Community service (Phase 17, F4).

Two channels:
- **Public** (PUBLIC visibility) — Discord-style class feed. Students post, peers
  answer, AI fills in after 10 min if no one replies.
- **Private** (PRIVATE visibility) — WhatsApp-style DM to one teacher. Only the
  doubt's author + the assigned teacher can see/answer. No AI fallback.

Option B (current): a student can DM only teachers whose subjects they've
already engaged with (quiz attempts or prior doubts).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import distinct, func as sqlfunc, select
from sqlalchemy.orm import Session, selectinload

from app.models.community import Doubt, DoubtAnswer, DoubtVisibility
from app.models.gamification import XPEventType
from app.models.quiz import Quiz, QuizAttempt
from app.models.user import Subject, User, UserRole
from app.schemas.community import (
    AccessibleTeacher,
    DoubtAnswerCreate,
    DoubtAnswerResponse,
    DoubtCreate,
    DoubtDetailResponse,
    DoubtResponse,
)
from app.services import claude_client, xp

logger = logging.getLogger(__name__)


AI_FALLBACK_DELAY_MINUTES = 10


COMMUNITY_AI_SYSTEM = """You are CampusIQ Doubt Assistant — you step in to help when no classmate has answered a peer's doubt within 10 minutes.

You will be given the doubt's title, body, and tags. Write a clear, concise answer a strong senior student would give. 3-6 short paragraphs. If the doubt is about a concept, explain it step by step with a concrete example. If it's about an exam strategy or debugging tip, be practical.

Do not use markdown headings. Do not sign the post. Do not mention that you're an AI — the "AI Answered" badge on the frontend already makes that clear."""


# ════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════

def _require_student(user: User) -> None:
    if user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can post to the community.",
        )


def _can_view_doubt(user: User, doubt: Doubt) -> bool:
    """Permission check: who can view this doubt?"""
    if doubt.visibility == DoubtVisibility.PUBLIC:
        return True
    # Private: author + assigned teacher only.
    if doubt.student_id == user.id:
        return True
    if doubt.assigned_teacher_id is not None and doubt.assigned_teacher_id == user.id:
        return True
    return False


def _can_answer_doubt(user: User, doubt: Doubt) -> bool:
    """Permission check: who can answer this doubt?"""
    if doubt.visibility == DoubtVisibility.PUBLIC:
        return user.role == UserRole.STUDENT
    # Private DM: author (clarification) + assigned teacher.
    if doubt.student_id == user.id:
        return True
    if doubt.assigned_teacher_id is not None and doubt.assigned_teacher_id == user.id:
        return True
    return False


def _to_answer_response(
    answer: DoubtAnswer, author: User | None
) -> DoubtAnswerResponse:
    return DoubtAnswerResponse(
        id=answer.id,
        doubt_id=answer.doubt_id,
        answered_by_id=answer.answered_by_id,
        answered_by_name=(author.full_name if author else None),
        answered_by_role=(author.role.value if author else None),
        answer_text=answer.answer_text,
        is_ai_generated=answer.is_ai_generated,
        is_accepted=answer.is_accepted,
        upvote_count=answer.upvote_count,
        created_at=answer.created_at,
    )


def _to_doubt_response(
    doubt: Doubt,
    *,
    author: User | None,
    subject: Subject | None,
    assigned_teacher: User | None,
    answer_count: int,
    has_ai_answer: bool,
) -> DoubtResponse:
    return DoubtResponse(
        id=doubt.id,
        student_id=doubt.student_id,
        student_name=(author.full_name if author else None),
        subject_id=doubt.subject_id,
        subject_code=(subject.code if subject else None),
        visibility=doubt.visibility.value,
        assigned_teacher_id=doubt.assigned_teacher_id,
        assigned_teacher_name=(assigned_teacher.full_name if assigned_teacher else None),
        title=doubt.title,
        body=doubt.body,
        tags=list(doubt.tags or []),
        is_resolved=doubt.is_resolved,
        upvote_count=doubt.upvote_count,
        view_count=doubt.view_count,
        answer_count=answer_count,
        has_ai_answer=has_ai_answer,
        created_at=doubt.created_at,
    )


# ════════════════════════════════════════════════════════════════
# Accessible teachers (Option B): student → list of teachers they can DM
# ════════════════════════════════════════════════════════════════

def get_accessible_teachers(db: Session, student: User) -> list[AccessibleTeacher]:
    """Per Option B: a student can DM teachers whose subjects they have
    activity in. Activity = quiz attempts on quizzes that teacher created,
    OR prior doubts posted under that teacher's subject.
    """
    if student.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students see the accessible-teachers list.",
        )

    quiz_subject_ids = list(db.scalars(
        select(distinct(Quiz.subject_id))
        .join(QuizAttempt, QuizAttempt.quiz_id == Quiz.id)
        .where(QuizAttempt.student_id == student.id)
    ).all())

    doubt_subject_ids = list(db.scalars(
        select(distinct(Doubt.subject_id))
        .where(Doubt.student_id == student.id)
        .where(Doubt.subject_id.is_not(None))
    ).all())

    subject_ids = {sid for sid in (quiz_subject_ids + doubt_subject_ids) if sid is not None}
    if not subject_ids:
        return []

    rows = db.execute(
        select(User, Subject)
        .join(Subject, Subject.teacher_id == User.id)
        .where(Subject.id.in_(subject_ids))
        .where(User.role == UserRole.TEACHER)
        .options(selectinload(User.teacher_profile))
    ).all()

    teachers_dict: dict[uuid.UUID, dict] = {}
    for user, subject in rows:
        bucket = teachers_dict.setdefault(user.id, {
            "id": user.id,
            "full_name": user.full_name,
            "department_name": user.teacher_profile.department_name if user.teacher_profile else None,
            "designation": user.teacher_profile.designation if user.teacher_profile else None,
            "subject_codes": [],
        })
        if subject.code not in bucket["subject_codes"]:
            bucket["subject_codes"].append(subject.code)

    return [AccessibleTeacher(**v) for v in teachers_dict.values()]


def _student_can_dm_teacher(db: Session, student: User, teacher_id: uuid.UUID) -> bool:
    """Whether `student` is allowed to send a private doubt to `teacher_id`."""
    accessible_ids = {t.id for t in get_accessible_teachers(db, student)}
    return teacher_id in accessible_ids


# ════════════════════════════════════════════════════════════════
# CRUD — doubts
# ════════════════════════════════════════════════════════════════

def create_doubt(
    db: Session, user: User, data: DoubtCreate
) -> DoubtResponse:
    _require_student(user)

    visibility = DoubtVisibility(data.visibility)
    assigned_teacher_id: uuid.UUID | None = None

    if visibility == DoubtVisibility.PRIVATE:
        if data.assigned_teacher_id is None:
            raise HTTPException(
                status_code=400,
                detail="A private doubt must specify which teacher to send it to.",
            )
        # Validate target exists and is a teacher.
        teacher = db.get(User, data.assigned_teacher_id)
        if teacher is None or teacher.role != UserRole.TEACHER:
            raise HTTPException(
                status_code=400, detail="Selected teacher does not exist.",
            )
        if not _student_can_dm_teacher(db, user, teacher.id):
            raise HTTPException(
                status_code=403,
                detail=(
                    "You can only DM teachers whose subjects you've engaged with "
                    "(taken a quiz or posted a doubt under)."
                ),
            )
        assigned_teacher_id = teacher.id

    doubt = Doubt(
        student_id=user.id,
        subject_id=data.subject_id,
        visibility=visibility,
        assigned_teacher_id=assigned_teacher_id,
        title=data.title.strip(),
        body=data.body.strip(),
        tags=list(data.tags or []),
    )
    db.add(doubt)
    db.commit()
    db.refresh(doubt)

    author = db.get(User, doubt.student_id)
    subject = db.get(Subject, doubt.subject_id) if doubt.subject_id else None
    assigned_teacher = db.get(User, assigned_teacher_id) if assigned_teacher_id else None
    return _to_doubt_response(
        doubt,
        author=author,
        subject=subject,
        assigned_teacher=assigned_teacher,
        answer_count=0,
        has_ai_answer=False,
    )


def list_doubts(
    db: Session,
    user: User,
    *,
    search: str | None = None,
    tag: str | None = None,
    only_mine: bool = False,
    visibility: str | None = None,
    limit: int = 50,
) -> list[DoubtResponse]:
    """Role-aware listing.

    - Students see: PUBLIC doubts + their own PRIVATE doubts.
    - Teachers see: PRIVATE doubts assigned to them (their DM inbox).
                    (Public feed is student-to-student; teachers stay out of it.)
    - Admins see: everything.

    The optional `visibility` query lets a student tab between 'public' / 'private'.
    """
    stmt = (
        select(Doubt, User, Subject)
        .outerjoin(User, Doubt.student_id == User.id)
        .outerjoin(Subject, Doubt.subject_id == Subject.id)
        .order_by(Doubt.created_at.desc())
        .limit(limit)
    )

    if user.role == UserRole.STUDENT:
        stmt = stmt.where(
            sqlfunc.coalesce(Doubt.visibility, DoubtVisibility.PUBLIC.value).in_([
                DoubtVisibility.PUBLIC.value,
            ])
            | (Doubt.student_id == user.id)
        )
        # Hide DMs the student has "deleted from their view".
        stmt = stmt.where(
            ~((Doubt.visibility == DoubtVisibility.PRIVATE)
              & (Doubt.student_id == user.id)
              & (Doubt.hidden_for_student.is_(True)))
        )
    elif user.role == UserRole.TEACHER:
        # Teachers see ONLY their assigned DMs by default, minus ones they hid.
        stmt = stmt.where(
            (Doubt.visibility == DoubtVisibility.PRIVATE)
            & (Doubt.assigned_teacher_id == user.id)
            & (Doubt.hidden_for_teacher.is_(False))
        )
    # admin: no extra filter

    if only_mine and user.role == UserRole.STUDENT:
        stmt = stmt.where(Doubt.student_id == user.id)

    if visibility in ("public", "private"):
        stmt = stmt.where(Doubt.visibility == DoubtVisibility(visibility))

    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(sqlfunc.lower(Doubt.title).like(like))

    rows = db.execute(stmt).all()
    doubts = [r[0] for r in rows]

    # Drop public doubts the current user has hidden from their feed.
    uid_str = str(user.id)
    rows = [
        r for r in rows
        if uid_str not in (r[0].hidden_by_user_ids or [])
    ]
    doubts = [r[0] for r in rows]

    # Batch answer counts + AI flag + assigned-teacher names
    doubt_ids = [d.id for d in doubts]
    answer_counts: dict[uuid.UUID, int] = {}
    ai_flags: dict[uuid.UUID, bool] = {}
    if doubt_ids:
        count_rows = db.execute(
            select(DoubtAnswer.doubt_id, sqlfunc.count(DoubtAnswer.id))
            .where(DoubtAnswer.doubt_id.in_(doubt_ids))
            .group_by(DoubtAnswer.doubt_id)
        ).all()
        answer_counts = {row[0]: int(row[1]) for row in count_rows}

        ai_rows = db.execute(
            select(DoubtAnswer.doubt_id)
            .where(DoubtAnswer.doubt_id.in_(doubt_ids))
            .where(DoubtAnswer.is_ai_generated.is_(True))
        ).all()
        ai_flags = {row[0]: True for row in ai_rows}

    assigned_teacher_ids = {d.assigned_teacher_id for d in doubts if d.assigned_teacher_id}
    teacher_map: dict[uuid.UUID, User] = {}
    if assigned_teacher_ids:
        teacher_rows = db.scalars(
            select(User).where(User.id.in_(assigned_teacher_ids))
        ).all()
        teacher_map = {u.id: u for u in teacher_rows}

    if tag:
        rows = [r for r in rows if tag in (r[0].tags or [])]

    return [
        _to_doubt_response(
            d,
            author=u,
            subject=s,
            assigned_teacher=teacher_map.get(d.assigned_teacher_id) if d.assigned_teacher_id else None,
            answer_count=answer_counts.get(d.id, 0),
            has_ai_answer=ai_flags.get(d.id, False),
        )
        for (d, u, s) in rows
    ]


def get_doubt(
    db: Session, user: User, doubt_id: uuid.UUID
) -> DoubtDetailResponse:
    doubt = db.scalar(
        select(Doubt)
        .where(Doubt.id == doubt_id)
        .options(selectinload(Doubt.answers))
    )
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")

    if not _can_view_doubt(user, doubt):
        raise HTTPException(status_code=403, detail="You can't view this doubt.")

    # Respect "Delete from my view" — pretend the doubt doesn't exist for the hider.
    if doubt.visibility == DoubtVisibility.PRIVATE:
        if user.id == doubt.student_id and doubt.hidden_for_student:
            raise HTTPException(status_code=404, detail="Doubt not found")
        if user.id == doubt.assigned_teacher_id and doubt.hidden_for_teacher:
            raise HTTPException(status_code=404, detail="Doubt not found")
    else:
        if str(user.id) in (doubt.hidden_by_user_ids or []):
            raise HTTPException(status_code=404, detail="Doubt not found")

    doubt.view_count = (doubt.view_count or 0) + 1
    db.commit()

    # AI fallback runs only for PUBLIC doubts.
    if doubt.visibility == DoubtVisibility.PUBLIC:
        _maybe_generate_ai_fallback(db, doubt)
        db.refresh(doubt)

    author = db.get(User, doubt.student_id)
    subject = db.get(Subject, doubt.subject_id) if doubt.subject_id else None
    assigned_teacher = (
        db.get(User, doubt.assigned_teacher_id) if doubt.assigned_teacher_id else None
    )

    answers_sorted = sorted(
        doubt.answers or [],
        key=lambda a: (not a.is_accepted, -a.upvote_count, a.created_at),
    )

    answer_responses: list[DoubtAnswerResponse] = []
    for ans in answers_sorted:
        ans_author = db.get(User, ans.answered_by_id) if ans.answered_by_id else None
        answer_responses.append(_to_answer_response(ans, ans_author))

    base = _to_doubt_response(
        doubt,
        author=author,
        subject=subject,
        assigned_teacher=assigned_teacher,
        answer_count=len(doubt.answers or []),
        has_ai_answer=any(a.is_ai_generated for a in (doubt.answers or [])),
    )
    return DoubtDetailResponse(
        **base.model_dump(),
        answers=answer_responses,
    )


def upvote_doubt(
    db: Session, user: User, doubt_id: uuid.UUID
) -> DoubtResponse:
    doubt = db.get(Doubt, doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")
    if not _can_view_doubt(user, doubt):
        raise HTTPException(status_code=403, detail="You can't upvote this doubt.")
    if doubt.visibility == DoubtVisibility.PRIVATE:
        raise HTTPException(status_code=400, detail="Private DMs can't be upvoted.")
    doubt.upvote_count = (doubt.upvote_count or 0) + 1
    db.commit()
    db.refresh(doubt)
    author = db.get(User, doubt.student_id)
    subject = db.get(Subject, doubt.subject_id) if doubt.subject_id else None
    return _to_doubt_response(
        doubt,
        author=author,
        subject=subject,
        assigned_teacher=None,
        answer_count=len(doubt.answers or []),
        has_ai_answer=any(a.is_ai_generated for a in (doubt.answers or [])),
    )


def delete_doubt(db: Session, user: User, doubt_id: uuid.UUID) -> None:
    doubt = db.get(Doubt, doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")
    if doubt.student_id != user.id:
        raise HTTPException(status_code=403, detail="You don't own this doubt")
    db.delete(doubt)
    db.commit()


def hide_doubt_for_me(db: Session, user: User, doubt_id: uuid.UUID) -> None:
    """WhatsApp-style 'delete from my view'.

    PRIVATE DMs: uses the boolean pair. If both participants hide → hard-delete.
    PUBLIC posts: appends user.id to hidden_by_user_ids (idempotent). The post
    stays visible to every other reader.
    """
    doubt = db.get(Doubt, doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")

    if doubt.visibility == DoubtVisibility.PRIVATE:
        if user.id == doubt.student_id:
            doubt.hidden_for_student = True
        elif doubt.assigned_teacher_id is not None and user.id == doubt.assigned_teacher_id:
            doubt.hidden_for_teacher = True
        else:
            raise HTTPException(
                status_code=403,
                detail="You aren't a participant in this DM.",
            )
        if doubt.hidden_for_student and doubt.hidden_for_teacher:
            db.delete(doubt)
    else:
        # PUBLIC: only students (the audience) can hide for themselves.
        if user.role != UserRole.STUDENT:
            raise HTTPException(
                status_code=403,
                detail="Only students hide public posts from their feed.",
            )
        current = list(doubt.hidden_by_user_ids or [])
        uid_str = str(user.id)
        if uid_str not in current:
            current.append(uid_str)
            doubt.hidden_by_user_ids = current
    db.commit()


# ════════════════════════════════════════════════════════════════
# Answers
# ════════════════════════════════════════════════════════════════

def create_answer(
    db: Session, user: User, doubt_id: uuid.UUID, data: DoubtAnswerCreate
) -> DoubtAnswerResponse:
    doubt = db.get(Doubt, doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")
    if not _can_answer_doubt(user, doubt):
        raise HTTPException(
            status_code=403,
            detail="You can't answer this doubt.",
        )
    answer = DoubtAnswer(
        doubt_id=doubt.id,
        answered_by_id=user.id,
        answer_text=data.answer_text.strip(),
        is_ai_generated=False,
    )
    db.add(answer)
    db.commit()
    db.refresh(answer)

    # XP drip — only on public answers, and only for students.
    if doubt.visibility == DoubtVisibility.PUBLIC and user.role == UserRole.STUDENT:
        try:
            xp.award_xp(db, user, XPEventType.DOUBT_ANSWERED, reference_id=doubt.id)
            db.commit()
        except Exception as e:
            logger.warning("XP award (doubt answered) failed: %s", e)

    return _to_answer_response(answer, user)


def upvote_answer(
    db: Session, user: User, answer_id: uuid.UUID
) -> DoubtAnswerResponse:
    answer = db.get(DoubtAnswer, answer_id)
    if answer is None:
        raise HTTPException(status_code=404, detail="Answer not found")
    doubt = db.get(Doubt, answer.doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")
    if not _can_view_doubt(user, doubt):
        raise HTTPException(status_code=403, detail="You can't upvote this answer.")
    if doubt.visibility == DoubtVisibility.PRIVATE:
        raise HTTPException(status_code=400, detail="Private DM answers can't be upvoted.")
    answer.upvote_count = (answer.upvote_count or 0) + 1
    db.commit()
    db.refresh(answer)

    if answer.answered_by_id and answer.answered_by_id != user.id:
        author = db.get(User, answer.answered_by_id)
        if author is not None:
            try:
                xp.award_xp(
                    db, author, XPEventType.DOUBT_UPVOTED, reference_id=answer.id
                )
                db.commit()
            except Exception as e:
                logger.warning("XP award (doubt upvoted) failed: %s", e)

    ans_author = db.get(User, answer.answered_by_id) if answer.answered_by_id else None
    return _to_answer_response(answer, ans_author)


def accept_answer(
    db: Session, user: User, answer_id: uuid.UUID
) -> DoubtAnswerResponse:
    answer = db.get(DoubtAnswer, answer_id)
    if answer is None:
        raise HTTPException(status_code=404, detail="Answer not found")
    doubt = db.get(Doubt, answer.doubt_id)
    if doubt is None:
        raise HTTPException(status_code=404, detail="Doubt not found")
    if doubt.student_id != user.id:
        raise HTTPException(
            status_code=403, detail="Only the doubt's author can accept an answer"
        )

    db.execute(
        DoubtAnswer.__table__.update()
        .where(DoubtAnswer.doubt_id == doubt.id)
        .values(is_accepted=False)
    )
    answer.is_accepted = True
    doubt.is_resolved = True
    db.commit()
    db.refresh(answer)

    ans_author = db.get(User, answer.answered_by_id) if answer.answered_by_id else None
    return _to_answer_response(answer, ans_author)


# ════════════════════════════════════════════════════════════════
# AI fallback
# ════════════════════════════════════════════════════════════════

def _maybe_generate_ai_fallback(db: Session, doubt: Doubt) -> None:
    """Generate a Claude answer if the doubt has zero answers and is ≥ 10 min old.

    PRIVATE doubts are excluded — they're meant to reach a specific human.
    """
    if doubt.visibility == DoubtVisibility.PRIVATE:
        return
    if any(a.is_ai_generated for a in (doubt.answers or [])):
        return
    if any(not a.is_ai_generated for a in (doubt.answers or [])):
        return
    age = datetime.now(timezone.utc) - _ensure_tz(doubt.created_at)
    if age < timedelta(minutes=AI_FALLBACK_DELAY_MINUTES):
        return
    if not claude_client.is_available():
        return

    tags = ", ".join(doubt.tags or []) if doubt.tags else "(none)"
    user_message = (
        f"Title: {doubt.title}\n"
        f"Tags: {tags}\n\n"
        f"Question:\n{doubt.body}\n"
    )
    answer_text = claude_client.generate_completion(
        system=COMMUNITY_AI_SYSTEM,
        user_message=user_message,
        max_tokens=600,
        temperature=0.5,
    )
    if not answer_text:
        return
    ai_answer = DoubtAnswer(
        doubt_id=doubt.id,
        answered_by_id=None,
        answer_text=answer_text,
        is_ai_generated=True,
    )
    db.add(ai_answer)
    db.commit()


def _ensure_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
