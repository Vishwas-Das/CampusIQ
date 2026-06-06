"""Pydantic schemas for document endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentStatusLiteral = Literal["pending", "processing", "ready", "failed"]


class CompressionStats(BaseModel):
    """Huffman compression stats aggregated across a document's chunks."""

    original_bytes: int = 0
    compressed_bytes: int = 0
    savings_percent: float = 0.0
    chunk_count: int = 0


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subject_id: uuid.UUID
    uploaded_by_id: uuid.UUID
    # NULL = public (teacher/admin upload). Set = private to that student.
    owner_student_id: uuid.UUID | None = None
    title: str
    file_name: str
    content_type: str | None = None
    file_size_bytes: int | None = None
    summary: str | None = None
    chapter: str | None = None
    description: str | None = None
    processing_status: DocumentStatusLiteral
    created_at: datetime
    compression_stats: CompressionStats | None = None


class DocumentWithSubject(DocumentResponse):
    """Document with the parent subject info for list views."""

    subject_code: str
    subject_name: str


class DocumentChunkPreview(BaseModel):
    """A single chunk, returned by /documents/{id}/chunks for inspection."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    chunk_index: int
    chunk_text: str
    compression_ratio: float | None = None
    compressed_bytes: int | None = None
    original_bytes: int | None = None


# ── Semantic search (Phase 8) ──

class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    subject_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    top_k: int = Field(5, ge=1, le=20)


class SemanticSearchHit(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    subject_id: uuid.UUID
    subject_code: str
    subject_name: str
    chunk_index: int
    chunk_text: str
    similarity: float


class SemanticSearchResponse(BaseModel):
    query: str
    hit_count: int
    hits: list[SemanticSearchHit]


class DocumentCreateMetadata(BaseModel):
    """Non-file fields sent as a multipart form alongside the file."""

    title: str | None = Field(None, max_length=255)
