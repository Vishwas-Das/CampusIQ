"""Confidence Coach endpoints (Phase 20, F11)."""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import limiter
from app.models.gamification import XPEventType
from app.models.placement import ConfidenceSession
from app.models.user import UserRole
from app.schemas.confidence import (
    ConfidenceMetric,
    ConfidenceSessionResponse,
    ConfidenceTimelineResponse,
)
from app.services import confidence_coach, xp

router = APIRouter()


# Suggested prompts rotate through these so the student isn't answering the
# same behavioural question every session. Pulled from the cheatsheets most
# engineering teams screen on.
NEXT_PROMPTS: list[str] = [
    "Tell me about a time you led a team project.",
    "Describe a technical challenge you overcame recently.",
    "Walk me through your resume in 90 seconds.",
    "Why do you want to work at this company?",
    "Tell me about a time you disagreed with a teammate.",
    "What's the most interesting project you've built outside class?",
    "Explain a recent algorithm or data-structure you studied.",
    "How do you prioritise when everything feels urgent?",
]


def _require_student(current_user) -> None:
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confidence Coach is only available to students.",
        )


def _to_response(row: ConfidenceSession) -> ConfidenceSessionResponse:
    def _f(v) -> float | None:
        return float(v) if v is not None else None

    return ConfidenceSessionResponse(
        id=row.id,
        prompt=row.prompt,
        transcript=row.transcript,
        eye_contact_score=_f(row.eye_contact_score),
        posture_score=_f(row.posture_score),
        filler_word_count=row.filler_word_count,
        speaking_pace_wpm=row.speaking_pace_wpm,
        clarity_score=_f(row.clarity_score),
        overall_confidence_score=_f(row.overall_confidence_score),
        detailed_feedback=row.detailed_feedback,
        recorded_at=row.recorded_at,
    )


@router.post(
    "/sessions",
    response_model=ConfidenceSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Analyse a confidence-coach recording",
)
@limiter.limit("30/minute")
async def create_session(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
    audio: Annotated[UploadFile, File(description="Audio recording (webm/mp3/wav)")],
    prompt: Annotated[str, Form(..., min_length=1, max_length=600)],
    duration_seconds: Annotated[int, Form(..., ge=1, le=600)],
    eye_contact_pct: Annotated[float | None, Form(ge=0, le=100)] = None,
    posture_pct: Annotated[float | None, Form(ge=0, le=100)] = None,
    # Browser-generated transcript (Web Speech API) — optional override
    # that bypasses Whisper when the backend isn't configured. Saves cost
    # + works offline. See confidence_coach.analyse_recording docstring.
    browser_transcript: Annotated[str | None, Form()] = None,
) -> ConfidenceSessionResponse:
    _require_student(current_user)

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is empty")

    result = confidence_coach.analyse_recording(
        audio_bytes=audio_bytes,
        prompt=prompt,
        duration_seconds=duration_seconds,
        eye_contact_pct=eye_contact_pct,
        posture_pct=posture_pct,
        transcript_override=browser_transcript,
    )

    def _dec(v: float | None) -> Decimal | None:
        return Decimal(f"{v:.2f}") if v is not None else None

    row = ConfidenceSession(
        student_id=current_user.id,
        prompt=prompt,
        transcript=result.transcript or None,
        eye_contact_score=_dec(eye_contact_pct),
        posture_score=_dec(posture_pct),
        filler_word_count=result.filler_word_count,
        speaking_pace_wpm=result.speaking_pace_wpm,
        clarity_score=_dec(result.clarity.score),
        overall_confidence_score=_dec(result.overall_score),
        detailed_feedback=result.detailed_feedback,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # XP reward — scaled by overall score (no XP if we had no metrics to score)
    try:
        if result.overall_score is not None:
            bonus = 0.5 + result.overall_score / 100.0
            xp.award_xp(
                db,
                current_user,
                XPEventType.CONFIDENCE_SESSION,
                reference_id=row.id,
                bonus_multiplier=bonus,
            )
            db.commit()
    except Exception:
        # XP failures must never break the main flow
        db.rollback()

    return _to_response(row)


@router.get(
    "/sessions/me",
    response_model=ConfidenceTimelineResponse,
    summary="Timeline of my past confidence sessions",
)
def list_my_sessions(
    db: DbSession,
    current_user: CurrentUser,
) -> ConfidenceTimelineResponse:
    _require_student(current_user)

    rows = list(
        db.scalars(
            select(ConfidenceSession)
            .where(ConfidenceSession.student_id == current_user.id)
            .order_by(ConfidenceSession.recorded_at.desc())
            .limit(24)
        ).all()
    )

    metrics: list[ConfidenceMetric] = []
    for r in reversed(rows):  # chart expects chronological order
        metrics.append(
            ConfidenceMetric(
                recorded_at=r.recorded_at,
                overall_confidence_score=(
                    float(r.overall_confidence_score)
                    if r.overall_confidence_score is not None
                    else None
                ),
                eye_contact_score=(
                    float(r.eye_contact_score) if r.eye_contact_score is not None else None
                ),
                posture_score=(
                    float(r.posture_score) if r.posture_score is not None else None
                ),
                clarity_score=(
                    float(r.clarity_score) if r.clarity_score is not None else None
                ),
                speaking_pace_wpm=r.speaking_pace_wpm,
                filler_word_count=r.filler_word_count,
            )
        )

    latest = _to_response(rows[0]) if rows else None
    # Rotate prompts by the number of past sessions so the next recording
    # gets a fresh question every time.
    offset = len(rows) % len(NEXT_PROMPTS)
    rotated = NEXT_PROMPTS[offset:] + NEXT_PROMPTS[:offset]

    return ConfidenceTimelineResponse(
        sessions=metrics,
        latest=latest,
        next_prompts=rotated[:5],
    )


@router.get(
    "/sessions/{session_id}",
    response_model=ConfidenceSessionResponse,
    summary="Fetch a single confidence session",
)
def get_session(
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> ConfidenceSessionResponse:
    _require_student(current_user)
    row = db.get(ConfidenceSession, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Confidence session not found")
    if row.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="You don't own this session")
    return _to_response(row)
