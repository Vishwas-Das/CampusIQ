"""Admin-facing response shapes for the notification delivery dashboard.

The student-facing notification payload is built ad-hoc inside
`services/notifications.py:_payload_for_row` because it's a WebSocket
message, not a REST response. These schemas are only used by the admin
status + stats endpoints exposed under `/api/v1/admin/notifications/`.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationDeliveryRow(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None
    user_email: str | None
    notification_type: str
    title: str
    content: str
    sequence_number: int
    status: str
    retry_count: int
    last_sent_at: datetime | None
    acked_at: datetime | None
    created_at: datetime
    # Server-computed latency in milliseconds. None when still pending.
    latency_ms: int | None


class NotificationStatusResponse(BaseModel):
    rows: list[NotificationDeliveryRow]
    total: int


class NotificationStatsResponse(BaseModel):
    total: int
    pending: int
    sent: int
    acked: int
    failed: int
    delivery_rate_percent: float
