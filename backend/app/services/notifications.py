"""Real-time notifications (Phase 9 + Phase 21 reliability layer).

A WebSocket connection registry + a `publish` helper that other endpoints
call after they've completed their work. Connections are authenticated
via a JWT passed as a `?token=` query parameter (browsers can't add
Authorization headers to WebSocket handshakes).

Persistence: every notification writes a `NotificationDelivery` row with a
per-user `sequence_number`. The retry/ACK layer (Phase 21) treats this
table as a TCP-style outbox — clients ACK by id, the background retry
loop re-pushes SENT-but-unacked rows on exponential backoff (1, 2, 4,
8 s) until they're ACKED or fall over to FAILED after `MAX_RETRIES`
retries. PENDING rows (never delivered because the user had no open
socket at publish time) get drained the moment a socket appears.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.algorithm import (
    NotificationDelivery,
    NotificationStatus,
    NotificationType,
)

logger = logging.getLogger(__name__)


# ── Retry / ACK tunables ──────────────────────────────────────────────
# Mirrors the language in the admin "How TCP-Style Delivery Works" card:
# backoff goes 1, 2, 4, 8 seconds, capped at MAX_RETRIES retries.
MAX_RETRIES = 3
RETRY_BASE_SECONDS = 1.0
RETRY_MAX_BACKOFF_SECONDS = 60.0
RETRY_SCAN_INTERVAL_SECONDS = 1.5
# Safety cap on rows per scan so a flood of unacked notifications can't
# starve other work.
RETRY_SCAN_BATCH_LIMIT = 200


# Captured at app startup so sync DB-handler threads can still dispatch sends
# onto the loop that owns the live WebSocket objects.
_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


def get_main_loop() -> asyncio.AbstractEventLoop | None:
    return _main_loop


class _ConnectionManager:
    """Tracks open WebSocket connections, keyed by user_id."""

    def __init__(self) -> None:
        self._by_user: dict[uuid.UUID, list[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def add(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            self._by_user.setdefault(user_id, []).append(ws)

    async def remove(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        async with self._lock:
            sockets = self._by_user.get(user_id)
            if not sockets:
                return
            try:
                sockets.remove(ws)
            except ValueError:
                pass
            if not sockets:
                self._by_user.pop(user_id, None)

    def connections_for(self, user_id: uuid.UUID) -> list[WebSocket]:
        return list(self._by_user.get(user_id, []))


manager = _ConnectionManager()


async def _send_payload(ws: WebSocket, payload: dict[str, Any]) -> bool:
    """Try to send a JSON payload. Returns True on success."""
    try:
        await ws.send_json(payload)
        return True
    except Exception:  # noqa: BLE001 — any send failure is non-fatal
        return False


def _next_sequence_number(db: Session, user_id: uuid.UUID) -> int:
    current_max = db.scalar(
        select(func.max(NotificationDelivery.sequence_number)).where(
            NotificationDelivery.user_id == user_id
        )
    )
    return int(current_max or 0) + 1


async def publish(
    db: Session,
    *,
    user_id: uuid.UUID,
    notification_type: NotificationType,
    title: str,
    content: str,
    extra: dict[str, Any] | None = None,
) -> NotificationDelivery:
    """Persist a notification + push it to any active WebSocket clients.

    The DB row is always written (so users see history when they reconnect).
    Live delivery is best-effort: if no socket is open or sending fails, the
    row is still saved as PENDING and a follow-up reconciliation job could
    retry it later.
    """
    seq = _next_sequence_number(db, user_id)
    row = NotificationDelivery(
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        content=content,
        sequence_number=seq,
        status=NotificationStatus.PENDING,
    )
    db.add(row)
    db.flush()

    payload = {
        "id": str(row.id),
        "type": notification_type.value,
        "title": title,
        "content": content,
        "sequence_number": seq,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if extra:
        payload["extra"] = extra

    sockets = manager.connections_for(user_id)
    if sockets:
        # Fire all sends in parallel; mark sent if any succeed.
        results = await asyncio.gather(
            *[_send_payload(ws, payload) for ws in sockets], return_exceptions=False
        )
        if any(results):
            row.status = NotificationStatus.SENT
            row.last_sent_at = datetime.now(tz=timezone.utc)
    return row


async def _push_payload_to_user(user_id: uuid.UUID, payload: dict[str, Any]) -> bool:
    """Send the payload to every active socket for this user. Returns True if
    at least one send succeeded."""
    sockets = manager.connections_for(user_id)
    if not sockets:
        return False
    results = await asyncio.gather(
        *[_send_payload(ws, payload) for ws in sockets], return_exceptions=False
    )
    return any(results)


def publish_sync(
    db: Session,
    *,
    user_id: uuid.UUID,
    notification_type: NotificationType,
    title: str,
    content: str,
    extra: dict[str, Any] | None = None,
) -> NotificationDelivery:
    """Sync wrapper used from FastAPI sync route handlers.

    Always persists the row. WebSocket fan-out is dispatched onto the main
    event loop via `run_coroutine_threadsafe` so live sockets actually receive
    the message — they belong to that loop, not the calling worker thread.
    """
    seq = _next_sequence_number(db, user_id)
    row = NotificationDelivery(
        user_id=user_id,
        notification_type=notification_type,
        title=title,
        content=content,
        sequence_number=seq,
        status=NotificationStatus.PENDING,
    )
    db.add(row)
    db.flush()

    payload = {
        "id": str(row.id),
        "type": notification_type.value,
        "title": title,
        "content": content,
        "sequence_number": seq,
        "created_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if extra:
        payload["extra"] = extra

    loop = _main_loop
    if loop is None:
        # No live loop captured — pure-DB persistence is the best we can do.
        return row

    try:
        future = asyncio.run_coroutine_threadsafe(
            _push_payload_to_user(user_id, payload), loop
        )
    except RuntimeError as exc:
        logger.warning("Could not schedule notification dispatch: %s", exc)
        return row

    # Block briefly to flip status when delivery succeeds. The 1s timeout
    # keeps the API responsive even if the loop is busy.
    try:
        delivered = future.result(timeout=1.0)
    except Exception:  # noqa: BLE001 — timeout / cancellation are fine
        delivered = False
    if delivered:
        row.status = NotificationStatus.SENT
        row.last_sent_at = datetime.now(tz=timezone.utc)
    return row


# ── ACK + retry mechanics (Phase 21) ──────────────────────────────────


def ack_notification(
    db: Session, *, user_id: uuid.UUID, notification_id: uuid.UUID
) -> bool:
    """Mark a notification ACKED on behalf of its owning user.

    Returns True if the row was found and is owned by this user. The
    operation is idempotent — re-ACKing an already-ACKED row is a no-op
    that still returns True so the client never sees a spurious failure.
    """
    row = db.get(NotificationDelivery, notification_id)
    if row is None:
        return False
    if row.user_id != user_id:
        return False
    if row.status == NotificationStatus.ACKED:
        return True
    row.status = NotificationStatus.ACKED
    row.acked_at = datetime.now(tz=timezone.utc)
    db.commit()
    return True


def _compute_backoff_seconds(retry_count: int) -> float:
    """Exponential backoff schedule: 1, 2, 4, 8 ... capped."""
    if retry_count < 0:
        return RETRY_BASE_SECONDS
    delay = RETRY_BASE_SECONDS * (2 ** retry_count)
    return min(delay, RETRY_MAX_BACKOFF_SECONDS)


def _as_utc(dt: datetime) -> datetime:
    """SQLite doesn't preserve tz info — coerce naive timestamps to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_due_for_retry(row: NotificationDelivery, now: datetime) -> bool:
    """SENT-but-unacked rows are due once `last_sent_at + backoff` is past."""
    if row.last_sent_at is None:
        return True
    elapsed = (now - _as_utc(row.last_sent_at)).total_seconds()
    return elapsed >= _compute_backoff_seconds(row.retry_count)


def _payload_for_row(row: NotificationDelivery) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "type": row.notification_type.value,
        "title": row.title,
        "content": row.content,
        "sequence_number": row.sequence_number,
        "retry_count": row.retry_count,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _retry_loop_tick() -> dict[str, int]:
    """One scan tick: deliver PENDING rows + retry SENT-but-unacked rows.

    Returns a small dict of counters for logging/tests. Each tick uses
    its own DB session so the background loop never piggybacks on a
    request-scoped session.
    """
    # Lazy import to dodge the circular dependency between this module
    # (imported eagerly by route modules at startup) and the engine setup.
    from app.core.database import SessionLocal

    counters = {"pending_drained": 0, "retried": 0, "failed": 0, "acked_skip": 0}
    now = datetime.now(tz=timezone.utc)
    with SessionLocal() as db:
        rows = list(
            db.scalars(
                select(NotificationDelivery)
                .where(
                    NotificationDelivery.status.in_(
                        [NotificationStatus.PENDING, NotificationStatus.SENT]
                    )
                )
                .order_by(NotificationDelivery.created_at.asc())
                .limit(RETRY_SCAN_BATCH_LIMIT)
            )
        )

        for row in rows:
            sockets = manager.connections_for(row.user_id)

            if row.status == NotificationStatus.PENDING:
                if not sockets:
                    # Wait for the user to come online; don't bump retry_count.
                    continue
                delivered = await _push_payload_to_user(
                    row.user_id, _payload_for_row(row)
                )
                if delivered:
                    row.status = NotificationStatus.SENT
                    row.last_sent_at = now
                    counters["pending_drained"] += 1
                continue

            # status == SENT (awaiting ACK)
            if not _is_due_for_retry(row, now):
                continue
            if row.retry_count >= MAX_RETRIES:
                # We've already used every retry; give up.
                row.status = NotificationStatus.FAILED
                counters["failed"] += 1
                continue
            delivered = (
                await _push_payload_to_user(row.user_id, _payload_for_row(row))
                if sockets
                else False
            )
            row.retry_count += 1
            if delivered:
                row.last_sent_at = now
            counters["retried"] += 1

        db.commit()
    return counters


# Module-level holders so tests can call cancel() deterministically.
_retry_task: asyncio.Task | None = None
_retry_loop_started = False


async def retry_loop() -> None:
    """Forever loop: re-deliver pending/unacked notifications.

    Cancellable via `task.cancel()`. Sleeps `RETRY_SCAN_INTERVAL_SECONDS`
    between ticks. Any per-tick exception is logged and swallowed so a
    single bad row never kills the loop.
    """
    logger.info(
        "notification retry loop starting (scan=%ss, max_retries=%s)",
        RETRY_SCAN_INTERVAL_SECONDS,
        MAX_RETRIES,
    )
    while True:
        try:
            await _retry_loop_tick()
        except Exception:  # noqa: BLE001
            logger.exception("notification retry tick failed")
        try:
            await asyncio.sleep(RETRY_SCAN_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            return


def start_retry_loop(loop: asyncio.AbstractEventLoop) -> asyncio.Task:
    """Schedule `retry_loop()` on the given event loop. Idempotent within
    a process — calling this twice without a prior cancellation returns the
    existing task."""
    global _retry_task, _retry_loop_started
    if _retry_task is not None and not _retry_task.done():
        return _retry_task
    _retry_task = loop.create_task(retry_loop(), name="notification-retry")
    _retry_loop_started = True
    return _retry_task


def stop_retry_loop() -> asyncio.Task | None:
    """Cancel the running retry loop, if any. Returns the cancelled task so
    the caller can `await` it for clean shutdown."""
    global _retry_task
    task = _retry_task
    if task is not None and not task.done():
        task.cancel()
    _retry_task = None
    return task


# ── Admin queries (Phase 21) ──────────────────────────────────────────


def list_delivery_rows(
    db: Session, *, limit: int = 50, offset: int = 0
) -> list[NotificationDelivery]:
    """Latest rows first, capped at `limit`. Used by the admin status page."""
    return list(
        db.scalars(
            select(NotificationDelivery)
            .order_by(NotificationDelivery.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )


def compute_delivery_stats(db: Session) -> dict[str, int | float]:
    """Aggregate counters for the admin status page header."""
    counts_by_status: dict[NotificationStatus, int] = {
        status: 0 for status in NotificationStatus
    }
    rows = db.execute(
        select(NotificationDelivery.status, func.count())
        .group_by(NotificationDelivery.status)
    ).all()
    for status, count in rows:
        counts_by_status[status] = int(count)
    total = sum(counts_by_status.values())
    acked = counts_by_status[NotificationStatus.ACKED]
    delivered = acked + counts_by_status[NotificationStatus.SENT]
    rate = (delivered / total * 100.0) if total else 0.0
    return {
        "total": total,
        "pending": counts_by_status[NotificationStatus.PENDING],
        "sent": counts_by_status[NotificationStatus.SENT],
        "acked": acked,
        "failed": counts_by_status[NotificationStatus.FAILED],
        "delivery_rate_percent": round(rate, 2),
    }
