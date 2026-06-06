"""End-to-end check for the rate limiter (lever 4).

Run from `backend/`:
    PYTHONIOENCODING=utf-8 PYTHONPATH=. ./.venv/Scripts/python.exe scripts/test_rate_limit.py

Builds a tiny isolated FastAPI app that uses the shared `limiter` from
`app.core.rate_limit`. Hits one endpoint past its limit and verifies that
the limiter returns HTTP 429.

Doing it this way avoids:
  - Spinning up uvicorn
  - Real auth dependencies
  - Real Claude calls (which would burn credits)
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.rate_limit import limiter


# ── Build the tiny isolated app ──
app = FastAPI()
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.get("/ping")
@limiter.limit("3/minute")
def ping(request: Request) -> dict:
    return {"ok": True}


def main() -> None:
    print("=" * 60)
    print("Rate limiter verification — lever 4")
    print("=" * 60)
    print('\nLimit set to "3/minute" on /ping.')
    print("Sending 5 requests with the same fake JWT in Authorization header...\n")

    client = TestClient(app)
    fake_auth = {"Authorization": "Bearer fake-jwt-test-token"}

    results = []
    for i in range(1, 6):
        r = client.get("/ping", headers=fake_auth)
        results.append((i, r.status_code))
        body = (r.text[:80] + "...") if len(r.text) > 80 else r.text
        print(f"  Request #{i}: HTTP {r.status_code}  body={body!r}")

    # Expected: 200, 200, 200, 429, 429
    ok_count = sum(1 for _, s in results if s == 200)
    blocked_count = sum(1 for _, s in results if s == 429)
    print("\nSummary:")
    print(f"  200 OK:  {ok_count} (expected 3)")
    print(f"  429 RLE: {blocked_count} (expected 2)")

    # Now verify the bucket is keyed by JWT — a different JWT should NOT be
    # blocked even though we just exhausted the first user's quota.
    print("\nNow sending one request with a DIFFERENT JWT...")
    other = {"Authorization": "Bearer different-user-token"}
    r2 = client.get("/ping", headers=other)
    print(f"  Different user: HTTP {r2.status_code} (expected 200 — separate bucket)")

    print("\n" + "=" * 60)
    if ok_count == 3 and blocked_count == 2 and r2.status_code == 200:
        print("PASS: rate limiter works.")
        print("  - First 3 requests succeed.")
        print("  - 4th + 5th blocked with 429.")
        print("  - Different JWT has its own bucket (not affected).")
    else:
        print("CHECK: results unexpected.")
    print("=" * 60)


if __name__ == "__main__":
    main()
