"""Quiz Engine endpoints — Phase 11, F3."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import CurrentUser, DbSession, require_role
from app.core.rate_limit import limiter
from app.models.quiz import Difficulty
from app.schemas.quiz import (
    AttemptHistoryRow,
    QuestionFlagCreate,
    QuestionFlagResponse,
    QuizAttemptCreate,
    QuizAttemptResponse,
    QuizForStudent,
    QuizForTeacher,
    QuizGenerateRequest,
    QuizResponse,
    QuizUpdate,
    WeakAreaResponse,
)
from app.services import quiz as quiz_service
from app.services import quiz_generator

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# Listing + retrieval
# ════════════════════════════════════════════════════════════════

@router.get(
    "/",
    response_model=list[QuizResponse],
    summary="List quizzes visible to the current user",
)
def list_quizzes(
    db: DbSession,
    current_user: CurrentUser,
    subject_id: uuid.UUID | None = None,
) -> list[QuizResponse]:
    return quiz_service.list_quizzes(db, current_user, subject_id=subject_id)


# Attempt-related routes MUST come before /{quiz_id} so the path doesn't swallow them.

@router.get(
    "/attempts/me",
    response_model=list[AttemptHistoryRow],
    summary="Student: my quiz attempt history",
)
def list_my_attempts(
    db: DbSession,
    current_user: CurrentUser,
    subject_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[AttemptHistoryRow]:
    return quiz_service.list_attempts_for_student(
        db, current_user, subject_id=subject_id, limit=limit
    )


@router.get(
    "/attempts/{attempt_id}",
    response_model=QuizAttemptResponse,
    summary="Get one past attempt for review (questions + correct answers + explanations)",
)
def get_attempt(
    attempt_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizAttemptResponse:
    return quiz_service.get_attempt_for_review(db, attempt_id, current_user)


@router.get(
    "/attempts/me/weak-areas",
    response_model=list[WeakAreaResponse],
    summary="Student: weak topic diagnostics (boolean threshold)",
)
def list_my_weak_areas(
    db: DbSession,
    current_user: CurrentUser,
) -> list[WeakAreaResponse]:
    return quiz_service.compute_weak_areas(db, current_user)


@router.get(
    "/{quiz_id}",
    summary="Get a quiz — students see student-view, teachers see full view",
)
def get_quiz(
    quiz_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
):
    if current_user.role.value == "student":
        return quiz_service.get_quiz_for_student(db, quiz_id, current_user)
    return quiz_service.get_quiz_for_teacher(db, quiz_id, current_user)


# ════════════════════════════════════════════════════════════════
# Generation + editing (teacher / admin)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/generate",
    response_model=QuizForTeacher,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="AI-generate a draft quiz from a subject document (Claude Haiku)",
)
@limiter.limit("10/hour")
def generate_quiz(
    request: Request,
    data: QuizGenerateRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizForTeacher:
    try:
        difficulty = Difficulty(data.difficulty)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid difficulty: {data.difficulty}") from e

    # Merge the legacy single document_id into the new document_ids list so
    # old clients keep working. None + None = use all docs in subject.
    merged_ids: list[uuid.UUID] | None = None
    if data.document_ids:
        merged_ids = list(data.document_ids)
    elif data.document_id is not None:
        merged_ids = [data.document_id]

    quiz = quiz_generator.generate_quiz(
        db,
        user=current_user,
        subject_id=data.subject_id,
        document_ids=merged_ids,
        num_questions=data.num_questions,
        difficulty=difficulty,
        topic_hint=data.topic_hint,
    )
    return quiz_service.get_quiz_for_teacher(db, quiz.id, current_user)


@router.patch(
    "/{quiz_id}",
    response_model=QuizForTeacher,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Edit a quiz (teacher) — title/description/publish state/questions",
)
def update_quiz(
    quiz_id: uuid.UUID,
    data: QuizUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizForTeacher:
    return quiz_service.update_quiz(db, quiz_id, data, current_user)


@router.post(
    "/{quiz_id}/publish",
    response_model=QuizForTeacher,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Publish or unpublish a quiz",
)
def toggle_publish(
    quiz_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    publish: bool = True,
) -> QuizForTeacher:
    return quiz_service.update_quiz(
        db, quiz_id, QuizUpdate(is_published=publish), current_user
    )


@router.delete(
    "/{quiz_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("teacher", "admin"))],
    summary="Delete a quiz",
)
def delete_quiz(
    quiz_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    quiz_service.delete_quiz(db, quiz_id, current_user)


# ════════════════════════════════════════════════════════════════
# Attempts
# ════════════════════════════════════════════════════════════════

@router.post(
    "/{quiz_id}/attempts",
    response_model=QuizAttemptResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Student: submit a quiz attempt and get graded feedback",
)
def submit_attempt(
    quiz_id: uuid.UUID,
    data: QuizAttemptCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> QuizAttemptResponse:
    return quiz_service.submit_attempt(
        db,
        quiz_id=quiz_id,
        user=current_user,
        answers=data.answers,
        time_taken_seconds=data.time_taken_seconds,
    )


# ════════════════════════════════════════════════════════════════
# Question flags (student-raised reports)
# ════════════════════════════════════════════════════════════════

@router.post(
    "/{quiz_id}/questions/{question_id}/flag",
    response_model=QuestionFlagResponse,
    summary="Student: flag a question as broken / ambiguous (or update the reason)",
)
def flag_question(
    quiz_id: uuid.UUID,
    question_id: uuid.UUID,
    data: QuestionFlagCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> QuestionFlagResponse:
    flag = quiz_service.upsert_question_flag(
        db,
        quiz_id=quiz_id,
        question_id=question_id,
        user=current_user,
        reason=data.reason,
    )
    return QuestionFlagResponse.model_validate(flag, from_attributes=True)


@router.delete(
    "/{quiz_id}/questions/{question_id}/flag",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Student: remove my flag on this question",
)
def unflag_question(
    quiz_id: uuid.UUID,
    question_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    quiz_service.delete_question_flag(
        db,
        quiz_id=quiz_id,
        question_id=question_id,
        user=current_user,
    )


@router.get(
    "/{quiz_id}/my-flags",
    response_model=list[QuestionFlagResponse],
    summary="Student: list all questions in this quiz I've flagged (to color icons on load)",
)
def list_my_flags(
    quiz_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> list[QuestionFlagResponse]:
    flags = quiz_service.list_my_flags_for_quiz(
        db, quiz_id=quiz_id, user=current_user
    )
    return [QuestionFlagResponse.model_validate(f, from_attributes=True) for f in flags]
