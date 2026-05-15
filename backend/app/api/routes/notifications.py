"""WebSocket notifications endpoint (Phase 9 + Phase 21 ACK handling)."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.core.security import get_user_id_from_token
from app.services import notifications

router = APIRouter()
logger = logging.getLogger(__name__)


def _handle_ack(user_id: uuid.UUID, payload: dict) -> None:
    """Flip a NotificationDelivery row to ACKED when the client confirms.

    Runs in its own DB session so a stale request-scoped one can't leak
    transaction state into the long-lived WS handler.
    """
    raw_id = payload.get("id")
    if not raw_id:
        return
    try:
        notification_id = uuid.UUID(str(raw_id))
    except (TypeError, ValueError):
        return
    with SessionLocal() as ack_db:
        notifications.ack_notification(
            ack_db, user_id=user_id, notification_id=notification_id
        )


@router.websocket("/notifications")
async def notifications_ws(
    websocket: WebSocket,
    db: Annotated[Session, Depends(get_db)],
    token: str = Query(..., description="JWT access token"),
) -> None:
    """Long-lived WebSocket that streams push notifications for the authed user.

    The browser passes the JWT as `?token=...` (it cannot set Authorization
    headers on a WS handshake). We close with 4401 if auth fails so the client
    can distinguish auth errors from network issues.

    Inbound client messages are JSON-encoded. The only one we recognise is
    `{"type": "ack", "id": "<uuid>"}` which flips the matching delivery row
    to ACKED — anything else (or non-JSON) is treated as a benign keepalive.
    """
    try:
        user_id = get_user_id_from_token(token)
    except InvalidTokenError:
        await websocket.close(code=4401)
        return

    from app.services.auth import get_user_by_id

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    await notifications.manager.add(user.id, websocket)

    # Send an initial hello so the client can confirm the channel is live.
    try:
        await websocket.send_json(
            {"type": "_connected", "user_id": str(user.id)}
        )
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except ValueError:
                continue  # benign keepalive ping
            if isinstance(payload, dict) and payload.get("type") == "ack":
                _handle_ack(user.id, payload)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("notifications WS error for user %s", user.id)
    finally:
        await notifications.manager.remove(user.id, websocket)
