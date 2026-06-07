"""Pydantic schemas for chat endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ChatTypeLiteral = Literal[
    "note_assistant",
    "college_gpt",
    "placement_chatbot",
    "resume_builder",
    "admin_knowledge",
    "dsa_coach",
]
MessageRoleLiteral = Literal["user", "assistant", "system"]
# Note Assistant response modes — picked per-message by the student.
NoteAssistantModeLiteral = Literal["explain", "diagram", "questions"]
# DSA Coach modes + hint-ladder intensity. The coach starts at "nudge" and
# escalates toward "spell_it_out" as the student keeps asking for hints.
CoachModeLiteral = Literal["hint", "solution"]
HintLevelLiteral = Literal["nudge", "guide", "spell_it_out"]


class SourceCitation(BaseModel):
    """A single citation pointing back to a document chunk."""

    document_id: str
    document_title: str
    subject_code: str
    subject_name: str
    chunk_index: int
    similarity: float


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    role: MessageRoleLiteral
    content: str
    source_citations: list[SourceCitation] | None = None
    # Mode the assistant rendered in (None for legacy rows + non-note-assistant chats).
    mode: NoteAssistantModeLiteral | None = None
    created_at: datetime


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    chat_type: ChatTypeLiteral
    subject_id: uuid.UUID | None = None
    coding_problem_id: uuid.UUID | None = None
    title: str | None = None
    created_at: datetime
    last_message_at: datetime


class ChatSessionWithMessages(ChatSessionResponse):
    messages: list[ChatMessageResponse] = []


class ChatSessionCreate(BaseModel):
    chat_type: ChatTypeLiteral = "note_assistant"
    subject_id: uuid.UUID | None = None
    coding_problem_id: uuid.UUID | None = None  # for DSA coach sessions
    title: str | None = Field(None, max_length=255)


class ChatMessageRequest(BaseModel):
    """Body of POST /chat/sessions/{id}/messages."""

    content: str = Field(..., min_length=1, max_length=8000)
    subject_id: uuid.UUID | None = None  # for ad-hoc subject scoping
    stream: bool = True
    # Only meaningful for Note Assistant sessions; ignored elsewhere.
    mode: NoteAssistantModeLiteral | None = "explain"
    # Only meaningful for DSA Coach sessions; ignored elsewhere.
    coach_mode: CoachModeLiteral | None = "hint"
    hint_level: HintLevelLiteral | None = "nudge"
