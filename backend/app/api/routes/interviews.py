"""Mock Interview endpoints (Phase 16 text mode, Phase 20 voice mode)."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import limiter
from app.models.placement import InterviewMode, InterviewPersona
from app.schemas.mock_interview import (
    InterviewMessageRequest,
    InterviewSessionListRow,
    InterviewSessionResponse,
    InterviewStartRequest,
    InterviewTurnResponse,
    InterviewVoiceTurnResponse,
    VoiceCapabilitiesResponse,
)
from app.services import mock_interview, speech

router = APIRouter()


def _parse_persona(value: str) -> InterviewPersona:
    try:
        return InterviewPersona(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid persona: {value}") from e


def _parse_mode(value: str) -> InterviewMode:
    try:
        return InterviewMode(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {value}") from e


@router.post(
    "/",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a new 5-round mock interview session",
)
def start_interview(
    data: InterviewStartRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> InterviewSessionResponse:
    session = mock_interview.create_session(
        db,
        current_user,
        company_target=data.company_target,
        role_target=data.role_target,
        interviewer_persona=_parse_persona(data.interviewer_persona),
        mode=_parse_mode(data.mode),
    )
    return mock_interview._to_session_response(session)


@router.get(
    "/me",
    response_model=list[InterviewSessionListRow],
    summary="Student: list my mock interview sessions",
)
def list_my_sessions(
    db: DbSession, current_user: CurrentUser
) -> list[InterviewSessionListRow]:
    sessions = mock_interview.list_sessions_for_student(db, current_user)
    return [
        InterviewSessionListRow.model_validate(s, from_attributes=True)
        for s in sessions
    ]


@router.get(
    "/{session_id}",
    response_model=InterviewSessionResponse,
    summary="Get a single interview session (transcript + scores)",
)
def get_interview(
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> InterviewSessionResponse:
    return mock_interview.fetch_session(db, session_id, current_user)


@router.post(
    "/{session_id}/messages",
    response_model=InterviewTurnResponse,
    summary="Submit a candidate answer and get the interviewer's next turn",
)
@limiter.limit("30/minute")
def submit_message(
    request: Request,
    session_id: uuid.UUID,
    data: InterviewMessageRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> InterviewTurnResponse:
    result = mock_interview.student_turn(db, current_user, session_id, data.content)
    return InterviewTurnResponse(
        session=mock_interview._to_session_response(result.session),
        assistant_message=result.assistant_message,
        round_transitioned=result.round_transitioned,
        interview_completed=result.interview_completed,
    )


@router.post(
    "/{session_id}/end",
    response_model=InterviewSessionResponse,
    summary="Force-end the interview early and generate the debrief",
)
def end_interview(
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> InterviewSessionResponse:
    session = mock_interview.end_session(db, session_id, current_user)
    return mock_interview._to_session_response(session)


# ═══════════════════════════════════════════════════════════════════
# Voice mode — Phase 20
# ═══════════════════════════════════════════════════════════════════


@router.get(
    "/voice/capabilities",
    response_model=VoiceCapabilitiesResponse,
    summary="Check whether Whisper + ElevenLabs are configured",
)
def voice_capabilities() -> VoiceCapabilitiesResponse:
    return VoiceCapabilitiesResponse(
        asr_available=speech.is_asr_available(),
        tts_available=speech.is_tts_available(),
        voice_by_round=speech.VOICE_BY_ROUND,
    )


@router.post(
    "/{session_id}/voice",
    response_model=InterviewVoiceTurnResponse,
    summary="Submit an audio answer (webm/wav/mp3) and get an audio reply",
)
@limiter.limit("30/minute")
async def submit_voice_turn(
    request: Request,
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    # Audio is now OPTIONAL. When the browser uses webkitSpeechRecognition
    # (Chrome / Edge), the frontend skips MediaRecorder entirely to avoid
    # the audio-only `getUserMedia` stealing the stream from SR. In that
    # path only `browser_transcript` is sent and we don't need the audio.
    audio: Annotated[UploadFile | None, File(description="Optional spoken answer")] = None,
    browser_transcript: Annotated[str | None, Form()] = None,
) -> InterviewVoiceTurnResponse:
    audio_bytes = b""
    if audio is not None:
        audio_bytes = await audio.read()

    # Require at least ONE source. If neither audio bytes nor a browser
    # transcript came through, there's nothing to grade.
    if not audio_bytes and not (browser_transcript and browser_transcript.strip()):
        raise HTTPException(
            status_code=400,
            detail="Submit an audio file OR a browser-side transcript.",
        )

    result = mock_interview.voice_turn(
        db,
        current_user,
        session_id,
        audio_bytes,
        transcript_override=browser_transcript,
    )
    return InterviewVoiceTurnResponse(
        session=mock_interview._to_session_response(result.session),
        assistant_message=result.assistant_message,
        round_transitioned=result.round_transitioned,
        interview_completed=result.interview_completed,
        transcribed_text=result.transcribed_text,
        assistant_audio_url=result.assistant_audio_url,
        assistant_voice_id=result.assistant_voice_id,
    )
