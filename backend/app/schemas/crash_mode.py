"""Pydantic schemas for Crash Mode plan persistence."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CrashTask(BaseModel):
    """One scheduled study task within the plan."""

    model_config = ConfigDict(extra="ignore")

    topic: str = Field(..., max_length=255)
    hours: int = Field(..., ge=0, le=24)
    priority: float = Field(..., ge=0, le=10)
    subject_code: str | None = Field(None, max_length=64)


class CrashModePlanWrite(BaseModel):
    """Body for PUT /crash-mode/me — full upsert."""

    target_label: str = Field(..., min_length=1, max_length=255)
    target_days: int = Field(..., ge=1, le=14)
    started_at: datetime
    tasks: list[CrashTask]
    completed_topics: list[str] = Field(default_factory=list)
    total_hours_scheduled: int = Field(0, ge=0)


class CrashTopicsUpdate(BaseModel):
    """Body for PATCH /crash-mode/me/topics — toggle which tasks are done."""

    completed_topics: list[str]


class CrashModePlanResponse(BaseModel):
    """Returned by GET / PUT / PATCH."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    target_label: str
    target_days: int
    started_at: datetime
    tasks: list[CrashTask]
    completed_topics: list[str]
    total_hours_scheduled: int
    updated_at: datetime
