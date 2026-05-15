"""Notification delivery tests — ACK + retry loop + admin dashboard.

Covers the Phase 21 reliability layer on top of the Phase 9 publish/
WebSocket plumbing. The retry loop and ACK helper run against a real
SQLite session; the WebSocket itself is faked with a minimal stand-in
so `_send_payload` succeeds without needing a live connection.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.algorithm import (
    NotificationDelivery,
    NotificationStatus,
    NotificationType,
)
from app.services import notifications


class _FakeWebSocket:
    """Stand-in for `fastapi.WebSocket` used by `_send_payload`.

    Records every payload it received so a test can assert delivery.
    Set `fail=True` to simulate a closed socket so the send raises.
    """

    def __init__(self, *, fail: bool = False) -> None:
        self.received: list[dict] = []
        self.fail = fail

    async def send_json(self, payload: dict) -> None:
        if self.fail:
            raise ConnectionError("simulated dead socket")
        self.received.append(payload)


@pytest.fixture(autouse=True)
def _isolate_connection_manager():
    """Each test gets an empty connection registry so order can't leak.

    Also restores any retry-loop module state we touch.
    """
    notifications.manager._by_user.clear()
    yield
    notifications.manager._by_user.clear()


def _make_row(
    db: Session,
    *,
    user_id: uuid.UUID,
    status: NotificationStatus = NotificationStatus.PENDING,
    retry_count: int = 0,
    last_sent_at: datetime | None = None,
    title: str = "Title",
) -> NotificationDelivery:
    row = NotificationDelivery(
        user_id=user_id,
        notification_type=NotificationType.ANNOUNCEMENT,
        title=title,
        content="body",
        sequence_number=1,
        status=status,
        retry_count=retry_count,
        last_sent_at=last_sent_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _make_user(db: Session) -> uuid.UUID:
    """Insert a minimal User row directly (we don't need auth here)."""
    from app.models.user import User, UserRole

    suffix = uuid.uuid4().hex[:8]
    user = User(
        email=f"notif-{suffix}@example.com",
        full_name=f"Notif {suffix}",
        hashed_password="x",
        role=UserRole.STUDENT,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user.id


# ── Pure-function tests ───────────────────────────────────────────────


def test_backoff_schedule_doubles_then_caps():
    assert notifications._compute_backoff_seconds(0) == 1.0
    assert notifications._compute_backoff_seconds(1) == 2.0
    assert notifications._compute_backoff_seconds(2) == 4.0
    assert notifications._compute_backoff_seconds(3) == 8.0
    # 2^20 × 1s would be ~12 days; the cap clamps to RETRY_MAX_BACKOFF_SECONDS.
    assert (
        notifications._compute_backoff_seconds(20)
        == notifications.RETRY_MAX_BACKOFF_SECONDS
    )


def test_is_due_when_last_sent_is_none(db_session: Session):
    user_id = _make_user(db_session)
    row = _make_row(db_session, user_id=user_id, last_sent_at=None)
    assert notifications._is_due_for_retry(row, datetime.now(tz=timezone.utc))


def test_is_due_respects_backoff(db_session: Session):
    user_id = _make_user(db_session)
    now = datetime.now(tz=timezone.utc)
    # retry_count=2 → backoff of 4 seconds; last_sent_at 2s ago is NOT due.
    row = _make_row(
        db_session,
        user_id=user_id,
        retry_count=2,
        last_sent_at=now - timedelta(seconds=2),
    )
    assert notifications._is_due_for_retry(row, now) is False
    # 5s ago IS due.
    row.last_sent_at = now - timedelta(seconds=5)
    assert notifications._is_due_for_retry(row, now) is True


# ── ACK helper ────────────────────────────────────────────────────────


def test_ack_flips_status_and_sets_acked_at(db_session: Session):
    user_id = _make_user(db_session)
    row = _make_row(
        db_session,
        user_id=user_id,
        status=NotificationStatus.SENT,
        last_sent_at=datetime.now(tz=timezone.utc),
    )
    ok = notifications.ack_notification(
        db_session, user_id=user_id, notification_id=row.id
    )
    assert ok is True
    db_session.refresh(row)
    assert row.status == NotificationStatus.ACKED
    assert row.acked_at is not None


def test_ack_idempotent(db_session: Session):
    user_id = _make_user(db_session)
    row = _make_row(
        db_session,
        user_id=user_id,
        status=NotificationStatus.ACKED,
        last_sent_at=datetime.now(tz=timezone.utc),
    )
    row.acked_at = datetime.now(tz=timezone.utc)
    db_session.commit()
    ok = notifications.ack_notification(
        db_session, user_id=user_id, notification_id=row.id
    )
    assert ok is True


def test_ack_rejects_other_users_row(db_session: Session):
    owner = _make_user(db_session)
    other = _make_user(db_session)
    row = _make_row(db_session, user_id=owner)
    ok = notifications.ack_notification(
        db_session, user_id=other, notification_id=row.id
    )
    assert ok is False


def test_ack_missing_row_returns_false(db_session: Session):
    user_id = _make_user(db_session)
    ok = notifications.ack_notification(
        db_session, user_id=user_id, notification_id=uuid.uuid4()
    )
    assert ok is False


# ── Retry loop tick ───────────────────────────────────────────────────


def test_pending_row_drains_when_socket_appears(db_session: Session):
    user_id = _make_user(db_session)
    _make_row(db_session, user_id=user_id, status=NotificationStatus.PENDING)

    # First tick: no socket connected → stays PENDING.
    counters = asyncio.run(notifications._retry_loop_tick())
    assert counters["pending_drained"] == 0
    db_session.expire_all()
    row = db_session.scalar(select(NotificationDelivery))
    assert row.status == NotificationStatus.PENDING

    # Hook a fake socket up to the manager, tick again → SENT.
    ws = _FakeWebSocket()
    notifications.manager._by_user[user_id] = [ws]  # type: ignore[arg-type]
    counters = asyncio.run(notifications._retry_loop_tick())
    assert counters["pending_drained"] == 1
    assert len(ws.received) == 1
    assert ws.received[0]["title"] == "Title"
    db_session.expire_all()
    row = db_session.scalar(select(NotificationDelivery))
    assert row.status == NotificationStatus.SENT
    assert row.last_sent_at is not None


def test_sent_row_retries_after_backoff(db_session: Session):
    user_id = _make_user(db_session)
    long_ago = datetime.now(tz=timezone.utc) - timedelta(seconds=30)
    _make_row(
        db_session,
        user_id=user_id,
        status=NotificationStatus.SENT,
        retry_count=0,
        last_sent_at=long_ago,
    )
    ws = _FakeWebSocket()
    notifications.manager._by_user[user_id] = [ws]  # type: ignore[arg-type]

    counters = asyncio.run(notifications._retry_loop_tick())
    assert counters["retried"] == 1
    assert len(ws.received) == 1
    db_session.expire_all()
    row = db_session.scalar(select(NotificationDelivery))
    assert row.retry_count == 1
    assert row.status == NotificationStatus.SENT


def test_sent_row_marked_failed_after_max_retries(db_session: Session):
    """A row already at MAX_RETRIES with a stale `last_sent_at` flips to FAILED."""
    user_id = _make_user(db_session)
    long_ago = datetime.now(tz=timezone.utc) - timedelta(seconds=120)
    _make_row(
        db_session,
        user_id=user_id,
        status=NotificationStatus.SENT,
        retry_count=notifications.MAX_RETRIES,
        last_sent_at=long_ago,
    )
    # Socket connected, but we should NOT push because we've exhausted retries.
    ws = _FakeWebSocket()
    notifications.manager._by_user[user_id] = [ws]  # type: ignore[arg-type]
    counters = asyncio.run(notifications._retry_loop_tick())
    assert counters["failed"] == 1
    assert ws.received == []
    db_session.expire_all()
    row = db_session.scalar(select(NotificationDelivery))
    assert row.status == NotificationStatus.FAILED


def test_acked_row_left_alone_by_retry_loop(db_session: Session):
    user_id = _make_user(db_session)
    long_ago = datetime.now(tz=timezone.utc) - timedelta(seconds=120)
    _make_row(
        db_session,
        user_id=user_id,
        status=NotificationStatus.ACKED,
        retry_count=1,
        last_sent_at=long_ago,
    )
    ws = _FakeWebSocket()
    notifications.manager._by_user[user_id] = [ws]  # type: ignore[arg-type]
    counters = asyncio.run(notifications._retry_loop_tick())
    assert counters == {
        "pending_drained": 0,
        "retried": 0,
        "failed": 0,
        "acked_skip": 0,
    }
    assert ws.received == []


# ── Aggregate queries ────────────────────────────────────────────────


def test_compute_delivery_stats_aggregates(db_session: Session):
    user_id = _make_user(db_session)
    for status in (
        NotificationStatus.PENDING,
        NotificationStatus.SENT,
        NotificationStatus.SENT,
        NotificationStatus.ACKED,
        NotificationStatus.ACKED,
        NotificationStatus.FAILED,
    ):
        row = _make_row(
            db_session,
            user_id=user_id,
            status=status,
        )
        if status == NotificationStatus.ACKED:
            row.acked_at = datetime.now(tz=timezone.utc)
            db_session.commit()
    stats = notifications.compute_delivery_stats(db_session)
    assert stats == {
        "total": 6,
        "pending": 1,
        "sent": 2,
        "acked": 2,
        "failed": 1,
        # delivery_rate = (acked + sent) / total = 4/6 = 66.67%
        "delivery_rate_percent": pytest.approx(66.67, abs=0.01),
    }


def test_list_delivery_rows_newest_first(db_session: Session):
    user_id = _make_user(db_session)
    older = _make_row(db_session, user_id=user_id, title="older")
    # Force a created_at gap.
    older.created_at = datetime.now(tz=timezone.utc) - timedelta(hours=1)
    db_session.commit()
    _make_row(db_session, user_id=user_id, title="newer")
    rows = notifications.list_delivery_rows(db_session, limit=10)
    assert rows[0].title == "newer"
    assert rows[1].title == "older"


# ── Admin endpoint smoke tests ────────────────────────────────────────


def _admin_headers(client, signup_payload) -> dict:
    r = client.post("/api/v1/auth/signup", json=signup_payload("admin"))
    assert r.status_code in (200, 201)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _student_headers(client, signup_payload) -> dict:
    r = client.post("/api/v1/auth/signup", json=signup_payload("student"))
    assert r.status_code in (200, 201)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_admin_status_endpoint_rejects_non_admin(client, signup_payload):
    headers = _student_headers(client, signup_payload)
    r = client.get("/api/v1/admin/notifications/status", headers=headers)
    assert r.status_code == 403


def test_admin_stats_endpoint_rejects_non_admin(client, signup_payload):
    headers = _student_headers(client, signup_payload)
    r = client.get("/api/v1/admin/notifications/stats", headers=headers)
    assert r.status_code == 403


def test_admin_status_endpoint_shape(client, signup_payload):
    headers = _admin_headers(client, signup_payload)
    r = client.get("/api/v1/admin/notifications/status", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rows" in body
    assert "total" in body


def test_admin_stats_endpoint_shape(client, signup_payload):
    headers = _admin_headers(client, signup_payload)
    r = client.get("/api/v1/admin/notifications/stats", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("total", "pending", "sent", "acked", "failed", "delivery_rate_percent"):
        assert key in body
