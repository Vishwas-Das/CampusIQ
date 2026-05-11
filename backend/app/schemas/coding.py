"""Pydantic schemas for the coding-practice endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CodingDifficultyLiteral = Literal["easy", "medium", "hard"]
CodingLanguageLiteral = Literal["python", "cpp", "java"]
CodingSubmissionStatusLiteral = Literal["passed", "failed", "error"]
# Per-user view of a problem in the list. "solved" beats "attempted" beats "unsolved".
UserProblemStatus = Literal["solved", "attempted", "unsolved"]


class ProblemExample(BaseModel):
    """A worked example shown in the problem statement — input/output pair
    plus a brief explanation. Three to five per problem is the norm."""

    input: str  # human-readable, e.g. 'nums = [2,7,11,15], target = 9'
    output: str  # human-readable, e.g. '[0,1]'
    explanation: str | None = None


class CodingTestCase(BaseModel):
    """One test case fed to the runner. `input` is a list of positional args
    matching the user's function signature."""

    input: list  # positional args (any JSON-encodable types)
    expected: object  # expected return value


class FunctionSignature(BaseModel):
    params: list[dict] = Field(default_factory=list)  # [{"name":"nums","type":"list[int]"}]
    returns: str | None = None  # "list[int]"


class ProblemListItem(BaseModel):
    """Row in /coding/problems. Intentionally lightweight — no test cases or
    reference solution."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    difficulty: CodingDifficultyLiteral
    topic_tags: list[str]
    user_status: UserProblemStatus = "unsolved"


class ProblemDetail(BaseModel):
    """Full problem record for the detail page. Excludes `hidden_test_cases`
    (those come from the separate runner endpoint) and excludes
    `reference_solution` unless the caller has already AC'd."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    description: str
    difficulty: CodingDifficultyLiteral
    function_name: str
    function_signature: FunctionSignature
    examples: list[ProblemExample]
    hints: list[str]
    starter_code: dict[str, str]  # language → source
    reference_solution: dict[str, str] | None = None  # only when user has solved
    visible_test_cases: list[CodingTestCase]
    comparator: str
    topic_tags: list[str]
    skill_node_names: list[str]
    user_status: UserProblemStatus = "unsolved"


class ProblemRunnerPayload(BaseModel):
    """Returned by /coding/problems/{slug}/runner — visible + hidden test cases
    bundled, used by the client to execute Submit. Auth-gated to students."""

    model_config = ConfigDict(from_attributes=True)

    function_name: str
    visible_test_cases: list[CodingTestCase]
    hidden_test_cases: list[CodingTestCase]
    comparator: str


class SubmitRequest(BaseModel):
    """POSTed after the client has finished running all tests in Pyodide."""

    language: CodingLanguageLiteral = "python"
    code: str = Field(..., min_length=1, max_length=50_000)
    status: CodingSubmissionStatusLiteral
    passed_count: int = Field(..., ge=0)
    total_count: int = Field(..., ge=0)
    runtime_ms: int | None = Field(default=None, ge=0)
    error_message: str | None = Field(default=None, max_length=10_000)


class SubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    problem_id: uuid.UUID
    language: CodingLanguageLiteral
    code: str
    status: CodingSubmissionStatusLiteral
    passed_count: int
    total_count: int
    runtime_ms: int | None = None
    error_message: str | None = None
    submitted_at: datetime


class SubmitResultResponse(BaseModel):
    """Returned by POST /submit — combines the new submission row with whether
    this attempt was the user's first AC (the trigger for mastery+XP)."""

    submission: SubmissionResponse
    first_solve: bool
    xp_earned: int = 0
    new_level: int | None = None
    leveled_up: bool = False


class CodingStatsResponse(BaseModel):
    solved_easy: int
    solved_medium: int
    solved_hard: int
    total_problems: int
    total_submissions: int
    streak_days: int
