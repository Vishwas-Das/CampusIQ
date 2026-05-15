# CampusIQ backend — Render Web Service image.
#
# Built on python:3.12-slim because the venv we use locally is Python 3.12.
# Render injects the listen port via $PORT; the start command runs Alembic
# migrations on every boot (idempotent) so a fresh deploy lands a green DB.
#
# The image is intentionally fat (~3GB) because sentence-transformers
# pulls in torch + transformers for local embedding generation. If image
# size becomes a problem on Render, gate the heavy deps behind an env
# var and fall back to pre-embedded chunks only.

FROM python:3.12-slim AS builder

# System deps:
# - build-essential for any C extensions that don't have wheels
# - libpq5 + libpq-dev for psycopg2-binary parity (we use the binary
#   wheel in prod, but build deps stay handy if someone swaps to non-binary)
# - libgomp1 for sentence-transformers / torch
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache deps separately from app code so requirement-only changes don't
# bust the whole image.
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── Runtime stage ──
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the installed packages from the builder stage.
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# App code last (changes most often).
COPY . .

# Render sets $PORT at runtime. Local docker-compose maps host:8000.
ENV PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Run migrations on boot (idempotent), then start uvicorn. Single-instance
# deploys; if we ever go multi-replica, move alembic to a release phase
# instead of every container's startup.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
