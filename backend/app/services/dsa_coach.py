"""DSA Coach — a Socratic, hint-ladder tutor bound to a single coding problem.

Phase 1 of the coding-learning pivot. Instead of an in-house judge, students
solve on LeetCode and come here for help. The coach NEVER just hands over the
answer in hint mode — it nudges, then guides, then (only at the strongest level)
spells it out — because peeking at a solution feels like learning but isn't.

Reuses the shared chat infrastructure (`chat_sessions` / `chat_messages` with
`chat_type='dsa_coach'`) and the streaming Claude client. Unlike `ai_chat`, there
is NO retrieval — the only context is the bound problem + the conversation so far.

Two modes, driven per-message by the frontend:
- coach_mode="hint" with hint_level in {nudge, guide, spell_it_out}
- coach_mode="solution" — the full walkthrough
"""
from __future__ import annotations

import logging
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.models.chat import ChatSession, MessageRole
from app.models.coding import CodingProblem
from app.models.user import User
from app.services import chat as chat_service
from app.services import claude_client

logger = logging.getLogger(__name__)


MAX_HISTORY_MESSAGES = 10
HINT_MAX_TOKENS = 600
SOLUTION_MAX_TOKENS = 1200
MAX_DESCRIPTION_CHARS = 1200


COACH_PERSONA = """You are CampusIQ DSA Coach — a Socratic programming mentor helping an engineering student learn data structures and algorithms by working through a specific problem.

Your job is to make the student *think*, not to hand them answers. Reading a solution feels like "it clicks", but that feeling is a trap — real problem-solving skill is built by struggling productively. You are the antidote to that trap: you guide, you ask, you nudge.

CORE BEHAVIOUR:
- Be warm, brief, and encouraging. Short paragraphs — never a wall of text.
- Talk like a sharp senior sitting next to them, not a textbook.
- Prefer a pointed question over a flat statement whenever it would make them think.
- If the student hasn't shared ANY attempt or idea yet, gently ask for their first instinct — even a brute-force one — before giving structural help. Just one nudge, not a lecture; if they clearly want a hint, still give the level-appropriate one.
- Never shame a wrong idea. Find the part that's right and build on it.
- Use markdown. Inline `code` for identifiers; fenced ```python only when the current mode/level actually allows showing code.
- Stay on THIS problem. Do not volunteer the full solution unless Solution mode is active."""


HINT_NUDGE = """CURRENT MODE — HINT, intensity "Nudge" (lightest).
Give the subtlest possible push. Ask a pointed question or point at the *kind* of thinking that helps, WITHOUT naming the exact algorithm or data structure. Let them connect the dots. One or two sentences. No code. Do not name the pattern outright."""


HINT_GUIDE = """CURRENT MODE — HINT, intensity "Guide" (medium).
Name the pattern or data structure and state the key insight — but DO NOT write the solution. Explain the idea clearly enough that a motivated student can now go implement it themselves. A few sentences; you may mention complexity. No full code (a one-line idea fragment is fine if essential)."""


HINT_SPELL = """CURRENT MODE — HINT, intensity "Spell it out" (strongest, but still short of the full solution).
Walk through the algorithm step by step in plain language / pseudocode for exactly where they're stuck. Be concrete. You MAY show a small code fragment, but do NOT paste the entire finished function — leave the real implementation for them to type. End by encouraging them to code it up themselves."""


SOLUTION_MODE = """CURRENT MODE — SOLUTION. The student has explicitly asked to see the full approach.
Give the complete walkthrough, structured as:
1. **Approach** — the optimal strategy in 2-3 sentences.
2. **Why it works** — the key insight or invariant.
3. **Complexity** — time and space, each with a one-line justification.
4. **Code** — a clean, commented reference solution in a ```python fenced block.
5. **Remember this** — one sentence naming the general pattern so they recognise it next time.
Keep it tight and pedagogical — a teaching moment, not a data dump."""


def _directive(coach_mode: str | None, hint_level: str | None) -> tuple[str, int]:
    """Return the (mode directive, max_tokens) for the requested coach state."""
    if coach_mode == "solution":
        return SOLUTION_MODE, SOLUTION_MAX_TOKENS
    if hint_level == "guide":
        return HINT_GUIDE, HINT_MAX_TOKENS
    if hint_level == "spell_it_out":
        return HINT_SPELL, HINT_MAX_TOKENS
    return HINT_NUDGE, HINT_MAX_TOKENS  # default = lightest nudge


def _problem_context(problem: CodingProblem | None) -> str:
    """Render the bound problem as a compact context block for the system prompt."""
    if problem is None:
        return "(No specific problem is attached. Act as a general DSA coach and ask what they're working on.)"

    description = problem.description or ""
    if len(description) > MAX_DESCRIPTION_CHARS:
        description = description[:MAX_DESCRIPTION_CHARS] + "…"

    parts = [
        f"PROBLEM: {problem.title} ({problem.difficulty.value})",
        f"Topics: {', '.join(problem.topic_tags or []) or 'general'}",
        "",
        description.strip(),
    ]

    examples = problem.examples or []
    if examples:
        ex_lines = ["", "Examples:"]
        for ex in examples[:3]:
            inp = ex.get("input", "") if isinstance(ex, dict) else ""
            out = ex.get("output", "") if isinstance(ex, dict) else ""
            ex_lines.append(f"- Input: {inp}  ->  Output: {out}")
        parts.extend(ex_lines)

    sig = problem.function_signature or {}
    if isinstance(sig, dict) and sig.get("params") is not None:
        params = ", ".join(
            f"{p.get('name')}: {p.get('type')}" for p in sig.get("params", [])
        )
        parts.append("")
        parts.append(
            f"Target function: {problem.function_name}({params}) -> {sig.get('returns', '?')}"
        )

    return "\n".join(parts)


def stream_coach_response(
    db: Session,
    *,
    user: User,
    session: ChatSession,
    user_message_text: str,
    coach_mode: str | None = "hint",
    hint_level: str | None = "nudge",
) -> Iterator[str]:
    """Generator that:
    1. Loads the problem bound to this coach session
    2. Persists the user message
    3. Yields the coach's reply as text deltas (Socratic hint or full solution)
    4. Persists the assistant message (with coach_mode + hint_level) on completion

    The caller (route handler) wraps this in a StreamingResponse. No retrieval —
    the only context is the bound problem and the recent conversation.
    """
    problem: CodingProblem | None = None
    if session.coding_problem_id is not None:
        problem = db.get(CodingProblem, session.coding_problem_id)

    directive, max_tokens = _directive(coach_mode, hint_level)
    system_prompt = (
        f"{COACH_PERSONA}\n\n"
        f"=== THE PROBLEM THE STUDENT IS WORKING ON ===\n\n"
        f"{_problem_context(problem)}\n\n"
        f"=== END PROBLEM ===\n\n"
        f"{directive}"
    )

    # Persist the user's message before streaming.
    chat_service.add_message(db, session, MessageRole.USER, user_message_text)

    # Recent history, minus the message we just added (re-sent as the final turn).
    history_msgs = chat_service.list_messages(db, session)
    history_msgs = [
        m for m in history_msgs if m.id != _last_user_message_id(history_msgs)
    ]
    history_msgs = history_msgs[-MAX_HISTORY_MESSAGES:]

    messages_for_claude: list[dict] = [
        {"role": m.role.value, "content": m.content}
        for m in history_msgs
        if m.role != MessageRole.SYSTEM
    ]
    messages_for_claude.append({"role": "user", "content": user_message_text})

    full_text_parts: list[str] = []
    try:
        for delta in claude_client.stream_completion(
            system=system_prompt,
            messages=messages_for_claude,
            max_tokens=max_tokens,
            temperature=0.5,
        ):
            full_text_parts.append(delta)
            yield delta
    finally:
        full_text = "".join(full_text_parts).strip()
        if full_text:
            chat_service.add_message(
                db,
                session,
                MessageRole.ASSISTANT,
                full_text,
                assistant_meta={"coach_mode": coach_mode, "hint_level": hint_level},
            )


def _last_user_message_id(messages: list) -> object | None:
    """Return the id of the most recent user message in `messages`."""
    for m in reversed(messages):
        if m.role == MessageRole.USER:
            return m.id
    return None
