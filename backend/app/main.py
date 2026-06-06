import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.rate_limit import limiter

settings = get_settings()

logger = logging.getLogger(__name__)


async def _audio_cleanup_loop() -> None:
    """Periodically purge stale audio files. Cancelled on shutdown."""
    from app.services import speech as speech_service

    interval_hours = settings.audio_cleanup_interval_hours
    retention_days = settings.audio_retention_days
    if interval_hours <= 0 or retention_days <= 0:
        logger.info("audio cleanup loop disabled (interval=%s, retention=%s)", interval_hours, retention_days)
        return
    interval_seconds = interval_hours * 3600
    while True:
        try:
            report = speech_service.purge_old_audio(retention_days=retention_days)
            if report["deleted"]:
                logger.info("audio cleanup tick: %s", report)
        except Exception:  # noqa: BLE001 - never let one tick kill the loop
            logger.exception("audio cleanup tick failed")
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            return


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Startup: eager-import all models so SQLAlchemy registers them
    import app.models  # noqa: F401

    # Phase 9 — capture the running loop so sync handlers can dispatch
    # WebSocket sends onto the right loop via run_coroutine_threadsafe.
    from app.services import notifications as notifications_service

    notifications_service.set_main_loop(asyncio.get_running_loop())

    # Run a single audio purge on startup so a long downtime is reflected
    # immediately, then schedule the periodic loop.
    from app.services import speech as speech_service

    try:
        speech_service.purge_old_audio(retention_days=settings.audio_retention_days)
    except Exception:  # noqa: BLE001
        logger.exception("startup audio purge failed")

    cleanup_task = asyncio.create_task(_audio_cleanup_loop(), name="audio-cleanup")
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


def create_application() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="CampusIQ — AI-powered LMS + placement prep for engineering students.",
        lifespan=lifespan,
    )

    # ── Rate limiting (lever 4) ──
    # slowapi requires the Limiter on app.state and registers itself via
    # SlowAPIMiddleware. The exception handler turns RateLimitExceeded into
    # a clean 429 with `{"error": "Rate limit exceeded: ..."}` JSON.
    application.state.limiter = limiter
    application.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    application.add_middleware(SlowAPIMiddleware)

    # CORS — allow frontend origins
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix=settings.api_v1_prefix)

    # Serve generated voice interview / confidence audio files (Phase 20).
    # These are written by `app.services.speech.save_audio_bytes()` under
    # `backend/uploads/audio/` and consumed by the frontend <audio> elements.
    audio_dir = Path("uploads") / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    application.mount(
        "/audio",
        StaticFiles(directory=str(audio_dir)),
        name="audio",
    )

    @application.get("/health", tags=["health"])
    async def health_check() -> dict:
        return {
            "status": "ok",
            "service": settings.app_name,
            "version": settings.app_version,
            "environment": settings.environment,
        }

    return application


app = create_application()
