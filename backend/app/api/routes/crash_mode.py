"""Crash Mode persisted plan endpoints — one active plan per student."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.models.crash_mode import CrashModePlan
from app.models.user import UserRole
from app.schemas.crash_mode import (
    CrashModePlanResponse,
    CrashModePlanWrite,
    CrashTopicsUpdate,
)

router = APIRouter()


def _require_student(user) -> None:
    if user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Crash Mode is only available to students.",
        )


@router.get(
    "/me",
    response_model=CrashModePlanResponse,
    summary="Get the current student's active crash plan",
    responses={404: {"description": "No active crash plan"}},
)
def get_my_plan(db: DbSession, current_user: CurrentUser) -> CrashModePlanResponse:
    _require_student(current_user)
    plan = db.scalar(
        select(CrashModePlan).where(CrashModePlan.student_id == current_user.id)
    )
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active crash plan",
        )
    return CrashModePlanResponse.model_validate(plan)


@router.put(
    "/me",
    response_model=CrashModePlanResponse,
    summary="Create or replace the student's active crash plan",
)
def upsert_my_plan(
    data: CrashModePlanWrite,
    db: DbSession,
    current_user: CurrentUser,
) -> CrashModePlanResponse:
    _require_student(current_user)
    plan = db.scalar(
        select(CrashModePlan).where(CrashModePlan.student_id == current_user.id)
    )
    if plan is None:
        plan = CrashModePlan(student_id=current_user.id)
        db.add(plan)

    plan.target_label = data.target_label
    plan.target_days = data.target_days
    plan.started_at = data.started_at
    plan.tasks = [t.model_dump() for t in data.tasks]
    plan.completed_topics = data.completed_topics
    plan.total_hours_scheduled = data.total_hours_scheduled
    db.commit()
    db.refresh(plan)
    return CrashModePlanResponse.model_validate(plan)


@router.patch(
    "/me/topics",
    response_model=CrashModePlanResponse,
    summary="Update which task topics are checked off",
)
def update_topics(
    data: CrashTopicsUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> CrashModePlanResponse:
    _require_student(current_user)
    plan = db.scalar(
        select(CrashModePlan).where(CrashModePlan.student_id == current_user.id)
    )
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active crash plan to update",
        )
    plan.completed_topics = data.completed_topics
    db.commit()
    db.refresh(plan)
    return CrashModePlanResponse.model_validate(plan)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard the student's active crash plan",
)
def delete_my_plan(db: DbSession, current_user: CurrentUser) -> Response:
    _require_student(current_user)
    plan = db.scalar(
        select(CrashModePlan).where(CrashModePlan.student_id == current_user.id)
    )
    if plan is not None:
        db.delete(plan)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
