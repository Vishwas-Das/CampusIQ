"""Coding-practice endpoints (V1).

Surfaces 5 endpoints under /coding:
- GET    /coding/problems              — list with filters + per-user status
- GET    /coding/problems/{slug}       — detail (no hidden tests, no solution
                                          unless solved)
- GET    /coding/problems/{slug}/runner — visible + hidden test cases for the
                                          client-side runner
- POST   /coding/problems/{slug}/submit — record a submission (and on first AC,
                                          bump mastery + award XP)
- GET    /coding/problems/{slug}/submissions — user's history for this problem
- GET    /coding/stats                 — overview banner data

All routes are student-only via `require_role`. Pyodide runs in the browser,
so the runner endpoint exposes hidden test cases — this is a documented V1
limitation (V4's Judge0 path recovers real server-side secrecy).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.api.deps import CurrentUser, DbSession, require_role
from app.models.coding import (
    CodingDifficulty,
    CodingLanguage,
    CodingSubmissionStatus,
)
from app.schemas.coding import (
    CodingDifficultyLiteral,
    CodingStatsResponse,
    MarkSolvedResponse,
    ProblemDetail,
    ProblemListItem,
    ProblemRunnerPayload,
    SubmissionResponse,
    SubmitRequest,
    SubmitResultResponse,
    UserProblemStatus,
)
from app.services import coding as coding_service

router = APIRouter(dependencies=[Depends(require_role("student"))])


# ──────────────────────────────────────────────────────────────────
# List + stats
# ──────────────────────────────────────────────────────────────────


@router.get(
    "/problems",
    response_model=list[ProblemListItem],
    summary="List coding problems (with optional filters)",
)
def list_problems(
    db: DbSession,
    current_user: CurrentUser,
    difficulty: CodingDifficultyLiteral | None = None,
    topic: str | None = None,
    user_status: UserProblemStatus | None = None,
) -> list[ProblemListItem]:
    diff_enum = CodingDifficulty(difficulty) if difficulty is not None else None
    rows = coding_service.list_problems(
        db,
        current_user,
        difficulty=diff_enum,
        topic=topic,
        user_status_filter=user_status,
    )
    return [ProblemListItem(**row) for row in rows]


@router.get(
    "/stats",
    response_model=CodingStatsResponse,
    summary="Aggregate stats for the current user (problem counts + streak)",
)
def get_stats(db: DbSession, current_user: CurrentUser) -> CodingStatsResponse:
    return CodingStatsResponse(**coding_service.get_stats(db, current_user))


# ──────────────────────────────────────────────────────────────────
# One-problem endpoints
# ──────────────────────────────────────────────────────────────────


@router.get(
    "/problems/{slug}",
    response_model=ProblemDetail,
    summary="Get a problem (description, examples, hints, starter, visible tests)",
)
def get_problem(slug: str, db: DbSession, current_user: CurrentUser) -> ProblemDetail:
    return ProblemDetail(**coding_service.get_problem(db, current_user, slug))


@router.get(
    "/problems/{slug}/runner",
    response_model=ProblemRunnerPayload,
    summary="Get all test cases (visible + hidden) for client-side execution",
)
def get_runner(slug: str, db: DbSession, _current_user: CurrentUser) -> ProblemRunnerPayload:
    return ProblemRunnerPayload(**coding_service.get_runner_payload(db, slug))


@router.post(
    "/problems/{slug}/submit",
    response_model=SubmitResultResponse,
    summary="Record a submission attempt — bumps mastery + XP on first AC",
)
def submit(
    slug: str,
    payload: SubmitRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> SubmitResultResponse:
    # Defensive: passed_count <= total_count
    if payload.passed_count > payload.total_count:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="passed_count cannot exceed total_count",
        )

    result = coding_service.submit(
        db,
        current_user,
        slug=slug,
        language=CodingLanguage(payload.language),
        code=payload.code,
        submission_status=CodingSubmissionStatus(payload.status),
        passed_count=payload.passed_count,
        total_count=payload.total_count,
        runtime_ms=payload.runtime_ms,
        error_message=payload.error_message,
    )

    submission = result["submission"]
    return SubmitResultResponse(
        submission=SubmissionResponse.model_validate(submission),
        first_solve=result["first_solve"],
        xp_earned=result["xp_earned"],
        new_level=result["new_level"],
        leveled_up=result["leveled_up"],
    )


@router.post(
    "/problems/{slug}/mark-solved",
    response_model=MarkSolvedResponse,
    summary="Self-report that you solved this on LeetCode — awards XP + mastery on first solve",
)
def mark_solved(
    slug: str, db: DbSession, current_user: CurrentUser
) -> MarkSolvedResponse:
    return MarkSolvedResponse(**coding_service.mark_solved(db, current_user, slug=slug))


@router.get(
    "/problems/{slug}/submissions",
    response_model=list[SubmissionResponse],
    summary="List the current user's submissions for a problem (newest first)",
)
def list_my_submissions(
    slug: str, db: DbSession, current_user: CurrentUser
) -> list[SubmissionResponse]:
    rows = coding_service.list_submissions(db, current_user, slug)
    return [SubmissionResponse.model_validate(r) for r in rows]
