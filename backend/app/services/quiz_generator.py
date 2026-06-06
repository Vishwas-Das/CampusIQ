"""AI quiz generation via Claude (Phase 11, F3).

The teacher selects a subject + (optionally) a document and a difficulty.
We pull chunks from the document (or subject), build a strict JSON prompt for
Claude, parse the response into Question rows, and persist a draft Quiz that
the teacher can review before publishing.

Cost rule from the project skill:
    All dev/testing uses claude-haiku-4-5-20251001.
    Only the single final demo flips USE_PRODUCTION_MODEL=True for Opus.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.content import DocumentChunk
from app.models.quiz import Difficulty, Question, QuestionType, Quiz
from app.models.user import Document, Subject, User, UserRole
from app.services import claude_client

logger = logging.getLogger(__name__)


# ── Config ──
MAX_CONTEXT_CHARS = 9000        # how much chunk text to feed Claude
MAX_PROMPT_QUESTIONS = 20       # hard cap so the prompt + response stay bounded


QUIZ_GENERATION_SYSTEM = """You are CampusIQ Quiz Generator — an expert at writing exam-style multiple choice questions for engineering students.

You will be given excerpts from a course document. Generate a JSON quiz that tests understanding of the concepts in those excerpts.

CRITICAL OUTPUT RULES:
- Respond with VALID JSON ONLY — no markdown fences, no commentary, no preamble.
- The top-level JSON must be an object with two keys: "title" (string, < 100 chars) and "questions" (array).
- Each question object must have these keys exactly:
    "question_text" (string),
    "options" (array of 4 strings),
    "correct_answer" (string — must match one of the options EXACTLY),
    "explanation" (string — 1-3 sentences explaining why the answer is correct),
    "difficulty" (string — one of "easy", "medium", "hard"),
    "topic" (string — short topic label, max 50 chars, used for weak-area detection)
- Questions must be answerable from the provided excerpts.
- Each question must have EXACTLY four options labelled by their content (do NOT prefix "A.", "B.", etc).
- DO NOT invent facts that aren't in the excerpts.
- Make distractors plausible but unambiguously incorrect.
- Return only the JSON object, nothing else."""


@dataclass
class GeneratedQuestion:
    question_text: str
    options: list[str]
    correct_answer: str
    explanation: str
    difficulty: Difficulty
    topic: str


def _validate_teacher_owns_subject(db: Session, subject_id: uuid.UUID, user: User) -> Subject:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    if user.role == UserRole.TEACHER and subject.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="You don't own this subject")
    if user.role not in (UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers or admins can generate quizzes.",
        )
    return subject


def _gather_chunks(
    db: Session,
    *,
    subject_id: uuid.UUID,
    document_ids: list[uuid.UUID] | None,
) -> list[DocumentChunk]:
    """Pull a reasonable amount of chunk text — bounded by MAX_CONTEXT_CHARS.

    Selection rules:
        - document_ids is None or empty  -> every chunk in the subject
        - document_ids has entries        -> only those documents' chunks
                                             (uses SQL `WHERE document_id IN (...)`)
    """
    stmt = db.query(DocumentChunk).join(Document, DocumentChunk.document_id == Document.id)
    if document_ids:
        # `Column.in_(list)` builds `WHERE document_id IN (?, ?, ...)` for us.
        # We ALSO keep the subject filter so a tampered client can't pass
        # someone else's doc IDs across subjects.
        stmt = stmt.filter(
            DocumentChunk.document_id.in_(document_ids),
            Document.subject_id == subject_id,
        )
    else:
        stmt = stmt.filter(Document.subject_id == subject_id)
    chunks = stmt.order_by(DocumentChunk.chunk_index).all()

    selected: list[DocumentChunk] = []
    total = 0
    for c in chunks:
        if total >= MAX_CONTEXT_CHARS:
            break
        selected.append(c)
        total += len(c.chunk_text)
    return selected


def _format_context(chunks: list[DocumentChunk]) -> str:
    if not chunks:
        return ""
    parts = []
    running = 0
    for i, c in enumerate(chunks, start=1):
        text = c.chunk_text
        if running + len(text) > MAX_CONTEXT_CHARS:
            text = text[: max(0, MAX_CONTEXT_CHARS - running)]
        parts.append(f"[Excerpt {i}]\n{text}")
        running += len(text)
        if running >= MAX_CONTEXT_CHARS:
            break
    return "\n\n---\n\n".join(parts)


_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _strip_markdown_fences(text: str) -> str:
    """Claude sometimes wraps JSON in ```json ... ``` despite our instructions.
    Strip the fences if present."""
    return _JSON_FENCE_RE.sub("", text).strip()


def _parse_difficulty(value: str | None) -> Difficulty:
    if not value:
        return Difficulty.MEDIUM
    try:
        return Difficulty(value.strip().lower())
    except ValueError:
        return Difficulty.MEDIUM


def _parse_response(raw: str) -> tuple[str, list[GeneratedQuestion]]:
    """Turn Claude's JSON response into (title, questions). Raises on bad input."""
    cleaned = _strip_markdown_fences(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        snippet = cleaned[:300]
        raise HTTPException(
            status_code=502,
            detail=f"Quiz generator returned invalid JSON: {e}. Snippet: {snippet}",
        ) from e

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Quiz generator returned non-object JSON.")

    title = str(data.get("title") or "Untitled Quiz").strip()[:255]
    raw_questions = data.get("questions") or []
    if not isinstance(raw_questions, list) or not raw_questions:
        raise HTTPException(
            status_code=502, detail="Quiz generator returned no questions."
        )

    questions: list[GeneratedQuestion] = []
    for q in raw_questions:
        if not isinstance(q, dict):
            continue
        text = str(q.get("question_text") or "").strip()
        opts_raw = q.get("options") or []
        correct = str(q.get("correct_answer") or "").strip()
        if not text or not isinstance(opts_raw, list) or len(opts_raw) < 2 or not correct:
            continue
        options = [str(o).strip() for o in opts_raw if str(o).strip()]
        if correct not in options:
            # Snap to the closest option (case-insensitive) or skip
            lowered = [o.lower() for o in options]
            if correct.lower() in lowered:
                correct = options[lowered.index(correct.lower())]
            else:
                # Last resort: prepend to options so the answer is reachable
                options = [correct, *options[:3]]

        questions.append(
            GeneratedQuestion(
                question_text=text,
                options=options[:4] if len(options) >= 4 else options,
                correct_answer=correct,
                explanation=str(q.get("explanation") or "").strip(),
                difficulty=_parse_difficulty(q.get("difficulty")),
                topic=(str(q.get("topic") or "General")[:50]).strip(),
            )
        )

    if not questions:
        raise HTTPException(status_code=502, detail="No usable questions parsed from generator response.")
    return title, questions


def generate_quiz(
    db: Session,
    *,
    user: User,
    subject_id: uuid.UUID,
    document_ids: list[uuid.UUID] | None,
    num_questions: int,
    difficulty: Difficulty,
    topic_hint: str | None = None,
) -> Quiz:
    """Generate and persist a draft quiz from course material.

    `document_ids` selects which documents' chunks feed Claude:
      - None or empty list  → use ALL documents in the subject
      - non-empty list      → use only those documents (multi-select)
    """
    subject = _validate_teacher_owns_subject(db, subject_id, user)

    if num_questions > MAX_PROMPT_QUESTIONS:
        num_questions = MAX_PROMPT_QUESTIONS

    # Deduplicate + drop falsy entries so the frontend can send sloppy lists.
    cleaned_doc_ids: list[uuid.UUID] | None = None
    if document_ids:
        cleaned_doc_ids = list({d for d in document_ids if d})
        if not cleaned_doc_ids:
            cleaned_doc_ids = None  # all docs

    chunks = _gather_chunks(db, subject_id=subject.id, document_ids=cleaned_doc_ids)
    if not chunks:
        raise HTTPException(
            status_code=400,
            detail="No processed document chunks found. Upload and process at least one document first.",
        )

    if not claude_client.is_available():
        raise HTTPException(
            status_code=503,
            detail="Quiz generator unavailable: ANTHROPIC_API_KEY is not configured.",
        )

    context = _format_context(chunks)
    user_prompt = (
        f"Subject: {subject.code} — {subject.name}\n"
        f"Difficulty: {difficulty.value}\n"
        f"Number of questions: {num_questions}\n"
        + (f"Topic focus: {topic_hint}\n" if topic_hint else "")
        + "\n=== COURSE EXCERPTS ===\n\n"
        + context
        + "\n\n=== END OF EXCERPTS ===\n\n"
        + f"Now generate the JSON quiz with exactly {num_questions} questions."
    )

    # Cached: same subject + same chunks + same difficulty → same quiz.
    # Teachers regenerating "for variety" can bump temperature or rephrase
    # the topic hint to force a cache miss.
    raw = claude_client.generate_completion_cached(
        system=QUIZ_GENERATION_SYSTEM,
        user_message=user_prompt,
        max_tokens=2200,
        temperature=0.5,
    )
    if not raw:
        raise HTTPException(
            status_code=502,
            detail="Quiz generator returned an empty response. Try again or pick a different document.",
        )

    title, generated = _parse_response(raw)
    # Trim to the requested count if Claude over-generated
    generated = generated[:num_questions]

    # Tag the quiz with the FIRST document if exactly one was selected — keeps
    # back-compat with downstream code that uses Quiz.document_id (e.g. weak-area
    # detection by document). When multiple docs are selected, leave NULL.
    persisted_doc_id = (
        cleaned_doc_ids[0] if cleaned_doc_ids and len(cleaned_doc_ids) == 1 else None
    )
    quiz = Quiz(
        subject_id=subject.id,
        document_id=persisted_doc_id,
        created_by_id=user.id,
        title=title,
        description=f"AI-generated quiz from {subject.code}",
        difficulty=difficulty,
        time_limit_minutes=max(num_questions * 2, 5),
        is_published=False,
        is_ai_generated=True,
    )
    db.add(quiz)
    db.flush()  # gives us quiz.id without committing

    for idx, gq in enumerate(generated):
        q = Question(
            quiz_id=quiz.id,
            order_index=idx,
            question_text=gq.question_text,
            question_type=QuestionType.MCQ,
            options=gq.options,
            correct_answer=gq.correct_answer,
            explanation=gq.explanation or None,
            difficulty=gq.difficulty,
            topic=gq.topic,
        )
        db.add(q)

    db.commit()
    db.refresh(quiz)
    logger.info(
        "Generated quiz %s with %d questions for subject %s",
        quiz.id,
        len(generated),
        subject.code,
    )
    return quiz
