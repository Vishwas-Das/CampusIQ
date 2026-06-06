from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _enum_values(enum_cls):
    """Tell SQLAlchemy's Enum to send string VALUES, not Python enum NAMES."""
    return [e.value for e in enum_cls]


class UserRole(str, enum.Enum):
    STUDENT = "student"
    TEACHER = "teacher"
    ADMIN = "admin"


class College(Base):
    __tablename__ = "colleges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    users: Mapped[list["User"]] = relationship(back_populates="college")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", values_callable=_enum_values),
        index=True,
        nullable=False,
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    college_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("colleges.id", ondelete="SET NULL"), nullable=True, index=True
    )
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    college: Mapped["College | None"] = relationship(back_populates="users")
    student_profile: Mapped["StudentProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    teacher_profile: Mapped["TeacherProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    # `Subject` has two FKs into users.id (teacher_id + owner_student_id),
    # so we pin which one this collection follows.
    owned_subjects: Mapped[list["Subject"]] = relationship(
        back_populates="teacher",
        cascade="all, delete-orphan",
        passive_deletes=True,
        foreign_keys="Subject.teacher_id",
    )
    # `Document` has two FKs to users.id now (`uploaded_by_id` and the new
    # `owner_student_id` for NotebookLM-style private notes), so SQLAlchemy
    # needs the explicit foreign-key hint to know which one this collection
    # tracks. The matching hint on Document.uploaded_by is in the Document
    # class definition below.
    uploaded_documents: Mapped[list["Document"]] = relationship(
        back_populates="uploaded_by",
        cascade="all, delete-orphan",
        passive_deletes=True,
        foreign_keys="Document.uploaded_by_id",
    )


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # Academic info
    branch: Mapped[str | None] = mapped_column(String(100))
    semester: Mapped[int | None] = mapped_column(Integer)
    cgpa: Mapped[float | None] = mapped_column(Numeric(4, 2))
    # External profiles
    github_url: Mapped[str | None] = mapped_column(String(500))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    # Skills and targets (JSON arrays)
    skills: Mapped[list | None] = mapped_column(JSON, default=list)
    target_companies: Mapped[list | None] = mapped_column(JSON, default=list)
    target_role: Mapped[str | None] = mapped_column(String(255))
    # Gamification
    xp_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    streak_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_active_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="student_profile")


class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    department_name: Mapped[str | None] = mapped_column(String(255))
    designation: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="teacher_profile")


# ── Subject + Document live here for now (single source of truth for backrefs) ──
class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # teacher_id is the canonical owner. For a teacher-created (public) subject
    # it's the teacher's id and owner_student_id stays NULL. For a student's
    # personal subject (NotebookLM-style), teacher_id = student.id AND
    # owner_student_id = student.id — the second column is the visibility flag.
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    college_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("colleges.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(String(500))
    semester: Mapped[int | None] = mapped_column(Integer)
    branch: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Two FKs to users.id (teacher_id + owner_student_id) → SQLAlchemy needs
    # the explicit foreign_keys hint to know which one this relationship rides.
    teacher: Mapped["User"] = relationship(
        back_populates="owned_subjects", foreign_keys=[teacher_id]
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="subject",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @property
    def is_private(self) -> bool:
        """True iff this subject is a student's personal notebook."""
        return self.owner_student_id is not None


class DocumentStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # NotebookLM-style visibility:
    #   NULL → public document (uploaded by a teacher/admin, visible to anyone
    #          who can see the subject — current behaviour).
    #   non-NULL → private personal note, only visible to that student.
    # When the owner is deleted the row goes too (matching uploaded_by_id).
    owner_student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    file_name: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str | None] = mapped_column(String(100))
    file_size_bytes: Mapped[int | None] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(String)
    # Teacher-supplied metadata (Phase 7 enhancement). When set, `chapter`
    # also becomes the default filename when a student downloads the doc.
    chapter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    processing_status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus, name="document_status", values_callable=_enum_values),
        default=DocumentStatus.PENDING,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    subject: Mapped["Subject"] = relationship(back_populates="documents")
    uploaded_by: Mapped["User"] = relationship(
        back_populates="uploaded_documents", foreign_keys=[uploaded_by_id]
    )
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )

    @property
    def is_private(self) -> bool:
        """True iff this document belongs to a single student's personal notes."""
        return self.owner_student_id is not None
