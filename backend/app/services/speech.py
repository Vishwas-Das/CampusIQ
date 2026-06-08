"""Speech pipeline for Phase 20 — ElevenLabs Scribe ASR + ElevenLabs TTS.

Both sides are lazy-cached so missing keys don't crash the app at import time.
Every function returns a non-raising sentinel (empty string / None) and logs
the root cause so the calling service can decide whether to fall back.

Why one vendor?
---------------
ElevenLabs Scribe (`scribe_v1`) handles transcription, the same key powers
TTS, so a single ELEVENLABS_API_KEY is enough for the whole voice pipeline.
The TTS side is the demo showstopper: 5 distinct human voices map to the 5
interview rounds so the candidate experiences a different interviewer at
each stage. The starter plan is metered, so we still rate-limit prompts —
see `is_tts_available()` / cost guard below.

If `OPENAI_API_KEY` is set, the OpenAI Whisper path remains as an opt-in
fallback for users who already have one — but ElevenLabs Scribe is the
default ASR path now.

Audio files are written to `backend/uploads/audio/` and served by FastAPI's
`StaticFiles` mount (added in `main.py`). We keep the returned URL relative
so the frontend can prepend the API base URL without knowing about the mount.

Format notes
------------
- Scribe accepts webm/wav/mp3/m4a/ogg/flac — the browser's MediaRecorder
  defaults to `audio/webm;codecs=opus` which is perfect.
- ElevenLabs TTS output is MP3 (`mp3_44100_128`) by default. We keep that.
"""
from __future__ import annotations

import io
import logging
import threading
import time
import uuid
from functools import lru_cache
from pathlib import Path

from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════
# File storage
# ════════════════════════════════════════════════════════════════

# Audio files land in backend/uploads/audio/ (relative to the backend cwd).
# The uploads/ folder already exists; we add an `audio/` subdir.
AUDIO_DIR = Path("uploads") / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Public URL prefix — matches the StaticFiles mount in main.py.
AUDIO_URL_PREFIX = "/audio"


def save_audio_bytes(data: bytes, *, extension: str = "mp3") -> tuple[Path, str]:
    """Persist a blob of audio bytes under a UUID filename.

    Returns the on-disk Path and the public URL path (without host). Callers
    usually return the URL path to the client and keep the Path for cleanup.
    """
    if not extension.startswith("."):
        extension = "." + extension
    file_id = uuid.uuid4().hex
    file_path = AUDIO_DIR / f"{file_id}{extension}"
    file_path.write_bytes(data)
    return file_path, f"{AUDIO_URL_PREFIX}/{file_path.name}"


def purge_old_audio(*, retention_days: int) -> dict[str, int]:
    """Delete audio files in AUDIO_DIR older than `retention_days`.

    Returns a small report so callers (and tests) can confirm the cleanup ran.
    """
    if retention_days <= 0:
        return {"scanned": 0, "deleted": 0, "bytes_freed": 0}

    cutoff = time.time() - retention_days * 86400
    scanned = 0
    deleted = 0
    bytes_freed = 0
    if not AUDIO_DIR.exists():
        return {"scanned": 0, "deleted": 0, "bytes_freed": 0}
    for entry in AUDIO_DIR.iterdir():
        if not entry.is_file():
            continue
        scanned += 1
        try:
            mtime = entry.stat().st_mtime
        except OSError:
            continue
        if mtime < cutoff:
            try:
                size = entry.stat().st_size
                entry.unlink()
                deleted += 1
                bytes_freed += size
            except OSError as exc:
                logger.warning("Could not delete stale audio %s: %s", entry, exc)
    if deleted:
        logger.info(
            "audio cleanup: deleted %d files (%.2f MB freed) older than %d days",
            deleted,
            bytes_freed / (1024 * 1024),
            retention_days,
        )
    return {"scanned": scanned, "deleted": deleted, "bytes_freed": bytes_freed}


# ════════════════════════════════════════════════════════════════
# Speech-to-text (ASR)
# ════════════════════════════════════════════════════════════════
#
# Default path: ElevenLabs Scribe (`scribe_v1`) — same key as TTS.
# Opt-in fallback: OpenAI Whisper, only if `OPENAI_API_KEY` is set.

SCRIBE_MODEL_ID = "scribe_v1"


@lru_cache(maxsize=1)
def _get_openai_client():
    """Return a cached OpenAI client, or None if the key isn't set.

    Kept as an opt-in fallback. ElevenLabs Scribe is the default ASR path.
    """
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    try:
        from openai import OpenAI
    except ImportError as e:
        logger.warning("openai package not installed: %s", e)
        return None
    try:
        return OpenAI(api_key=settings.openai_api_key)
    except Exception as e:
        logger.exception("Failed to construct OpenAI client: %s", e)
        return None


def is_asr_available() -> bool:
    """True if any transcription backend is configured."""
    return _get_elevenlabs_client() is not None or _get_openai_client() is not None


def _transcribe_with_elevenlabs(audio_bytes: bytes, filename: str, language: str | None) -> str:
    client = _get_elevenlabs_client()
    if client is None:
        return ""
    buffer = io.BytesIO(audio_bytes)
    buffer.name = filename
    try:
        result = client.speech_to_text.convert(
            model_id=SCRIBE_MODEL_ID,
            file=buffer,
            language_code=language or None,
        )
    except Exception as e:
        logger.exception("ElevenLabs Scribe transcription failed: %s", e)
        return ""
    text = getattr(result, "text", None)
    if isinstance(text, str):
        return text.strip()
    if isinstance(result, str):
        return result.strip()
    return ""


def _transcribe_with_whisper(audio_bytes: bytes, filename: str, language: str | None) -> str:
    client = _get_openai_client()
    if client is None:
        return ""
    buffer = io.BytesIO(audio_bytes)
    buffer.name = filename
    try:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=buffer,
            language=language or None,
            response_format="text",
        )
    except Exception as e:
        logger.exception("Whisper transcription failed: %s", e)
        return ""
    if isinstance(result, str):
        return result.strip()
    text = getattr(result, "text", None)
    return text.strip() if isinstance(text, str) else ""


def transcribe_audio(
    audio_bytes: bytes,
    *,
    filename: str = "audio.webm",
    language: str | None = "en",
) -> str:
    """Transcribe a chunk of audio. Returns plain text or "" on failure.

    Tries ElevenLabs Scribe first; falls back to OpenAI Whisper if Scribe
    returned empty / wasn't configured. Never raises — callers decide whether
    an empty transcript is recoverable.
    """
    if not audio_bytes:
        return ""

    if _get_elevenlabs_client() is not None:
        text = _transcribe_with_elevenlabs(audio_bytes, filename, language)
        if text:
            return text

    if _get_openai_client() is not None:
        return _transcribe_with_whisper(audio_bytes, filename, language)

    logger.warning("ASR skipped: neither ELEVENLABS_API_KEY nor OPENAI_API_KEY is set")
    return ""


# ════════════════════════════════════════════════════════════════
# ElevenLabs TTS
# ════════════════════════════════════════════════════════════════

# Interview round → ElevenLabs voice mapping.
#
# These are the default voices that ship with every ElevenLabs account, so
# any working API key will be able to hit them. The mapping is intentional:
#
#   Round 1 — HR / Behavioural     → Rachel (warm, calm, friendly)
#   Round 2 — Technical            → Adam (deep, male, focused)
#   Round 3 — System Design        → Antoni (articulate male, presenter tone)
#   Round 4 — Managerial           → Domi (authoritative female)
#   Round 5 — Negotiation          → Josh (assertive male)
#
# Each voice ID is a public default voice. If a user customises their
# ElevenLabs library they can override via env later.
VOICE_BY_ROUND: dict[int, str] = {
    1: "21m00Tcm4TlvDq8ikWAM",  # Rachel
    2: "pNInz6obpgDQGcFmaJgB",  # Adam
    3: "ErXwobaYiN019PkySvjV",  # Antoni
    4: "AZnzlk1XvdvUeBnXmlld",  # Domi
    5: "TxGEqnHWrfWFTfGW9XjX",  # Josh
}

DEFAULT_VOICE_ID = VOICE_BY_ROUND[1]


@lru_cache(maxsize=1)
def _get_elevenlabs_client():
    """Return a cached ElevenLabs client, or None if the key isn't set."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        return None
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError as e:
        logger.warning("elevenlabs package not installed: %s", e)
        return None
    try:
        return ElevenLabs(api_key=settings.elevenlabs_api_key)
    except Exception as e:
        logger.exception("Failed to construct ElevenLabs client: %s", e)
        return None


def is_tts_available() -> bool:
    """True if ElevenLabs text-to-speech can be performed."""
    return _get_elevenlabs_client() is not None


# Starter-plan guard — don't TTS prompts longer than this. Keeps us from
# eating the monthly character quota on one long interview.
MAX_TTS_CHARS = 900


# ── Daily TTS character counter (Phase 21 cost visibility) ────────────
# In-process counter keyed by UTC date string. Logs every increment so
# tail -f on the backend log answers "how much of the ElevenLabs quota
# have we burned today" without leaving the terminal. Resets at midnight
# UTC; persists nothing — single-instance demo deploy, not a billing
# system.

_daily_tts_chars: dict[str, int] = {}
_daily_tts_lock = threading.Lock()


def _today_utc_key() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).date().isoformat()


def _record_tts_chars(count: int) -> int:
    """Add `count` to today's bucket and return the new running total."""
    if count <= 0:
        return _daily_tts_chars.get(_today_utc_key(), 0)
    key = _today_utc_key()
    with _daily_tts_lock:
        total = _daily_tts_chars.get(key, 0) + count
        _daily_tts_chars[key] = total
    return total


def tts_chars_today() -> int:
    """Inspect today's count from logs / debug routes — read-only."""
    return _daily_tts_chars.get(_today_utc_key(), 0)


def _reset_tts_chars_for_tests() -> None:
    """Test-only helper."""
    with _daily_tts_lock:
        _daily_tts_chars.clear()


def synthesize_speech(
    text: str,
    *,
    voice_id: str | None = None,
    round_number: int | None = None,
) -> tuple[bytes, str] | None:
    """Generate an MP3 of the given text.

    Either pass a raw `voice_id` or a `round_number` (1-5). If neither is
    given, the round-1 Rachel voice is used. Returns (audio_bytes, voice_id)
    on success or None on failure / missing key.
    """
    client = _get_elevenlabs_client()
    if client is None:
        logger.info("ElevenLabs skipped: ELEVENLABS_API_KEY missing")
        return None

    clean_text = (text or "").strip()
    if not clean_text:
        return None
    if len(clean_text) > MAX_TTS_CHARS:
        # Truncate but keep whole sentences where possible
        cut = clean_text[:MAX_TTS_CHARS]
        last_stop = max(cut.rfind("."), cut.rfind("?"), cut.rfind("!"))
        if last_stop > 200:
            cut = cut[: last_stop + 1]
        clean_text = cut
        logger.info("Truncated TTS prompt to %d chars", len(clean_text))

    # Resolve the voice ID
    if voice_id is None and round_number is not None:
        voice_id = VOICE_BY_ROUND.get(round_number, DEFAULT_VOICE_ID)
    elif voice_id is None:
        voice_id = DEFAULT_VOICE_ID

    try:
        # ElevenLabs v2 SDK returns an iterator of audio chunks when you
        # call text_to_speech.convert(). We join them into a single bytes blob.
        audio_iter = client.text_to_speech.convert(
            voice_id=voice_id,
            text=clean_text,
            model_id="eleven_turbo_v2_5",  # cheapest fast model — 32k char/month on starter
            output_format="mp3_44100_128",
        )
        audio_bytes = b"".join(chunk for chunk in audio_iter if chunk)
    except Exception as e:
        logger.exception("ElevenLabs TTS failed: %s", e)
        return None

    # Bookkeeping: log the running day total so the demo runner can
    # check the ElevenLabs starter quota at a glance.
    running_total = _record_tts_chars(len(clean_text))
    logger.info(
        "ElevenLabs TTS: %s chars synthesized (today total: %s)",
        len(clean_text),
        running_total,
    )

    return audio_bytes, voice_id


def synthesize_and_save(
    text: str,
    *,
    voice_id: str | None = None,
    round_number: int | None = None,
) -> tuple[str, str] | None:
    """Generate TTS and persist it under uploads/audio/.

    Returns (public_url, voice_id) on success, None on failure.
    """
    result = synthesize_speech(text, voice_id=voice_id, round_number=round_number)
    if result is None:
        return None
    audio_bytes, used_voice = result
    _, public_url = save_audio_bytes(audio_bytes, extension="mp3")
    return public_url, used_voice
