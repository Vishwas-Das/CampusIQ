"""Pydantic schemas for the algorithm-showcase endpoints (Phase 19)."""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

# ── Hamming similarity (F23) ──

class HammingPairResponse(BaseModel):
    student_a_id: uuid.UUID
    student_a_name: str
    student_b_id: uuid.UUID
    student_b_name: str
    quiz_id: uuid.UUID
    quiz_title: str
    hamming_distance: int
    similarity_percent: float
    answer_length: int


class SimilarityCheckResponse(BaseModel):
    quiz_id: uuid.UUID
    total_attempts: int
    flagged_pairs: list[HammingPairResponse]
    flagged_count: int
    mean_pairwise_similarity: float
    persisted_count: int


# ── Inclusion-exclusion (F25) ──

class SkillSetCount(BaseModel):
    skill: str
    count: int
    sample_names: list[str]


class SkillIntersection(BaseModel):
    skills: list[str]
    count: int


class InclusionExclusionResponse(BaseModel):
    skills: list[str]
    per_skill: list[SkillSetCount]
    intersections: list[SkillIntersection]
    union_count_naive: int
    union_count_actual: int
    overlap_correction: int
    total_students: int
    matching_student_names: list[str]


class InclusionExclusionRequest(BaseModel):
    skills: list[str] = Field(..., min_length=1, max_length=4)


# ── Graph coloring (F21) ──

class QuizSlotAssignmentResponse(BaseModel):
    quiz_id: uuid.UUID
    quiz_title: str
    subject_code: str | None
    color: int
    conflict_quiz_titles: list[str]


class GraphColoringResponse(BaseModel):
    assignments: list[QuizSlotAssignmentResponse]
    chromatic_number: int
    quiz_count: int
    edge_count: int
    color_groups: dict[str, list[str]]   # JSON-serializable string keys


# ── Backtracking schedule (F26) ──

class StudyTaskInput(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)
    hours: int = Field(..., ge=1, le=12)
    priority: float = Field(1.0, ge=0)
    subject_code: str | None = None


class ScheduleSlotResponse(BaseModel):
    day_index: int
    hour_index: int
    topic: str | None
    subject_code: str | None
    is_locked: bool


class StudyTaskResponse(BaseModel):
    topic: str
    hours: int
    priority: float
    subject_code: str | None


class GenerateScheduleResponse(BaseModel):
    slots: list[ScheduleSlotResponse]
    scheduled_tasks: list[StudyTaskResponse]
    skipped_tasks: list[StudyTaskResponse]
    total_value: float
    total_hours_scheduled: int
    explored_nodes: int


ScheduleStrategyLiteral = Literal["spread", "backtracking"]


class GenerateScheduleRequest(BaseModel):
    tasks: list[StudyTaskInput] = Field(..., min_length=1, max_length=15)
    days: int = Field(7, ge=1, le=14)
    # `spread` (default) is the realistic round-robin planner that spaces
    # tasks across the week and caps each day's load. `backtracking` is the
    # branch-and-bound packer used by Crash Mode where cramming under a
    # tight deadline is the point.
    strategy: ScheduleStrategyLiteral = "spread"
    # Maximum study hours per day for the spread strategy. Defaults to 3
    # server-side when omitted. Ignored for the backtracking strategy.
    daily_cap_hours: int | None = Field(default=None, ge=1, le=8)
