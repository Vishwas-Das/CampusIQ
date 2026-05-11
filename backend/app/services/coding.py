"""Coding-practice service — list/get/submit + stats.

Most of the meat is in `submit()`, which records every attempt and — only on
the user's **first** Accepted submission for a given problem — bumps skill
mastery and emits a CODING_PROBLEM_SOLVED XP event. Repeat ACs still record
the submission for history but don't double-count.
"""
from __future__ import annotations

import logging
import uuid
from typing import Literal

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.coding import (
    CodingDifficulty,
    CodingLanguage,
    CodingProblem,
    CodingSubmission,
    CodingSubmissionStatus,
)
from app.models.gamification import XPEventType
from app.models.user import User
from app.services import coding_skill_mastery
from app.services import coding_problems_seed
from app.services import xp as xp_service

logger = logging.getLogger(__name__)

UserProblemStatus = Literal["solved", "attempted", "unsolved"]


# ──────────────────────────────────────────────────────────────────
# List + per-user status
# ──────────────────────────────────────────────────────────────────


def _per_user_statuses(db: Session, user: User) -> dict[uuid.UUID, UserProblemStatus]:
    """Map of problem_id → per-user solved/attempted/unsolved.

    A user is `solved` for a problem if any of their submissions has status=PASSED;
    otherwise `attempted` if any submission exists at all; otherwise `unsolved`.
    """
    rows = db.execute(
        select(
            CodingSubmission.problem_id,
            func.max(
                # 'passed' > 'failed' > 'error' lexicographically, but we want
                # "any passed" to dominate. Compute as a boolean aggregate.
                CodingSubmission.status == CodingSubmissionStatus.PASSED
            ),
        )
        .where(CodingSubmission.user_id == user.id)
        .group_by(CodingSubmission.problem_id)
    ).all()
    out: dict[uuid.UUID, UserProblemStatus] = {}
    for problem_id, any_passed in rows:
        out[problem_id] = "solved" if any_passed else "attempted"
    return out


def list_problems(
    db: Session,
    user: User,
    *,
    difficulty: CodingDifficulty | None = None,
    topic: str | None = None,
    user_status_filter: UserProblemStatus | None = None,
) -> list[dict]:
    """Return list rows, applying filters. Seeds problems on first read."""
    # Lazy seed — same pattern as skill_graph.seed_if_empty.
    coding_problems_seed.seed_if_empty(db)

    stmt = select(CodingProblem).order_by(CodingProblem.difficulty, CodingProblem.title)
    if difficulty is not None:
        stmt = stmt.where(CodingProblem.difficulty == difficulty)

    problems = list(db.scalars(stmt).all())

    # Topic filter happens in Python — topic_tags is a JSON array, awkward to
    # filter cross-dialect at the SQL level. List is small (<100 problems for V5
    # target) so this is fine.
    if topic:
        topic_lower = topic.lower()
        problems = [
            p
            for p in problems
            if any(t.lower() == topic_lower for t in (p.topic_tags or []))
        ]

    statuses = _per_user_statuses(db, user)

    out: list[dict] = []
    for p in problems:
        user_status: UserProblemStatus = statuses.get(p.id, "unsolved")
        if user_status_filter and user_status != user_status_filter:
            continue
        out.append(
            {
                "id": p.id,
                "slug": p.slug,
                "title": p.title,
                "difficulty": p.difficulty.value,
                "topic_tags": p.topic_tags or [],
                "user_status": user_status,
            }
        )
    return out


# ──────────────────────────────────────────────────────────────────
# Get one
# ──────────────────────────────────────────────────────────────────


def _get_by_slug_or_404(db: Session, slug: str) -> CodingProblem:
    problem = db.scalar(select(CodingProblem).where(CodingProblem.slug == slug))
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found")
    return problem


def _has_accepted(db: Session, user: User, problem_id: uuid.UUID) -> bool:
    found = db.scalar(
        select(CodingSubmission.id)
        .where(CodingSubmission.user_id == user.id)
        .where(CodingSubmission.problem_id == problem_id)
        .where(CodingSubmission.status == CodingSubmissionStatus.PASSED)
        .limit(1)
    )
    return found is not None


def get_problem(db: Session, user: User, slug: str) -> dict:
    """Detail view. Excludes hidden test cases and reference solution unless
    the user has already AC'd the problem."""
    problem = _get_by_slug_or_404(db, slug)
    accepted = _has_accepted(db, user, problem.id)
    statuses = _per_user_statuses(db, user)
    user_status: UserProblemStatus = statuses.get(problem.id, "unsolved")

    return {
        "id": problem.id,
        "slug": problem.slug,
        "title": problem.title,
        "description": problem.description,
        "difficulty": problem.difficulty.value,
        "function_name": problem.function_name,
        "function_signature": problem.function_signature or {},
        "examples": problem.examples or [],
        "hints": problem.hints or [],
        "starter_code": problem.starter_code or {},
        "reference_solution": (problem.reference_solution or {}) if accepted else None,
        "visible_test_cases": problem.visible_test_cases or [],
        "comparator": problem.comparator,
        "topic_tags": problem.topic_tags or [],
        "skill_node_names": problem.skill_node_names or [],
        "user_status": user_status,
    }


def get_runner_payload(db: Session, slug: str) -> dict:
    """Returns visible + hidden test cases. Used by the client to execute
    Submit. Caller must be authed (route enforces); we don't gate per-problem
    further because all problems are public to students."""
    problem = _get_by_slug_or_404(db, slug)
    return {
        "function_name": problem.function_name,
        "visible_test_cases": problem.visible_test_cases or [],
        "hidden_test_cases": problem.hidden_test_cases or [],
        "comparator": problem.comparator,
    }


# ──────────────────────────────────────────────────────────────────
# Submit
# ──────────────────────────────────────────────────────────────────


def submit(
    db: Session,
    user: User,
    *,
    slug: str,
    language: CodingLanguage,
    code: str,
    submission_status: CodingSubmissionStatus,
    passed_count: int,
    total_count: int,
    runtime_ms: int | None,
    error_message: str | None,
) -> dict:
    """Record a submission. On first Accepted submission, bump skill mastery
    and award the CODING_PROBLEM_SOLVED XP event.

    Returns a dict shaped for `SubmitResultResponse`.
    """
    problem = _get_by_slug_or_404(db, slug)

    # Was the user solved BEFORE this attempt?
    already_solved = _has_accepted(db, user, problem.id)

    submission = CodingSubmission(
        user_id=user.id,
        problem_id=problem.id,
        language=language,
        code=code,
        status=submission_status,
        passed_count=passed_count,
        total_count=total_count,
        runtime_ms=runtime_ms,
        error_message=error_message,
    )
    db.add(submission)
    db.flush()  # so submission.id is populated

    first_solve = False
    xp_earned = 0
    new_level: int | None = None
    leveled_up = False

    if submission_status == CodingSubmissionStatus.PASSED and not already_solved:
        first_solve = True
        coding_skill_mastery.bump_mastery_for_solve(db, user, problem)
        awarded = xp_service.award_xp(
            db,
            user,
            XPEventType.CODING_PROBLEM_SOLVED,
            reference_id=submission.id,
        )
        xp_earned = awarded.event.xp_earned
        new_level = awarded.new_level
        leveled_up = awarded.leveled_up

    db.commit()
    db.refresh(submission)

    return {
        "submission": submission,
        "first_solve": first_solve,
        "xp_earned": xp_earned,
        "new_level": new_level,
        "leveled_up": leveled_up,
    }


def list_submissions(db: Session, user: User, slug: str) -> list[CodingSubmission]:
    problem = _get_by_slug_or_404(db, slug)
    return list(
        db.scalars(
            select(CodingSubmission)
            .where(CodingSubmission.user_id == user.id)
            .where(CodingSubmission.problem_id == problem.id)
            .order_by(CodingSubmission.submitted_at.desc())
        ).all()
    )


# ──────────────────────────────────────────────────────────────────
# Stats
# ──────────────────────────────────────────────────────────────────


def get_stats(db: Session, user: User) -> dict:
    """Aggregate stats for /coding/stats — used by the list page banner."""
    coding_problems_seed.seed_if_empty(db)

    # Total problems available (after seed).
    total_problems = db.scalar(select(func.count(CodingProblem.id))) or 0

    # How many distinct problems the user has solved, broken down by difficulty.
    solved_rows = db.execute(
        select(CodingProblem.difficulty)
        .join(CodingSubmission, CodingSubmission.problem_id == CodingProblem.id)
        .where(CodingSubmission.user_id == user.id)
        .where(CodingSubmission.status == CodingSubmissionStatus.PASSED)
        .group_by(CodingProblem.id, CodingProblem.difficulty)
    ).all()

    solved_counts = {"easy": 0, "medium": 0, "hard": 0}
    for (diff,) in solved_rows:
        solved_counts[diff.value] = solved_counts.get(diff.value, 0) + 1

    total_submissions = db.scalar(
        select(func.count(CodingSubmission.id)).where(CodingSubmission.user_id == user.id)
    ) or 0

    streak_days = 0
    if user.student_profile is not None:
        streak_days = user.student_profile.streak_days or 0

    # Avoid "type: ignore" issues — return Pydantic-compatible dict.
    _ = http_status  # silence unused-import lint; kept for future error use
    return {
        "solved_easy": solved_counts["easy"],
        "solved_medium": solved_counts["medium"],
        "solved_hard": solved_counts["hard"],
        "total_problems": total_problems,
        "total_submissions": total_submissions,
        "streak_days": streak_days,
    }
