"""Pydantic schemas for the Student Dashboard (Phase 12 + Phase 13)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.announcement import AnnouncementResponse

TaskPriorityLiteral = Literal["urgent", "high", "medium", "low"]
TaskKindLiteral = Literal["quiz", "retake", "weak_area", "daily_login"]


class XPProgress(BaseModel):
    xp_total: int
    current_level: int
    streak_days: int
    streak_multiplier: float
    xp_into_level: int             # XP earned past the start of the current level
    next_level_threshold: int      # cumulative XP at the start of the next level
    xp_to_next_level: int          # next_level_threshold - xp_total


class CampusIQScoreBreakdown(BaseModel):
    total: float
    academic: float
    skill: float
    interview: float
    placement: float
    last_calculated_at: datetime | None = None


class TaskItemResponse(BaseModel):
    title: str
    reason: str
    priority: TaskPriorityLiteral
    score: float
    kind: TaskKindLiteral
    action_url: str | None = None
    quiz_id: uuid.UUID | None = None
    subject_code: str | None = None


class ActivityItem(BaseModel):
    id: uuid.UUID
    event_type: str
    xp_earned: int
    created_at: datetime
    title: str        # human-readable summary built server-side


class DashboardStats(BaseModel):
    quizzes_attempted: int
    quizzes_passed: int
    avg_quiz_score: float | None
    weekly_rank: int | None = None  # filled in by leaderboard later


class DashboardResponse(BaseModel):
    student_id: uuid.UUID
    full_name: str
    semester: int | None
    branch: str | None
    xp: XPProgress
    score: CampusIQScoreBreakdown
    stats: DashboardStats
    tasks: list[TaskItemResponse]
    recent_activity: list[ActivityItem]
    announcements: list[AnnouncementResponse] = []


# ── Teacher dashboard (Phase 4 wiring) ──

class TeacherStat(BaseModel):
    label: str
    value: str
    trend: float | None = None  # signed % change vs prior period (optional)


class RecentUploadRow(BaseModel):
    id: uuid.UUID
    name: str
    subject_code: str | None
    subject_name: str | None
    created_at: datetime
    status: Literal["pending", "processing", "ready", "failed"]


class TeacherActivityItem(BaseModel):
    """One row in the teacher's RECENT ACTIVITY card.

    `type` drives the icon shown. `action_url` is a frontend path the row
    navigates to on click (e.g. /teacher/documents, /teacher/quizzes).
    """

    type: Literal[
        "doc_uploaded",
        "quiz_created",
        "quiz_published",
        "attempt_received",
        "announcement",
    ]
    title: str
    subtitle: str | None = None
    occurred_at: datetime
    action_url: str | None = None


class TopicAccuracyRow(BaseModel):
    """One row in the "Weakest topics" list. Lower accuracy = weaker."""

    topic: str
    attempts: int
    correct: int
    accuracy_pct: float


class MissedQuestionRow(BaseModel):
    """One question that the class struggles with most."""

    question_id: uuid.UUID
    question_text: str
    quiz_id: uuid.UUID
    quiz_title: str
    times_asked: int
    times_correct: int
    accuracy_pct: float


class ScoreBucketRow(BaseModel):
    """One bin in the score distribution histogram."""

    bucket_label: str  # e.g. "0–20%", "21–40%"
    bucket_min: int    # inclusive
    bucket_max: int    # inclusive
    count: int


class TeacherAnalyticsResponse(BaseModel):
    """Per-subject (or all-subjects) analytics for the teacher dashboard.

    Returned by GET /dashboard/teacher/analytics?subject_id=... When
    subject_id is omitted, the response aggregates across every subject the
    teacher owns.
    """

    subject_id: uuid.UUID | None = None
    subject_code: str | None = None
    subject_name: str | None = None
    weakest_topics: list[TopicAccuracyRow] = []
    most_missed_questions: list[MissedQuestionRow] = []
    score_distribution: list[ScoreBucketRow] = []
    total_attempts: int = 0


class SubjectPerformanceRow(BaseModel):
    """One row in the per-subject class performance table.

    `avg_score` is the average score across every attempt on every quiz that
    belongs to this subject + the teacher. Only subjects with at least one
    attempt show up — we don't render placeholder rows for empty subjects.
    """

    subject_id: uuid.UUID
    subject_code: str
    subject_name: str
    attempts_count: int
    students_count: int
    avg_score: float


class TeacherDashboardResponse(BaseModel):
    teacher_id: uuid.UUID
    full_name: str
    department: str | None
    stats: list[TeacherStat]
    recent_uploads: list[RecentUploadRow]
    recent_activity: list[TeacherActivityItem] = []
    class_average: float | None
    class_performance_by_subject: list[SubjectPerformanceRow] = []
    students_total: int


# ── Admin dashboard (Phase 4 wiring) ──

class AdminStat(BaseModel):
    label: str
    value: str
    trend: float | None = None


class UserBreakdownRow(BaseModel):
    role: Literal["student", "teacher", "admin"]
    count: int


class PlatformActivityItem(BaseModel):
    text: str
    created_at: datetime


class PlatformHealth(BaseModel):
    api_response_ms: int
    storage_used_gb: float
    storage_quota_gb: float
    uptime_pct: float


class AdminDashboardResponse(BaseModel):
    stats: list[AdminStat]
    user_breakdown: list[UserBreakdownRow]
    recent_activity: list[PlatformActivityItem]
    platform_health: PlatformHealth


# ── Admin user list ──

class AdminUserRow(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: Literal["student", "teacher", "admin"]
    is_active: bool
    branch: str | None = None
    semester: int | None = None
    department: str | None = None
    last_login: datetime | None = None
    created_at: datetime


class AdminUserListResponse(BaseModel):
    total: int
    items: list[AdminUserRow]


# ── Teacher: per-student detail ──

class StudentQuizScore(BaseModel):
    quiz_id: uuid.UUID
    label: str
    value: float
    completed_at: datetime


class StudentDetailResponse(BaseModel):
    student_id: uuid.UUID
    name: str
    branch: str | None
    semester: int | None
    quiz_scores: list[StudentQuizScore]
    weak_areas: list[str]
    xp_total: int
    streak_days: int
    community_contributions: int
