"""Authentication service: signup, login, get current user."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import StudentProfile, TeacherProfile, User, UserRole
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserResponse


def _user_with_profiles_query():
    """SELECT for User with both profiles eager-loaded."""
    return (
        select(User)
        .options(
            selectinload(User.student_profile),
            selectinload(User.teacher_profile),
        )
    )


def get_user_by_email(db: Session, email: str) -> User | None:
    stmt = _user_with_profiles_query().where(User.email == email.lower())
    return db.scalar(stmt)


def get_user_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    stmt = _user_with_profiles_query().where(User.id == user_id)
    return db.scalar(stmt)


def signup(db: Session, data: SignupRequest) -> TokenResponse:
    """Create a new user + role-specific profile, return a JWT."""
    # Check email uniqueness
    existing = db.scalar(select(User).where(User.email == data.email.lower()))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    # Create the user
    user = User(
        email=data.email.lower(),
        full_name=data.full_name.strip(),
        role=UserRole(data.role),
        hashed_password=hash_password(data.password),
        is_active=True,
    )
    db.add(user)
    db.flush()  # populate user.id

    # Create the role-specific profile
    if data.role == "student":
        profile = StudentProfile(
            user_id=user.id,
            branch=data.branch,
            semester=data.semester,
            cgpa=data.cgpa,
        )
        db.add(profile)
    elif data.role == "teacher":
        profile = TeacherProfile(
            user_id=user.id,
            department_name=data.department_name,
            designation=data.designation,
        )
        db.add(profile)
    # admin has no extra profile table

    user.last_login = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    # Eager-load profiles for the response
    user = get_user_by_id(db, user.id)
    return _build_token_response(user)


def login(db: Session, data: LoginRequest) -> TokenResponse:
    """Verify credentials and return a JWT."""
    user = get_user_by_email(db, data.email)

    # Constant-time behaviour: always run verify_password even if user missing
    if user is None:
        # Verify against a dummy hash so timing doesn't leak existence
        verify_password(data.password, "$2b$12$" + "x" * 53)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive. Contact your administrator.",
        )

    user.last_login = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    return _build_token_response(user)


def change_password(db: Session, user: User, current: str, new: str) -> None:
    """Verify current password, then store hash of new one."""
    if not verify_password(current, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if verify_password(new, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current one",
        )
    user.hashed_password = hash_password(new)
    db.commit()


def update_student_profile(db: Session, user: User, updates: dict) -> User:
    """Patch the StudentProfile row for this user. Students only.

    `updates` is a dict of field → value (only keys present are written;
    None values explicitly clear the column).
    """
    if user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Academic profile is only for student accounts",
        )
    if user.student_profile is None:
        # Defensive — signup should have created it. Create on-the-fly if missing.
        from app.models.user import StudentProfile
        profile = StudentProfile(user_id=user.id)
        db.add(profile)
        db.flush()
        user.student_profile = profile

    for field, value in updates.items():
        setattr(user.student_profile, field, value)
    db.commit()
    return get_user_by_id(db, user.id)


def update_teacher_profile(db: Session, user: User, updates: dict) -> User:
    """Patch the TeacherProfile row for this user. Teachers only."""
    if user.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher profile is only for teacher accounts",
        )
    if user.teacher_profile is None:
        profile = TeacherProfile(user_id=user.id)
        db.add(profile)
        db.flush()
        user.teacher_profile = profile

    for field, value in updates.items():
        setattr(user.teacher_profile, field, value)
    db.commit()
    return get_user_by_id(db, user.id)


def deactivate_account(db: Session, user: User) -> None:
    """Soft-delete: mark the user inactive. Preserves their content for
    teacher analytics / community continuity. Inactive users cannot log in
    (login() raises 403 when is_active is False)."""
    user.is_active = False
    db.commit()


def _build_token_response(user: User) -> TokenResponse:
    """Create the JWT + wrap in a TokenResponse."""
    from app.core.config import get_settings
    settings = get_settings()

    token = create_access_token(
        subject=user.id,
        extra_claims={
            "role": user.role.value,
            "email": user.email,
        },
    )

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in_seconds=settings.jwt_expire_minutes * 60,
        user=UserResponse.model_validate(user),
    )
