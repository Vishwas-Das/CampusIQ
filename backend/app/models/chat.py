"""Chat session models (Note Assistant, CollegeGPT, Placement Chatbot)."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models._enum_helper import enum_values


class ChatType(str, enum.Enum):
    NOTE_ASSISTANT = "note_assistant"
    COLLEGE_GPT = "college_gpt"
    PLACEMENT_CHATBOT = "placement_chatbot"
    RESUME_BUILDER = "resume_builder"
    # Admin-only conversation that proposes edits to college document chunks.
    ADMIN_KNOWLEDGE = "admin_knowledge"
    # Socratic DSA coach — a hint-ladder tutor bound to a single coding problem.
    DSA_COACH = "dsa_coach"


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_type: Mapped[ChatType] = mapped_column(
        Enum(ChatType, name="chat_type", values_callable=enum_values),
        nullable=False,
        index=True,
    )
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    # For DSA coach sessions: the coding problem this conversation is bound to.
    # SET NULL (not CASCADE) so deleting a seed problem doesn't wipe the chat.
    coding_problem_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("coding_problems.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[MessageRole] = mapped_column(
        Enum(MessageRole, name="message_role", values_callable=enum_values),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Source citations: list of {document_id, chunk_index, title} for assistant messages
    source_citations: Mapped[list | None] = mapped_column(JSON)
    # Loose-typed bag for assistant-message metadata. Currently only stores
    # `{"mode": "explain"|"diagram"|"questions"}` for Note Assistant rows so the
    # renderer knows which structured-output parser to use on history.
    assistant_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")
