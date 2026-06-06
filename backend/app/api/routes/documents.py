"""Document endpoints: upload, list, get, download, chunks, reprocess, delete."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import CurrentUser, DbSession, require_role
from app.schemas.document import (
    DocumentChunkPreview,
    DocumentResponse,
    DocumentWithSubject,
    SemanticSearchHit,
    SemanticSearchRequest,
    SemanticSearchResponse,
)
from app.services import document as document_service
from app.services import vector_search
from app.services.document_processor import backfill_embeddings, process_document

router = APIRouter()


@router.get(
    "/",
    response_model=list[DocumentWithSubject],
    summary="List documents (teachers see their own, admins see all)",
)
def list_documents(
    db: DbSession,
    current_user: CurrentUser,
    subject_id: uuid.UUID | None = None,
) -> list[DocumentWithSubject]:
    return document_service.list_documents(db, current_user, subject_id=subject_id)


@router.post(
    "/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary=(
        "Upload a document and trigger background processing. "
        "Teachers/admins upload public docs; students upload personal notes "
        "that are scoped to themselves (NotebookLM-style)."
    ),
)
def upload_document(
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    subject_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    title: str | None = Form(None),
    chapter: str | None = Form(None),
    description: str | None = Form(None),
) -> DocumentResponse:
    response = document_service.upload_document(
        db,
        subject_id=subject_id,
        file=file,
        user=current_user,
        title=title,
        chapter=chapter,
        description=description,
    )
    # Kick off the async pipeline: text extraction -> chunking -> Huffman -> embeddings -> summary
    background_tasks.add_task(process_document, response.id)
    return response


@router.post(
    "/search",
    response_model=SemanticSearchResponse,
    summary="Semantic search over document chunks via pgvector cosine similarity",
)
def semantic_search(
    request: SemanticSearchRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> SemanticSearchResponse:
    hits = vector_search.search_chunks(
        db,
        query=request.query,
        user=current_user,
        subject_id=request.subject_id,
        document_id=request.document_id,
        top_k=request.top_k,
    )
    return SemanticSearchResponse(
        query=request.query,
        hit_count=len(hits),
        hits=[
            SemanticSearchHit(
                chunk_id=h.chunk_id,
                document_id=h.document_id,
                document_title=h.document_title,
                subject_id=h.subject_id,
                subject_code=h.subject_code,
                subject_name=h.subject_name,
                chunk_index=h.chunk_index,
                chunk_text=h.chunk_text,
                similarity=h.similarity,
            )
            for h in hits
        ],
    )


@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Get document metadata by ID (includes compression stats)",
)
def get_document(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> DocumentResponse:
    document = document_service.get_document(db, document_id, current_user)
    return document_service._to_response(document, db=db)


@router.get(
    "/{document_id}/chunks",
    response_model=list[DocumentChunkPreview],
    summary="List text chunks for a document (with per-chunk compression stats)",
)
def list_document_chunks(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> list[DocumentChunkPreview]:
    return document_service.list_chunks(db, document_id, current_user)


@router.post(
    "/{document_id}/reprocess",
    response_model=DocumentResponse,
    summary=(
        "Re-run the text extraction + chunking + compression pipeline. "
        "Students can reprocess their own personal notes; teachers/admins "
        "can reprocess public docs they own."
    ),
)
def reprocess_document(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> DocumentResponse:
    document = document_service.get_document(db, document_id, current_user)
    background_tasks.add_task(process_document, document.id)
    return document_service._to_response(document, db=db)


@router.post(
    "/{document_id}/embed-backfill",
    summary="Generate embeddings for chunks that don't have them yet",
)
def embed_backfill(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> dict:
    # Verify the user can access this document before kicking off the work
    document_service.get_document(db, document_id, current_user)
    background_tasks.add_task(backfill_embeddings, document_id)
    return {"status": "scheduled", "document_id": str(document_id)}


@router.get(
    "/{document_id}/download",
    summary="Download the raw file for a document",
)
def download_document(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> FileResponse:
    document = document_service.get_document(db, document_id, current_user)
    storage_path = Path(document.storage_path)
    if not storage_path.exists():
        raise HTTPException(status_code=410, detail="File no longer exists on disk")

    # The teacher's chapter (the name they gave the doc in the upload form)
    # becomes the download filename — that's the meaningful label, not the
    # raw filename. Fall back to the upload's original name only when the
    # teacher skipped the chapter field.
    ext = storage_path.suffix  # includes the leading "."
    chapter = (document.chapter or "").strip()
    if chapter:
        sanitised = "".join(c for c in chapter if c not in r'<>:"/\|?*').strip(" .")
        download_name = f"{sanitised or 'document'}{ext}"
    else:
        download_name = document.file_name

    return FileResponse(
        path=str(storage_path),
        media_type=document.content_type or "application/octet-stream",
        filename=download_name,
    )


@router.delete(
    "/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary=(
        "Delete a document (and its file + chunks). Students can delete their "
        "own private notes; teachers/admins handle the public corpus."
    ),
)
def delete_document(
    document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    document_service.delete_document(db, document_id, current_user)
