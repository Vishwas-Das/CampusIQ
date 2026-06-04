"""Pydantic schemas for authentication endpoints."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


# ══════════════════════════════════════
# Signup — extended per role
# ══════════════════════════════════════

UserRoleLiteral = Literal["student", "teacher", "admin"]


class SignupRequest(BaseModel):
    """Base signup fields. Role-specific fields are optional here and
    the service layer decides which profile to create.
    """

    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=255)
    role: UserRoleLiteral

    # Student-specific (optional at signup, required for role=student)
    branch: str | None = Field(None, max_length=100)
    semester: int | None = Field(None, ge=1, le=8)
    cgpa: float | None = Field(None, ge=0, le=10)
    institution_name: str | None = Field(None, max_length=255)

    # Teacher-specific (optional at signup, required for role=teacher)
    department_name: str | None = Field(None, max_length=255)
    designation: str | None = Field(None, max_length=255)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if v.isdigit() or v.isalpha():
            raise ValueError("Password must contain letters and numbers")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class PasswordChangeRequest(BaseModel):
    """Body for PATCH /auth/me/password."""

    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if v.isdigit() or v.isalpha():
            raise ValueError("Password must contain letters and numbers")
        return v


class StudentProfileUpdate(BaseModel):
    """Partial update for /auth/me/profile. All fields optional — only the
    keys actually present in the request body are written."""

    model_config = ConfigDict(extra="ignore")

    branch: str | None = Field(None, max_length=100)
    semester: int | None = Field(None, ge=1, le=8)
    cgpa: float | None = Field(None, ge=0, le=10)
    github_url: str | None = Field(None, max_length=500)
    linkedin_url: str | None = Field(None, max_length=500)
    skills: list[str] | None = None
    target_companies: list[str] | None = None
    target_role: str | None = Field(None, max_length=100)


class TeacherProfileUpdate(BaseModel):
    """Partial update for /auth/me/teacher-profile. Teacher-only."""

    model_config = ConfigDict(extra="ignore")

    department_name: str | None = Field(None, max_length=255)
    designation: str | None = Field(None, max_length=255)


class SimpleMessage(BaseModel):
    detail: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in_seconds: int
    user: "UserResponse"


# ══════════════════════════════════════
# User response schemas
# ══════════════════════════════════════

class StudentProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    branch: str | None = None
    semester: int | None = None
    cgpa: float | None = None
    github_url: str | None = None
    linkedin_url: str | None = None
    skills: list | None = None
    target_companies: list | None = None
    target_role: str | None = None
    xp_total: int = 0
    current_level: int = 1
    streak_days: int = 0
    last_active_date: date | None = None


class TeacherProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department_name: str | None = None
    designation: str | None = None


class UserResponse(BaseModel):
    """Public user representation returned by /me and /login."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRoleLiteral
    is_active: bool = True
    college_id: uuid.UUID | None = None
    last_login: datetime | None = None
    created_at: datetime

    student_profile: StudentProfileResponse | None = None
    teacher_profile: TeacherProfileResponse | None = None


# rebuild forward reference
TokenResponse.model_rebuild()
