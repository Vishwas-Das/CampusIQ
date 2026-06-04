"""Pydantic schemas for the peer Doubt Community (Phase 17, F4)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DoubtVisibilityLiteral = Literal["public", "private"]


class DoubtCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1, max_length=5000)
    tags: list[str] = Field(default_factory=list)
    subject_id: uuid.UUID | None = None
    visibility: DoubtVisibilityLiteral = "public"
    # Required when visibility == "private".
    assigned_teacher_id: uuid.UUID | None = None


class DoubtAnswerCreate(BaseModel):
    answer_text: str = Field(..., min_length=1, max_length=5000)


class DoubtAnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    doubt_id: uuid.UUID
    answered_by_id: uuid.UUID | None
    answered_by_name: str | None = None
    answered_by_role: str | None = None
    answer_text: str
    is_ai_generated: bool
    is_accepted: bool
    upvote_count: int
    created_at: datetime


class DoubtResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    student_name: str | None = None
    subject_id: uuid.UUID | None = None
    subject_code: str | None = None
    visibility: DoubtVisibilityLiteral
    assigned_teacher_id: uuid.UUID | None = None
    assigned_teacher_name: str | None = None
    title: str
    body: str
    tags: list[str]
    is_resolved: bool
    upvote_count: int
    view_count: int
    answer_count: int
    has_ai_answer: bool
    created_at: datetime


class DoubtDetailResponse(DoubtResponse):
    answers: list[DoubtAnswerResponse]


class AccessibleTeacher(BaseModel):
    """One teacher the current student can DM."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    department_name: str | None = None
    designation: str | None = None
    # The subject(s) that connect this teacher to the student.
    subject_codes: list[str] = Field(default_factory=list)
