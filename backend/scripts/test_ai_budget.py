"""End-to-end check for the AI daily budget cap (lever 5).

Run from `backend/`:
    PYTHONIOENCODING=utf-8 PYTHONPATH=. ./.venv/Scripts/python.exe scripts/test_ai_budget.py

What it does:
    1. Creates ai_usage_log table if missing.
    2. Reads today's current spend from DB.
    3. Sets the daily budget cap to (current_spend + tiny_margin) at runtime —
       so the FIRST call still fits under the cap (pre-check passes) but
       immediately pushes us over after logging its cost.
    4. Calls Claude. Expect: success, usage row written.
    5. Calls Claude again. Expect: refused (returns "") because we're now
       over budget. No new usage row.
"""
from __future__ import annotations

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.models.ai_cache import AIUsageLog
from app.services.claude_client import (
    _is_over_budget,
    _today_spend_usd,
    generate_completion,
    is_available,
)


def main() -> None:
    print("=" * 60)
    print("AI budget cap verification — lever 5")
    print("=" * 60)

    if not is_available():
        print("ABORT: ANTHROPIC_API_KEY not configured.")
        return

    # 1. Ensure table exists
    print("\n[step 1] Creating ai_usage_log table if missing...")
    Base.metadata.create_all(engine, tables=[AIUsageLog.__table__])
    print("        -> table OK")

    # 2. Read current spend
    spend_before = _today_spend_usd()
    print(f"\n[step 2] Today's spend before test: ${spend_before:.6f}")

    # 3. Set cap just above current spend — first call's cost will exceed it
    settings = get_settings()
    margin = 0.000001  # $0.000001 — way smaller than any real call's cost
    settings.anthropic_daily_budget_usd = spend_before + margin
    print(
        f"\n[step 3] Budget cap set to ${settings.anthropic_daily_budget_usd:.6f} "
        f"(spend_before + ${margin})"
    )
    print(f"        is over budget pre-call? {_is_over_budget()}")

    # 4. First call — should succeed (under budget at pre-check time)
    print("\n[step 4] First call -> should SUCCEED + log usage")
    reply_1 = generate_completion(
        system="Reply with exactly one word.",
        user_message="Say: alpha",
        max_tokens=10,
        temperature=0.0,
        endpoint="budget_test",
    )
    spend_after_first = _today_spend_usd()
    print(f"        reply:           {reply_1!r}")
    print(f"        spend now:       ${spend_after_first:.6f}")
    print(f"        is over budget?  {_is_over_budget()}")

    # 5. Second call — should be refused
    print("\n[step 5] Second call -> should RETURN '' (over budget)")
    reply_2 = generate_completion(
        system="Reply with exactly one word.",
        user_message="Say: bravo",
        max_tokens=10,
        temperature=0.0,
        endpoint="budget_test",
    )
    spend_after_second = _today_spend_usd()
    print(f"        reply:           {reply_2!r}")
    print(f"        spend now:       ${spend_after_second:.6f}  (should be unchanged)")

    # 6. Show the rows we actually wrote
    print("\n[step 6] AIUsageLog rows for endpoint='budget_test' today:")
    session = SessionLocal()
    try:
        rows = (
            session.query(AIUsageLog)
            .filter(AIUsageLog.endpoint == "budget_test")
            .order_by(AIUsageLog.created_at)
            .all()
        )
        for i, r in enumerate(rows, 1):
            print(
                f"          #{i}: model={r.model} in={r.input_tokens} "
                f"out={r.output_tokens} cost=${r.cost_usd:.6f}"
            )
        n_rows = len(rows)
    finally:
        session.close()

    # Reset cap so we don't carry it over into other sessions
    settings.anthropic_daily_budget_usd = 0.0

    print("\n" + "=" * 60)
    first_succeeded = bool(reply_1)
    second_blocked = reply_2 == ""
    spend_did_not_grow = abs(spend_after_second - spend_after_first) < 1e-9
    if first_succeeded and second_blocked and spend_did_not_grow:
        print("PASS: daily budget cap works.")
        print("  - First call succeeded and logged usage.")
        print("  - Second call refused (no API hit, no new row).")
        print(f"  - {n_rows} budget_test row(s) in DB.")
    else:
        print("CHECK: results unexpected.")
        print(f"  first_succeeded={first_succeeded}  (expected True)")
        print(f"  second_blocked={second_blocked}    (expected True)")
        print(f"  spend_did_not_grow={spend_did_not_grow}  (expected True)")
    print("=" * 60)


if __name__ == "__main__":
    main()
