"""Authentication endpoints: POST /signup, POST /login, GET /me + account mgmt."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.auth import (
    LoginRequest,
    PasswordChangeRequest,
    SignupRequest,
    SimpleMessage,
    StudentProfileUpdate,
    TeacherProfileUpdate,
    TokenResponse,
    UserResponse,
)
from app.services import auth as auth_service

router = APIRouter()


@router.post(
    "/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new user account",
)
def signup(data: SignupRequest, db: DbSession) -> TokenResponse:
    """Create a new user (student / teacher / admin) and return a JWT.

    Role-specific profile fields:
    - `student`: branch, semester, cgpa
    - `teacher`: department_name, designation
    - `admin`: no extra fields
    """
    return auth_service.signup(db, data)


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login with email and password",
)
def login(data: LoginRequest, db: DbSession) -> TokenResponse:
    """Verify credentials and return a JWT."""
    return auth_service.login(db, data)


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get the currently authenticated user",
)
def me(current_user: CurrentUser) -> UserResponse:
    """Return the user associated with the `Authorization: Bearer <token>` header."""
    return UserResponse.model_validate(current_user)


@router.patch(
    "/me/password",
    response_model=SimpleMessage,
    summary="Change the current user's password",
)
def change_password(
    data: PasswordChangeRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> SimpleMessage:
    """Verify current password and replace with new one."""
    auth_service.change_password(db, current_user, data.current_password, data.new_password)
    return SimpleMessage(detail="Password updated")


@router.patch(
    "/me/profile",
    response_model=UserResponse,
    summary="Update the student profile for the current user",
)
def update_profile(
    data: StudentProfileUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> UserResponse:
    """Patch the StudentProfile fields. Only present keys are written."""
    updates = data.model_dump(exclude_unset=True)
    updated_user = auth_service.update_student_profile(db, current_user, updates)
    return UserResponse.model_validate(updated_user)


@router.patch(
    "/me/teacher-profile",
    response_model=UserResponse,
    summary="Update the teacher profile for the current user",
)
def update_teacher_profile(
    data: TeacherProfileUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> UserResponse:
    """Patch the TeacherProfile fields. Only present keys are written."""
    updates = data.model_dump(exclude_unset=True)
    updated_user = auth_service.update_teacher_profile(db, current_user, updates)
    return UserResponse.model_validate(updated_user)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete (deactivate) the current user's account",
)
def delete_account(
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Mark the account inactive. Preserves related rows; user can no longer log in."""
    auth_service.deactivate_account(db, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
