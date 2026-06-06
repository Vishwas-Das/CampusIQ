"""Resume Builder endpoints (Phase 14, F6)."""
from __future__ import annotations

from fastapi import APIRouter, Request, status

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import limiter
from app.schemas.resume import (
    ATSScoreRequest,
    ATSScoreResponse,
    GitHubImportRequest,
    GitHubImportResponse,
    ResumeChatHistory,
    ResumeChatRequest,
    ResumeChatResponse,
    ResumeContentUpdate,
    ResumeResponse,
)
from app.services import resume_builder

router = APIRouter()


@router.get(
    "/me",
    response_model=ResumeResponse,
    summary="Get my resume (auto-creates an empty one on first call)",
)
def get_my_resume(db: DbSession, current_user: CurrentUser) -> ResumeResponse:
    return resume_builder.fetch_resume(db, current_user)


@router.patch(
    "/me",
    response_model=ResumeResponse,
    summary="Manually replace my resume content (and optionally template)",
)
def update_my_resume(
    data: ResumeContentUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> ResumeResponse:
    return resume_builder.replace_content(
        db,
        current_user,
        new_content=data.content,
        new_template=data.template,
    )


@router.get(
    "/me/messages",
    response_model=ResumeChatHistory,
    summary="Resume Coach chat history",
)
def get_resume_chat_history(
    db: DbSession, current_user: CurrentUser
) -> ResumeChatHistory:
    return resume_builder.get_chat_history(db, current_user)


@router.delete(
    "/me/messages",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Reset Resume Coach chat history",
)
def reset_resume_chat_history(
    db: DbSession, current_user: CurrentUser
) -> None:
    resume_builder.reset_chat_history(db, current_user)


@router.post(
    "/me/chat",
    response_model=ResumeChatResponse,
    summary="Send a message to the Resume Coach (one turn, returns updated content)",
)
@limiter.limit("20/hour")
def chat_with_coach(
    request: Request,
    data: ResumeChatRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ResumeChatResponse:
    result = resume_builder.chat_step(db, current_user, data.message)
    return ResumeChatResponse(
        ai_message=result.ai_message,
        content=result.content,
        patch_applied=result.patch_applied,
    )


@router.post(
    "/me/ats-score",
    response_model=ATSScoreResponse,
    summary="Score my resume against a pasted job description",
)
@limiter.limit("20/hour")
def score_against_jd(
    request: Request,
    data: ATSScoreRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ATSScoreResponse:
    return resume_builder.score_against_jd(
        db, current_user, job_description=data.job_description
    )


@router.post(
    "/me/import-github",
    response_model=GitHubImportResponse,
    summary="Import the user's top public GitHub repos as resume projects",
)
def import_github(
    data: GitHubImportRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> GitHubImportResponse:
    imported, content = resume_builder.import_github_projects(
        db,
        current_user,
        username=data.username,
        top_n=data.top_n,
    )
    return GitHubImportResponse(
        username=data.username,
        imported_count=len(imported),
        projects=imported,
        content=content,
    )
