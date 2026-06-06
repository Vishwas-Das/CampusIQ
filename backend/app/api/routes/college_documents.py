"""College document endpoints (Phase 10, F5).

Admin-only writes (upload/delete/reprocess); read access is open to all
authenticated users (students need to see what's available to query).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Request, UploadFile, status

from app.api.deps import CurrentUser, DbSession, require_role
from app.core.rate_limit import limiter
from app.models.content import CollegeDocumentCategory
from app.schemas.college_document import (
    ChunkCreate,
    ChunkUpdate,
    CollegeDocumentChunkPreview,
    CollegeDocumentResponse,
    KnowledgeSuggestion,
    KnowledgeSuggestRequest,
)
from app.services import chunk_edit, college_document as college_doc_service
from app.services import college_document_processor, knowledge_suggest

router = APIRouter()


def _parse_category(value: str | None) -> CollegeDocumentCategory:
    if value is None or value == "":
        return CollegeDocumentCategory.OTHER
    try:
        return CollegeDocumentCategory(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid category: {value}") from e


@router.get(
    "/",
    response_model=list[CollegeDocumentResponse],
    summary="List all college documents (visible to every authenticated user)",
)
def list_college_documents(
    db: DbSession,
    current_user: CurrentUser,
    category: str | None = None,
) -> list[CollegeDocumentResponse]:
    cat_filter = None
    if category and category != "all":
        cat_filter = _parse_category(category)
    return college_doc_service.list_college_documents(db, current_user, category=cat_filter)


@router.post(
    "/upload",
    response_model=CollegeDocumentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: upload a new college document (handbook, timetable, etc.)",
)
def upload_college_document(
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    file: UploadFile,
    title: str | None = Form(None),
    document_category: str | None = Form(None),
) -> CollegeDocumentResponse:
    category = _parse_category(document_category)
    response = college_doc_service.upload_college_document(
        db,
        file=file,
        user=current_user,
        title=title,
        document_category=category,
    )
    # Kick off background processing (extract → chunk → Huffman → embed)
    background_tasks.add_task(
        college_document_processor.process_college_document, response.id
    )
    return response


@router.get(
    "/{college_document_id}",
    response_model=CollegeDocumentResponse,
    summary="Get a single college document",
)
def get_college_document(
    college_document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> CollegeDocumentResponse:
    document = college_doc_service.get_college_document(db, college_document_id, current_user)
    return CollegeDocumentResponse(
        id=document.id,
        college_id=document.college_id,
        uploaded_by_id=document.uploaded_by_id,
        title=document.title,
        file_name=document.file_name,
        file_type=document.file_type,
        document_category=document.document_category.value,
        summary=document.summary,
        processing_status=document.processing_status,
        created_at=document.created_at,
        compression_stats=college_doc_service._compression_stats_for(db, document.id),
    )


@router.get(
    "/{college_document_id}/chunks",
    response_model=list[CollegeDocumentChunkPreview],
    summary="Inspect chunks for a college document",
)
def list_college_document_chunks(
    college_document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> list[CollegeDocumentChunkPreview]:
    return college_doc_service.list_college_chunks(db, college_document_id, current_user)


@router.post(
    "/{college_document_id}/reprocess",
    response_model=CollegeDocumentResponse,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: re-run the processing pipeline for a college document",
)
def reprocess_college_document(
    college_document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> CollegeDocumentResponse:
    document = college_doc_service.get_college_document(db, college_document_id, current_user)
    document.processing_status = "pending"
    db.commit()
    db.refresh(document)
    background_tasks.add_task(
        college_document_processor.process_college_document, document.id
    )
    return CollegeDocumentResponse(
        id=document.id,
        college_id=document.college_id,
        uploaded_by_id=document.uploaded_by_id,
        title=document.title,
        file_name=document.file_name,
        file_type=document.file_type,
        document_category=document.document_category.value,
        summary=document.summary,
        processing_status=document.processing_status,
        created_at=document.created_at,
        compression_stats=college_doc_service._compression_stats_for(db, document.id),
    )


@router.delete(
    "/{college_document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: delete a college document",
)
def delete_college_document(
    college_document_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    college_doc_service.delete_college_document(db, college_document_id, current_user)


# ─────────────────────────────────────────────────────────────────
# Knowledge Editor — admin-only chunk CRUD + AI-mediated suggestions
# ─────────────────────────────────────────────────────────────────


@router.patch(
    "/{college_document_id}/chunks/{chunk_id}",
    response_model=CollegeDocumentChunkPreview,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: rewrite a single chunk (re-embeds + recompresses)",
)
def patch_chunk(
    college_document_id: uuid.UUID,
    chunk_id: uuid.UUID,
    body: ChunkUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> CollegeDocumentChunkPreview:
    return chunk_edit.update_chunk_text(
        db, current_user, college_document_id, chunk_id, body.chunk_text
    )


@router.post(
    "/{college_document_id}/chunks",
    response_model=CollegeDocumentChunkPreview,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: append a new chunk to a college document",
)
def create_chunk(
    college_document_id: uuid.UUID,
    body: ChunkCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> CollegeDocumentChunkPreview:
    return chunk_edit.append_chunk(
        db,
        current_user,
        college_document_id,
        body.chunk_text,
        chunk_index=body.chunk_index,
    )


@router.delete(
    "/{college_document_id}/chunks/{chunk_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: delete a single chunk from a college document",
)
def delete_chunk(
    college_document_id: uuid.UUID,
    chunk_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    chunk_edit.delete_chunk(db, current_user, college_document_id, chunk_id)


@router.post(
    "/suggest",
    response_model=KnowledgeSuggestion,
    dependencies=[Depends(require_role("admin"))],
    summary="Admin: ask the AI to locate and rewrite a chunk for a natural-language update",
)
@limiter.limit("30/hour")
def suggest_knowledge_update(
    request: Request,
    body: KnowledgeSuggestRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> KnowledgeSuggestion:
    return knowledge_suggest.suggest_edit(
        db,
        current_user,
        body.statement,
        hint_category=body.hint_category,
    )
