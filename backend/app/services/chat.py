"""Chat session and message persistence.

Used by all chat features that share the same DB table:
- Note Assistant (Phase 9)  — chat_type=note_assistant, scoped to a subject
- CollegeGPT (Phase 10)     — chat_type=college_gpt
- Placement Chatbot (Phase 17) — chat_type=placement_chatbot
- Resume Builder chat (Phase 14) — chat_type=resume_builder
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.chat import ChatMessage, ChatSession, ChatType, MessageRole
from app.models.user import User


def list_sessions(
    db: Session,
    user: User,
    chat_type: ChatType,
    *,
    subject_id: uuid.UUID | None = None,
    coding_problem_id: uuid.UUID | None = None,
) -> list[ChatSession]:
    """All chat sessions belonging to the current user, newest first."""
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .where(ChatSession.chat_type == chat_type)
        .order_by(ChatSession.last_message_at.desc())
    )
    if subject_id is not None:
        stmt = stmt.where(ChatSession.subject_id == subject_id)
    if coding_problem_id is not None:
        stmt = stmt.where(ChatSession.coding_problem_id == coding_problem_id)
    return list(db.scalars(stmt).all())


def get_session(
    db: Session,
    session_id: uuid.UUID,
    user: User,
    *,
    eager_messages: bool = False,
) -> ChatSession:
    """Fetch a session by id, optionally eager-loading its messages."""
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    if eager_messages:
        stmt = stmt.options(selectinload(ChatSession.messages))

    session = db.scalar(stmt)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    if session.user_id != user.id:
        raise HTTPException(status_code=403, detail="You don't own this chat session")
    return session


def create_session(
    db: Session,
    user: User,
    chat_type: ChatType,
    *,
    subject_id: uuid.UUID | None = None,
    coding_problem_id: uuid.UUID | None = None,
    title: str | None = None,
) -> ChatSession:
    """Create a fresh chat session."""
    session = ChatSession(
        user_id=user.id,
        chat_type=chat_type,
        subject_id=subject_id,
        coding_problem_id=coding_problem_id,
        title=title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def add_message(
    db: Session,
    session: ChatSession,
    role: MessageRole,
    content: str,
    *,
    source_citations: list[dict] | None = None,
    assistant_meta: dict | None = None,
) -> ChatMessage:
    """Append a message to a session and bump `last_message_at`."""
    message = ChatMessage(
        session_id=session.id,
        role=role,
        content=content,
        source_citations=source_citations,
        assistant_meta=assistant_meta,
    )
    db.add(message)
    session.last_message_at = datetime.now(timezone.utc)

    # Auto-title from the first user message if the session has none
    if session.title is None and role == MessageRole.USER:
        title = content.strip().split("\n", 1)[0]
        session.title = title[:80]

    db.commit()
    db.refresh(message)
    return message


def list_messages(
    db: Session,
    session: ChatSession,
    *,
    limit: int | None = None,
) -> list[ChatMessage]:
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def delete_session(db: Session, session_id: uuid.UUID, user: User) -> None:
    session = get_session(db, session_id, user)
    db.delete(session)
    db.commit()


def history_for_prompt(messages: Iterable[ChatMessage]) -> list[dict]:
    """Convert ChatMessage rows into the {role, content} format Claude expects."""
    out: list[dict] = []
    for m in messages:
        if m.role == MessageRole.SYSTEM:
            continue  # system goes in a separate field
        out.append({"role": m.role.value, "content": m.content})
    return out
