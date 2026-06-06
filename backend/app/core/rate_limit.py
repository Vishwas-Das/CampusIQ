"""Per-user rate limiting for Claude-calling endpoints (lever 4).

Uses slowapi (a FastAPI integration of the `limits` library). The shared
`limiter` is imported by route modules to decorate AI endpoints, e.g.:

    from app.core.rate_limit import limiter

    @router.post("/generate-quiz")
    @limiter.limit("10/hour")
    async def generate_quiz(request: Request, ...):
        ...

The decorated route MUST have `request: Request` in its signature — slowapi
reads the JWT from there to bucket the limit per user.

Storage is in-memory (default). That's fine for single-worker uvicorn dev.
For multi-worker production, set storage_uri to redis:// and slowapi will
share counters across workers.
"""
from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request: Request) -> str:
    """Identify the caller for rate-limit bucketing.

    Prefer the JWT (Authorization header) so the limit follows the user
    across IPs (mobile/WiFi switches, NATed labs). Fall back to remote IP
    for unauthenticated endpoints. The full header value is fine as a key —
    same JWT → same bucket, and it never escapes into logs we expose.
    """
    auth = request.headers.get("authorization", "")
    if auth:
        return f"jwt:{auth}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=_rate_limit_key)
