"""Chat endpoints — sessions + streaming AI responses (Phase 9, F2)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import limiter
from app.models.chat import ChatType
from app.models.user import UserRole
from app.schemas.chat import (
    ChatMessageRequest,
    ChatMessageResponse,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionWithMessages,
    SourceCitation,
)
from app.services import ai_chat, dsa_coach
from app.services import chat as chat_service

router = APIRouter()


def _to_session_response(session) -> ChatSessionResponse:
    return ChatSessionResponse(
        id=session.id,
        user_id=session.user_id,
        chat_type=session.chat_type.value,
        subject_id=session.subject_id,
        coding_problem_id=session.coding_problem_id,
        title=session.title,
        created_at=session.created_at,
        last_message_at=session.last_message_at,
    )


def _to_message_response(message) -> ChatMessageResponse:
    citations: list[SourceCitation] | None = None
    if message.source_citations:
        citations = [SourceCitation(**c) for c in message.source_citations]
    # `assistant_meta` is the loose-typed bag where Note Assistant rows stash
    # `{"mode": "..."}`. We only surface fields the client actually uses today.
    meta = message.assistant_meta or {}
    mode = meta.get("mode") if isinstance(meta, dict) else None
    return ChatMessageResponse(
        id=message.id,
        session_id=message.session_id,
        role=message.role.value,
        content=message.content,
        source_citations=citations,
        mode=mode,
        created_at=message.created_at,
    )


# ═══════════════════════════════════════════════════════════════
# Session CRUD
# ═══════════════════════════════════════════════════════════════

@router.get(
    "/sessions",
    response_model=list[ChatSessionResponse],
    summary="List the current user's chat sessions (newest first)",
)
def list_sessions(
    db: DbSession,
    current_user: CurrentUser,
    chat_type: str = "note_assistant",
    subject_id: uuid.UUID | None = None,
    coding_problem_id: uuid.UUID | None = None,
) -> list[ChatSessionResponse]:
    try:
        chat_type_enum = ChatType(chat_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid chat_type: {chat_type}")

    sessions = chat_service.list_sessions(
        db,
        current_user,
        chat_type_enum,
        subject_id=subject_id,
        coding_problem_id=coding_problem_id,
    )
    return [_to_session_response(s) for s in sessions]


@router.post(
    "/sessions",
    response_model=ChatSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new chat session",
)
def create_session(
    data: ChatSessionCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> ChatSessionResponse:
    chat_type = ChatType(data.chat_type)
    if chat_type == ChatType.ADMIN_KNOWLEDGE and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can use the Knowledge Editor chat.",
        )
    session = chat_service.create_session(
        db,
        user=current_user,
        chat_type=chat_type,
        subject_id=data.subject_id,
        coding_problem_id=data.coding_problem_id,
        title=data.title,
    )
    return _to_session_response(session)


@router.get(
    "/sessions/{session_id}",
    response_model=ChatSessionWithMessages,
    summary="Get a session with all of its messages",
)
def get_session(
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> ChatSessionWithMessages:
    session = chat_service.get_session(db, session_id, current_user, eager_messages=True)
    return ChatSessionWithMessages(
        id=session.id,
        user_id=session.user_id,
        chat_type=session.chat_type.value,
        subject_id=session.subject_id,
        coding_problem_id=session.coding_problem_id,
        title=session.title,
        created_at=session.created_at,
        last_message_at=session.last_message_at,
        messages=[_to_message_response(m) for m in session.messages],
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a chat session and its messages",
)
def delete_session(
    session_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    chat_service.delete_session(db, session_id, current_user)


# ═══════════════════════════════════════════════════════════════
# Streaming RAG message endpoint
# ═══════════════════════════════════════════════════════════════

@router.post(
    "/sessions/{session_id}/messages",
    summary="Send a user message and stream the assistant's RAG response",
    response_class=StreamingResponse,
)
@limiter.limit("30/minute")
def send_message(
    request: Request,
    session_id: uuid.UUID,
    data: ChatMessageRequest,
    db: DbSession,
    current_user: CurrentUser,
):
    """Send a message to a chat session.

    Returns a `text/event-stream` (SSE-style) stream of plain text deltas.
    The frontend can append each chunk as it arrives. Once the stream ends,
    the assistant message is fully persisted with its source citations — a
    follow-up GET /sessions/{id} will return the complete history.
    """
    session = chat_service.get_session(db, session_id, current_user)

    # Subject scope: prefer the per-message override, fall back to the session
    effective_subject_id = data.subject_id or session.subject_id
    is_coach = session.chat_type == ChatType.DSA_COACH

    def event_stream():
        # The generator captures the db session via closure. Because FastAPI's
        # `Depends(get_db)` closes the session after the response is built,
        # we need to keep using it inside the generator — which works because
        # StreamingResponse is consumed before the dependency yields.
        if is_coach:
            # DSA Coach: Socratic hint ladder / solution, no RAG.
            stream = dsa_coach.stream_coach_response(
                db,
                user=current_user,
                session=session,
                user_message_text=data.content,
                coach_mode=data.coach_mode,
                hint_level=data.hint_level,
            )
        else:
            stream = ai_chat.stream_rag_response(
                db,
                user=current_user,
                session=session,
                user_message_text=data.content,
                subject_id=effective_subject_id,
                mode=data.mode,
            )
        for delta in stream:
            yield delta

    return StreamingResponse(event_stream(), media_type="text/plain; charset=utf-8")


@router.post(
    "/sessions/{session_id}/messages/blocking",
    response_model=ChatMessageResponse,
    summary="Non-streaming version of /messages — returns the full assistant reply at once",
)
@limiter.limit("30/minute")
def send_message_blocking(
    request: Request,
    session_id: uuid.UUID,
    data: ChatMessageRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ChatMessageResponse:
    session = chat_service.get_session(db, session_id, current_user)
    effective_subject_id = data.subject_id or session.subject_id

    ai_chat.answer_question_blocking(
        db,
        user=current_user,
        session=session,
        user_message_text=data.content,
        subject_id=effective_subject_id,
        mode=data.mode,
    )
    # Return the freshly-persisted assistant message
    messages = chat_service.list_messages(db, session)
    last = messages[-1]
    return _to_message_response(last)
