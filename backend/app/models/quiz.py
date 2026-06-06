"""Quiz engine models (F3)."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models._enum_helper import enum_values


class Difficulty(str, enum.Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class QuestionType(str, enum.Enum):
    MCQ = "mcq"
    SHORT_ANSWER = "short_answer"


class Quiz(Base):
    __tablename__ = "quizzes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[Difficulty] = mapped_column(
        Enum(Difficulty, name="quiz_difficulty", values_callable=enum_values),
        default=Difficulty.MEDIUM,
        nullable=False,
    )
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer)
    # Source-of-truth for per-attempt duration. Lets the teacher set down to
    # seconds (e.g. 30s pop quiz). Old rows fall back to time_limit_minutes
    # in the response builders.
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer)
    # Time window during which students can take this quiz. NULL = no bound.
    # Both bounds are stored timezone-aware (UTC). The frontend renders in
    # local timezone.
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    questions: Mapped[list["Question"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan", order_by="Question.order_index"
    )
    attempts: Mapped[list["QuizAttempt"]] = relationship(
        back_populates="quiz", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    quiz_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, name="question_type", values_callable=enum_values),
        default=QuestionType.MCQ,
        nullable=False,
    )
    options: Mapped[list | None] = mapped_column(JSON)  # for MCQ: ["A", "B", "C", "D"]
    correct_answer: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[Difficulty] = mapped_column(
        Enum(Difficulty, name="question_difficulty", values_callable=enum_values),
        default=Difficulty.MEDIUM,
        nullable=False,
    )
    topic: Mapped[str | None] = mapped_column(String(255))  # for weak area detection

    quiz: Mapped["Quiz"] = relationship(back_populates="questions")


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    quiz_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False)
    time_taken_seconds: Mapped[int | None] = mapped_column(Integer)
    # answers: list of {question_id, student_answer, is_correct}
    answers: Mapped[list | None] = mapped_column(JSON)
    # Weak topic detection bit vector for Hamming distance checker (F23)
    answer_bit_vector: Mapped[str | None] = mapped_column(String(500))
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    quiz: Mapped["Quiz"] = relationship(back_populates="attempts")


class QuestionFlag(Base):
    """A student-raised flag on a single question.

    Used when a student thinks a question is broken (typo, no correct option,
    ambiguous). Teachers see the count + reasons so they can fix or drop it.

    Rules:
      - One flag per (student, question) — enforced by UniqueConstraint.
        Re-flagging "updates" the reason; the service does an upsert.
      - During the quiz: always allowed.
      - After the student submits: allowed for 3 days from `completed_at`,
        enforced in the service (not the model).
    """

    __tablename__ = "question_flags"
    __table_args__ = (
        UniqueConstraint("question_id", "student_id", name="uq_question_flag_per_student"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    question_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
