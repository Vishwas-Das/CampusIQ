"""Coding practice platform models (V1 of the coding/learn platform).

LeetCode-style problem/submission pair. V1 supports Python only via client-side
Pyodide execution; the `language` field on every record is reserved so V4 can
plug in C++ via Judge0 with zero schema migration.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models._enum_helper import enum_values


class CodingDifficulty(str, enum.Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class CodingLanguage(str, enum.Enum):
    """Supported languages for submissions. CPP and JAVA are reserved values
    that will be enabled in V4 once Judge0 backend execution lands."""

    PYTHON = "python"
    CPP = "cpp"  # reserved — not selectable by the frontend in V1
    JAVA = "java"  # reserved


class CodingSubmissionStatus(str, enum.Enum):
    """Outcome of a single submission attempt."""

    PASSED = "passed"  # all tests passed
    FAILED = "failed"  # at least one wrong-answer test
    ERROR = "error"  # syntax / runtime / timeout before any test ran


class CodingProblem(Base):
    """A single LeetCode-style practice problem.

    Test cases are stored as JSON arrays of `{"input": [...], "expected": ...}`
    rows. `visible_test_cases` are shown to the user (and used by Run); the
    `hidden_test_cases` are used only by Submit. Note: with Pyodide running
    client-side, the hidden cases are technically reachable via DevTools —
    documented limitation we recover from in V4 with Judge0.
    """

    __tablename__ = "coding_problems"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)  # markdown
    difficulty: Mapped[CodingDifficulty] = mapped_column(
        Enum(CodingDifficulty, name="coding_difficulty", values_callable=enum_values),
        nullable=False,
        index=True,
    )

    # Test-runner contract
    function_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # {"params": [{"name":"nums","type":"list[int]"}, {"name":"target","type":"int"}], "returns": "list[int]"}
    function_signature: Mapped[dict] = mapped_column(JSON, nullable=False)
    # [{"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]", "explanation": "..."}]
    examples: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    hints: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # list[str]

    # Per-language code blobs. Keyed by CodingLanguage enum value.
    # {"python": "def two_sum(nums, target):\n    pass\n"}
    starter_code: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reference_solution: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # [{"input": [[2,7,11,15], 9], "expected": [0,1]}, ...]
    visible_test_cases: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    hidden_test_cases: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Equality mode for the test runner: "exact" | "sorted" | "set"
    comparator: Mapped[str] = mapped_column(String(20), nullable=False, default="exact")

    # Human-readable topic chips (display) + skill-graph node names (mastery wiring).
    topic_tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    skill_node_names: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    # Canonical LeetCode problem URL for the "Open on LeetCode" redirect. When
    # null, the API derives `https://leetcode.com/problems/<slug>/` from the slug.
    leetcode_url: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    submissions: Mapped[list["CodingSubmission"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )


class CodingSubmission(Base):
    """A single submission attempt by a student against a coding problem.

    Because Pyodide runs client-side, the test-pass counts here are reported by
    the client. We treat them as a record of what the student saw, not a
    server-side proof. V4 (Judge0 / C++) re-establishes server-side verification.
    """

    __tablename__ = "coding_submissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    problem_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("coding_problems.id", ondelete="CASCADE"), nullable=False, index=True
    )
    language: Mapped[CodingLanguage] = mapped_column(
        Enum(CodingLanguage, name="coding_language", values_callable=enum_values),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CodingSubmissionStatus] = mapped_column(
        Enum(
            CodingSubmissionStatus,
            name="coding_submission_status",
            values_callable=enum_values,
        ),
        nullable=False,
        index=True,
    )
    passed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    runtime_ms: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    problem: Mapped["CodingProblem"] = relationship(back_populates="submissions")
