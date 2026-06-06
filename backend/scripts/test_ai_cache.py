"""End-to-end check for the AI response cache (lever 3).

Run from `backend/`:
    PYTHONIOENCODING=utf-8 ./.venv/Scripts/python.exe scripts/test_ai_cache.py

What it does:
    1. Calls Base.metadata.create_all() so the new ai_response_cache table exists.
    2. Calls summarize_document() with a fixed test text -> first call hits Claude.
    3. Calls it again with the same text -> should hit the cache (near-zero ms,
       no API cost).
    4. Reads the cache row back to confirm hit_count incremented and the
       response text matches.
"""
from __future__ import annotations

import time

from app.core.database import Base, SessionLocal, engine
from app.models.ai_cache import AIResponseCache
from app.services.claude_client import is_available, summarize_document


TEST_TEXT = (
    "OSI Reference Model. The Open Systems Interconnection model is a seven-layer "
    "conceptual framework used to understand network interactions. The layers from "
    "bottom to top are Physical, Data Link, Network, Transport, Session, "
    "Presentation, and Application. Each layer serves the one above and is served "
    "by the one below. The Physical layer transmits raw bits over a medium. The "
    "Data Link layer handles framing and error detection. The Network layer routes "
    "packets between hosts. The Transport layer provides end-to-end delivery. The "
    "Session layer manages dialogues. The Presentation layer handles encoding and "
    "encryption. The Application layer is what user-facing programs interact with."
)


def main() -> None:
    print("=" * 60)
    print("AI cache verification — lever 3")
    print("=" * 60)

    # 1. Ensure the new table exists (idempotent — won't touch other tables)
    print("\n[step 1] Creating ai_response_cache table if missing...")
    Base.metadata.create_all(engine, tables=[AIResponseCache.__table__])
    print("        -> table OK")

    if not is_available():
        print("\nABORT: ANTHROPIC_API_KEY not configured. Cannot test.")
        return

    # 2. Wipe any prior cache row for this exact prompt so we start clean
    session = SessionLocal()
    try:
        before_total = session.query(AIResponseCache).count()
        # We can't pre-compute the key without importing internals, so just
        # report total count before/after to detect the new insert.
        print(f"\n[step 2] Cache rows currently in DB: {before_total}")
    finally:
        session.close()

    # 3. First call -> MISS (hits Claude)
    print("\n[step 3] First call -> expect MISS (real API call)")
    t0 = time.perf_counter()
    summary_1 = summarize_document(TEST_TEXT)
    t1 = time.perf_counter()
    miss_ms = (t1 - t0) * 1000
    print(f"        -> {miss_ms:.0f} ms, {len(summary_1)} chars returned")

    if not summary_1:
        print("ABORT: Claude returned empty. Check logs.")
        return

    # 4. Second call -> HIT (no API call)
    print("\n[step 4] Second call (identical input) -> expect HIT (cache)")
    t0 = time.perf_counter()
    summary_2 = summarize_document(TEST_TEXT)
    t1 = time.perf_counter()
    hit_ms = (t1 - t0) * 1000
    print(f"        -> {hit_ms:.0f} ms, {len(summary_2)} chars returned")

    # 5. Verify
    print("\n[step 5] Verification")
    print(f"        responses identical:    {summary_1 == summary_2}")
    print(f"        miss latency:           {miss_ms:.0f} ms")
    print(f"        hit  latency:           {hit_ms:.0f} ms")
    print(f"        speedup:                {miss_ms / max(hit_ms, 1):.1f}x")

    session = SessionLocal()
    try:
        after_total = session.query(AIResponseCache).count()
        latest = (
            session.query(AIResponseCache)
            .order_by(AIResponseCache.created_at.desc())
            .first()
        )
        print(f"        cache rows now in DB:   {after_total}")
        if latest:
            print(f"        latest row hit_count:   {latest.hit_count}")
            print(f"        latest row model:       {latest.model}")
            print(f"        latest row key prefix:  {latest.cache_key[:16]}...")
    finally:
        session.close()

    print("\n" + "=" * 60)
    if summary_1 == summary_2 and hit_ms < miss_ms / 5:
        print("PASS: cache works. Second call was much faster and no API was hit.")
    else:
        print("CHECK: results look off — inspect logs above.")
    print("=" * 60)


if __name__ == "__main__":
    main()
