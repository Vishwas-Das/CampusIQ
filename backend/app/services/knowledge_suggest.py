"""AI-mediated suggestion for the Knowledge Editor's Quick Update bar.

The admin types a natural-language statement (e.g. "lab attendance is
now 75%"). We:
    1. Vector-search college chunks for the most similar match.
    2. If the top hit is similar enough, ask Claude to rewrite that
       chunk so it incorporates the new fact without dropping the
       existing information.
    3. Otherwise treat the statement as new info: ask Claude to phrase
       it as a clean self-contained paragraph and return the top-3
       documents as candidates so the admin can pick a destination.

If embeddings or Claude are unavailable we fall back to returning the
statement verbatim — the admin can still hand-edit before applying.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.schemas.college_document import (
    KnowledgeSuggestion,
    SuggestionCandidate,
)
from app.services import claude_client, embeddings, vector_search
from app.services.vector_search import CollegeSearchHit

logger = logging.getLogger(__name__)

# Tunable similarity threshold. 0.55 lands in the "kind of related" zone
# of sentence-transformers MiniLM scores — high enough to avoid
# rewriting an unrelated chunk, low enough to catch paraphrased facts.
# Promote to settings if real-world docs need finer control.
MATCH_THRESHOLD = 0.55

REWRITE_SYSTEM = """You rewrite chunks of a college document so they reflect a new fact stated by an administrator.

Given:
  - The CURRENT chunk text from an official document.
  - A short STATEMENT describing the update.

Produce: a rewritten chunk that incorporates the statement WITHOUT removing existing information unrelated to the update. Keep tone, formatting, and surrounding facts intact. Update only the specific value the statement changes.

Output ONLY the rewritten chunk text. No preamble, no commentary, no markdown fences."""

PHRASE_NEW_SYSTEM = """You phrase short admin statements as polished paragraphs suitable for inclusion in an official college document (handbook, hostel rules, placement record, etc.).

Output ONLY the rewritten paragraph. No preamble, no commentary, no markdown fences. Keep it 1-3 sentences unless the statement is detailed."""


def suggest_edit(
    db: Session,
    user: User,
    statement: str,
    *,
    hint_category: str | None = None,
) -> KnowledgeSuggestion:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can request knowledge suggestions.",
        )

    statement = statement.strip()
    if len(statement) < 4:
        raise HTTPException(status_code=422, detail="Statement is too short.")

    hits: list[CollegeSearchHit] = []
    if embeddings.is_available():
        hits = vector_search.search_college_chunks(
            db,
            query=statement,
            user=user,
            category=hint_category,
            top_k=3,
        )

    if hits and hits[0].similarity >= MATCH_THRESHOLD:
        top = hits[0]
        rewrite_prompt = (
            f"CURRENT chunk:\n---\n{top.chunk_text}\n---\n\n"
            f"STATEMENT (the new fact to incorporate):\n{statement}"
        )
        rewritten = claude_client.generate_completion_cached(
            REWRITE_SYSTEM,
            rewrite_prompt,
            max_tokens=1200,
            temperature=0.2,
        )
        if not rewritten:
            # Claude unavailable / errored — let the admin hand-edit.
            rewritten = statement
        return KnowledgeSuggestion(
            kind="update_existing",
            similarity=round(top.similarity, 4),
            document_id=top.document_id,
            document_title=top.document_title,
            document_category=top.document_category,  # type: ignore[arg-type]
            chunk_id=top.chunk_id,
            chunk_index=top.chunk_index,
            current_chunk_text=top.chunk_text,
            proposed_chunk_text=rewritten,
            candidate_documents=[],
        )

    # No clear match — propose creating a new chunk.
    phrase_prompt = f"STATEMENT to phrase as official document text:\n{statement}"
    proposed = claude_client.generate_completion_cached(
        PHRASE_NEW_SYSTEM,
        phrase_prompt,
        max_tokens=800,
        temperature=0.3,
    )
    if not proposed:
        proposed = statement

    candidates = [
        SuggestionCandidate(
            document_id=h.document_id,
            document_title=h.document_title,
            document_category=h.document_category,  # type: ignore[arg-type]
            similarity=round(h.similarity, 4),
        )
        for h in hits
    ]

    return KnowledgeSuggestion(
        kind="create_new",
        similarity=round(hits[0].similarity, 4) if hits else 0.0,
        proposed_chunk_text=proposed,
        candidate_documents=candidates,
    )
