"""Admin-only endpoints (Phase 4 wiring) — user management + notification stats."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, require_role
from app.models.algorithm import NotificationDelivery
from app.models.user import User
from app.schemas.dashboard import AdminUserListResponse
from app.schemas.notification_admin import (
    NotificationDeliveryRow,
    NotificationStatsResponse,
    NotificationStatusResponse,
)
from app.services import dashboard as dashboard_service
from app.services import notifications as notifications_service

router = APIRouter()


@router.get(
    "/users",
    response_model=AdminUserListResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: list all platform users (filterable, searchable)",
)
def list_users(
    db: DbSession,
    current_user: CurrentUser,
    role: str | None = Query(None, description="student | teacher | admin | all"),
    search: str | None = Query(None, description="Match against name or email"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AdminUserListResponse:
    return dashboard_service.list_users(
        db,
        current_user,
        role=role,
        search=search,
        limit=limit,
        offset=offset,
    )


# ── Notification delivery dashboard (Phase 21) ────────────────────────


def _latency_ms(row: NotificationDelivery) -> int | None:
    """Latency from publish → ACKED, or publish → last SENT if not yet ACKed."""
    if row.acked_at is not None:
        return int((row.acked_at - row.created_at).total_seconds() * 1000)
    if row.last_sent_at is not None:
        return int((row.last_sent_at - row.created_at).total_seconds() * 1000)
    return None


@router.get(
    "/notifications/status",
    response_model=NotificationStatusResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: recent NotificationDelivery rows with user + status + retries",
)
def notification_status(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> NotificationStatusResponse:
    # Join to users so the table can show name + email instead of opaque UUIDs.
    stmt = (
        select(NotificationDelivery, User.full_name, User.email)
        .join(User, User.id == NotificationDelivery.user_id, isouter=True)
        .order_by(NotificationDelivery.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows: list[NotificationDeliveryRow] = []
    for delivery, full_name, email in db.execute(stmt).all():
        rows.append(
            NotificationDeliveryRow(
                id=delivery.id,
                user_id=delivery.user_id,
                user_name=full_name,
                user_email=email,
                notification_type=delivery.notification_type.value,
                title=delivery.title,
                content=delivery.content,
                sequence_number=delivery.sequence_number,
                status=delivery.status.value,
                retry_count=delivery.retry_count,
                last_sent_at=delivery.last_sent_at,
                acked_at=delivery.acked_at,
                created_at=delivery.created_at,
                latency_ms=_latency_ms(delivery),
            )
        )
    total = int(
        db.scalar(select(func.count()).select_from(NotificationDelivery)) or 0
    )
    return NotificationStatusResponse(rows=rows, total=total)


@router.get(
    "/notifications/stats",
    response_model=NotificationStatsResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: aggregate counters for the delivery dashboard header",
)
def notification_stats(
    db: DbSession, current_user: CurrentUser
) -> NotificationStatsResponse:
    stats = notifications_service.compute_delivery_stats(db)
    return NotificationStatsResponse(**stats)
