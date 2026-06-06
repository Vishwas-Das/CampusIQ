"""Dashboard endpoints — student / teacher / admin (Phase 12 + Phase 4 wiring)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.models.user import UserRole
from app.schemas.dashboard import (
    AdminDashboardResponse,
    DashboardResponse,
    TeacherAnalyticsResponse,
    TeacherDashboardResponse,
)
from app.services import dashboard as dashboard_service

router = APIRouter()


@router.get(
    "/me",
    response_model=DashboardResponse,
    summary="Student: full dashboard payload (XP, score, task feed, activity)",
)
def my_dashboard(db: DbSession, current_user: CurrentUser) -> DashboardResponse:
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students have a dashboard. Teachers and admins use their own views.",
        )
    return dashboard_service.get_student_dashboard(db, current_user)


@router.get(
    "/teacher",
    response_model=TeacherDashboardResponse,
    summary="Teacher: stats, recent uploads, class average",
)
def teacher_dashboard(
    db: DbSession, current_user: CurrentUser
) -> TeacherDashboardResponse:
    return dashboard_service.get_teacher_dashboard(db, current_user)


@router.get(
    "/teacher/analytics",
    response_model=TeacherAnalyticsResponse,
    summary="Teacher: per-subject weak topics, most missed Qs, score distribution",
)
def teacher_analytics(
    db: DbSession,
    current_user: CurrentUser,
    subject_id: uuid.UUID | None = None,
) -> TeacherAnalyticsResponse:
    return dashboard_service.get_teacher_analytics(
        db, current_user, subject_id=subject_id
    )


@router.get(
    "/admin",
    response_model=AdminDashboardResponse,
    summary="Admin: platform stats, user breakdown, recent activity, health",
)
def admin_dashboard(db: DbSession, current_user: CurrentUser) -> AdminDashboardResponse:
    return dashboard_service.get_admin_dashboard(db, current_user)
