"""Document service: upload, list, retrieve, delete."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import Announcement, AnnouncementTarget, DocumentChunk
from app.models.user import Document, DocumentStatus, Subject, User, UserRole
from app.schemas.document import (
    CompressionStats,
    DocumentChunkPreview,
    DocumentResponse,
    DocumentWithSubject,
)

# ── Config ──
# Uploads are stored at <repo>/backend/uploads/{subject_id}/{file_uuid}_{filename}.
# This is a local-disk solution for Phase 6 — Supabase Storage migration happens later.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]  # backend/
UPLOAD_ROOT = _BACKEND_ROOT / "uploads"
ALLOWED_CONTENT_TYPES: set[str] = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # .pptx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
    "application/rtf",
    "text/rtf",
    "text/html",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    # Some browsers leave content_type empty for direct file picks — we still
    # accept those because we re-validate by extension below.
    "",
}
# Legacy binary Office formats (.doc, .ppt, .xls) are deliberately excluded —
# they need LibreOffice/pywin32 to convert, which is not in this stack. Users
# should "Save As" → modern XML format before upload.
ALLOWED_EXTENSIONS: set[str] = {
    ".pdf",
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
    ".rtf",
    ".txt",
    ".md",
}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


def _ensure_upload_dir() -> None:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _resolve_subject_for_upload(db: Session, subject_id: uuid.UUID, user: User) -> Subject:
    """Validate that `user` is allowed to upload a document under `subject_id`.

    - Teachers can only upload to subjects they own.
    - Admins can upload to any subject.
    - Students can upload personal notes to any subject (notebookLM-style);
      the resulting document is automatically scoped to that student.
    """
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    if user.role == UserRole.TEACHER and subject.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="You don't own this subject")
    if user.role not in (UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="You can't upload to this subject")
    return subject


def _can_view_document(document: Document, user: User) -> bool:
    """Visibility predicate used by list / get / chunks / RAG paths.

    - Admins see everything.
    - Teachers see public docs of their own subjects (no peeks at private notes).
    - Students see public docs (any subject they can read) + their own private notes.
    """
    if user.role == UserRole.ADMIN:
        return True
    if user.role == UserRole.TEACHER:
        if document.owner_student_id is not None:
            return False  # private student note — never visible to teachers
        return document.subject.teacher_id == user.id if document.subject else False
    # STUDENT
    if document.owner_student_id is None:
        return True  # public doc — students can read any subject's public docs
    return document.owner_student_id == user.id


def _compression_stats_for(db: Session, document_id: uuid.UUID) -> CompressionStats:
    """Aggregate compression stats across a document's chunks."""
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .all()
    )
    if not chunks:
        return CompressionStats()

    original = sum(len(c.chunk_text.encode("utf-8")) for c in chunks)
    compressed = sum(len(c.compressed_text or b"") for c in chunks)
    savings = 0.0
    if original > 0:
        savings = round((1 - compressed / original) * 100, 2)

    return CompressionStats(
        original_bytes=original,
        compressed_bytes=compressed,
        savings_percent=savings,
        chunk_count=len(chunks),
    )


def _to_response(document: Document, *, db: Session | None = None) -> DocumentResponse:
    stats = _compression_stats_for(db, document.id) if db is not None else None
    return DocumentResponse(
        id=document.id,
        subject_id=document.subject_id,
        uploaded_by_id=document.uploaded_by_id,
        owner_student_id=document.owner_student_id,
        title=document.title,
        file_name=document.file_name,
        content_type=document.content_type,
        file_size_bytes=document.file_size_bytes,
        summary=document.summary,
        chapter=document.chapter,
        description=document.description,
        processing_status=document.processing_status.value,
        created_at=document.created_at,
        compression_stats=stats,
    )


def _to_response_with_subject(
    document: Document,
    subject: Subject,
    stats: CompressionStats | None = None,
) -> DocumentWithSubject:
    return DocumentWithSubject(
        id=document.id,
        subject_id=document.subject_id,
        uploaded_by_id=document.uploaded_by_id,
        owner_student_id=document.owner_student_id,
        title=document.title,
        file_name=document.file_name,
        content_type=document.content_type,
        file_size_bytes=document.file_size_bytes,
        summary=document.summary,
        chapter=document.chapter,
        description=document.description,
        processing_status=document.processing_status.value,
        created_at=document.created_at,
        subject_code=subject.code,
        subject_name=subject.name,
        compression_stats=stats,
    )


def list_documents(
    db: Session,
    user: User,
    *,
    subject_id: uuid.UUID | None = None,
) -> list[DocumentWithSubject]:
    """List documents respecting the visibility rules in `_can_view_document`."""
    from sqlalchemy import or_

    stmt = select(Document, Subject).join(Subject, Document.subject_id == Subject.id)

    if user.role == UserRole.TEACHER:
        # Teacher's own subjects' public docs only — never peek at private notes.
        stmt = stmt.where(Subject.teacher_id == user.id)
        stmt = stmt.where(Document.owner_student_id.is_(None))
    elif user.role == UserRole.STUDENT:
        # Public docs (any subject) + this student's own private notes.
        stmt = stmt.where(
            or_(
                Document.owner_student_id.is_(None),
                Document.owner_student_id == user.id,
            )
        )
    # admins: no scope filter — they see everything

    if subject_id is not None:
        stmt = stmt.where(Document.subject_id == subject_id)

    stmt = stmt.order_by(Document.created_at.desc())
    rows = db.execute(stmt).all()
    return [
        _to_response_with_subject(doc, subj, _compression_stats_for(db, doc.id))
        for (doc, subj) in rows
    ]


def list_chunks(db: Session, document_id: uuid.UUID, user: User) -> list[DocumentChunkPreview]:
    """Return all chunks for a document (for inspection / Phase 9 RAG)."""
    document = get_document(db, document_id, user)
    chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document.id)
        .order_by(DocumentChunk.chunk_index)
        .all()
    )
    previews: list[DocumentChunkPreview] = []
    for c in chunks:
        previews.append(
            DocumentChunkPreview(
                id=c.id,
                chunk_index=c.chunk_index,
                chunk_text=c.chunk_text,
                compression_ratio=float(c.compression_ratio) if c.compression_ratio is not None else None,
                compressed_bytes=len(c.compressed_text) if c.compressed_text else None,
                original_bytes=len(c.chunk_text.encode("utf-8")),
            )
        )
    return previews


def get_document(db: Session, document_id: uuid.UUID, user: User) -> Document:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    # Hydrate the subject relationship so _can_view_document can read it.
    _ = document.subject

    if not _can_view_document(document, user):
        # Hide existence — return 404 rather than 403 to avoid leaking
        # private-doc IDs to other students.
        raise HTTPException(status_code=404, detail="Document not found")

    return document


def upload_document(
    db: Session,
    subject_id: uuid.UUID,
    file: UploadFile,
    user: User,
    *,
    title: str | None = None,
    chapter: str | None = None,
    description: str | None = None,
) -> DocumentResponse:
    """Validate + save a file to disk, then create a Document row.

    Teacher/admin uploads create public documents (owner_student_id=NULL).
    Student uploads create personal notes scoped to that student only.
    """
    _ensure_upload_dir()
    subject = _resolve_subject_for_upload(db, subject_id, user)

    # Validate filename and extension
    original_name = file.filename or "untitled"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File extension '{ext}' not allowed. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Content type '{file.content_type}' not allowed.",
        )

    # Build the storage path
    subject_dir = UPLOAD_ROOT / str(subject.id)
    subject_dir.mkdir(parents=True, exist_ok=True)
    file_uuid = uuid.uuid4()
    safe_name = Path(original_name).name  # strip any path components
    storage_path = subject_dir / f"{file_uuid}_{safe_name}"

    # Stream to disk with size enforcement
    bytes_written = 0
    try:
        with storage_path.open("wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)  # 1 MB chunks
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > MAX_UPLOAD_BYTES:
                    out.close()
                    storage_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        storage_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {e}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    # Create the DB row. processing_status stays 'pending' until Phase 7 kicks off processing.
    # Student uploads are scoped to the uploader; teacher/admin uploads stay public.
    owner_student_id = user.id if user.role == UserRole.STUDENT else None
    chapter_clean = (chapter or "").strip() or None
    description_clean = (description or "").strip() or None

    document = Document(
        subject_id=subject.id,
        uploaded_by_id=user.id,
        owner_student_id=owner_student_id,
        title=(title or safe_name).strip(),
        file_name=safe_name,
        storage_path=str(storage_path.resolve()),
        content_type=file.content_type,
        file_size_bytes=bytes_written,
        chapter=chapter_clean,
        description=description_clean,
        processing_status=DocumentStatus.PENDING,
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    # When a teacher/admin uploads a public doc WITH an announcement message,
    # broadcast it to the subject's students via an Announcement row. The
    # Dashboard's ANNOUNCEMENTS card surfaces these automatically.
    # Students uploading private notes don't trigger this — their uploads
    # aren't a classroom-wide event.
    if (
        description_clean
        and owner_student_id is None
        and user.role in (UserRole.TEACHER, UserRole.ADMIN)
    ):
        label = chapter_clean or document.title or safe_name
        announcement = Announcement(
            author_id=user.id,
            subject_id=subject.id,
            college_id=user.college_id,
            title=f"New notes: {label}",
            body=description_clean,
            target=AnnouncementTarget.SUBJECT,
        )
        db.add(announcement)
        db.commit()

    return _to_response(document, db=db)


def delete_document(db: Session, document_id: uuid.UUID, user: User) -> None:
    document = get_document(db, document_id, user)

    # Students can only delete their own private notes; teachers/admins handle
    # everything else (the public corpus). `get_document` already enforces the
    # student-only-sees-own-notes rule for private docs, so the only extra
    # rule to add here is "students can't delete the teacher's public docs."
    if user.role == UserRole.STUDENT and document.owner_student_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Students can only delete their own personal notes.",
        )

    # Try to remove the file from disk (best effort)
    try:
        Path(document.storage_path).unlink(missing_ok=True)
    except Exception:
        pass

    db.delete(document)
    db.commit()
