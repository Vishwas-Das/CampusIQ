# CampusIQ — Hosting Runbook

Single hosted backend (Render), frontend on Vercel, database on Supabase
free tier. The two-teacher-laptop + projector demo setup all points at
one URL, so this is the only deploy that matters for the demo.

## One-time setup

### 1. Backend → Render

The Render Blueprint at `render.yaml` declares the Web Service. To use it:

1. Push the repo to GitHub (default branch `main`).
2. In Render dashboard → **New** → **Blueprint**.
3. Connect the repo. Render reads `render.yaml` and offers to create
   `campusiq-backend` as a Docker Web Service on the Starter plan
   (~$7/mo always-on; the free plan sleeps after 15 min idle, which is
   unacceptable for a live demo).
4. Fill the env vars Render flagged as `sync: false`:
   - `DATABASE_URL` — Supabase pooler URL (port 5432, see Supabase
     dashboard → Settings → Database).
   - `JWT_SECRET_KEY` — `python -c "import secrets; print(secrets.token_hex(32))"`.
   - `ANTHROPIC_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - `CORS_ALLOWED_ORIGINS` — the Vercel domain(s), e.g.
     `https://campusiq.vercel.app`. Comma-separated. Wildcards aren't
     supported.
   - **Optional**: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`. Without them
     the voice mode falls back to the browser's `speechSynthesis` and
     `SpeechRecognition` (free, robotic but reliable).
5. Deploy. Render builds the Dockerfile, boots, runs `alembic upgrade
   head`, then `uvicorn`. First build is ~6 min because of the
   torch/transformers wheels; subsequent builds reuse cached layers.

### 2. Frontend → Vercel

The Vercel project is already set up (`frontend/vercel.json`). One env
var to add:

- `VITE_API_BASE_URL = https://<render-service-name>.onrender.com/api/v1`

Redeploy after setting it.

### 3. Supabase keep-warm

Supabase's free tier pauses the project after 7 days of inactivity. Two
options:

- **Free**: register at https://uptimerobot.com or
  https://cron-job.org, add a 5-minute interval HTTP GET against
  `https://<render-service-name>.onrender.com/health`. This both keeps
  Render warm (free plan only) and prevents Supabase from idling out.
- **Paid** (~$25/mo): upgrade Supabase to the Pro plan for demo week.

If the project pauses anyway: open the Supabase dashboard and click
"Restore project". Takes ~2 minutes. Pre-flight 30 min before demo.

## Verify before the demo

```bash
# Backend health
curl https://<render>.onrender.com/health
# → {"status":"ok","service":"CampusIQ API","version":"0.1.0","environment":"production"}

# Auth roundtrip from a fresh terminal (proves CORS-less REST works)
curl -sX POST https://<render>.onrender.com/api/v1/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"<seeded>","password":"<seeded>"}'

# Frontend
open https://campusiq.vercel.app
# Sign in with a seeded account — should land on the dashboard with the
# WebSocket toast indicator green.
```

## Demo-day model toggle

For the final demo only, flip Render's `USE_PRODUCTION_MODEL=True` to
switch every Claude call from Haiku to Opus 4.6 (~10× cost per call).
Flip back to `False` immediately after the demo.

The ElevenLabs starter plan gives ~32,000 chars/month — roughly 7-8
full interviews. Watch the backend log for the running daily total:

```
ElevenLabs TTS: 612 chars synthesized (today total: 4128)
```

## Local Docker parity

To verify the image builds and boots before pushing:

```bash
cd backend
cp .env.example .env  # fill in values
cd ..
docker compose up backend
curl http://localhost:8000/health
docker compose down
```

The volume mount in `docker-compose.yml` exposes the local `app/` so
edits show up without a rebuild — drop the `volumes:` block to test
the production image exactly as Render will run it.

## Recovery moves on stage

| Symptom | First move |
|---|---|
| Frontend shows "Could not reach the server" | Render service crashed — check the Render dashboard logs, redeploy if needed. Backup: keep an `ngrok http 8000` tunnel ready against a local backend as a last resort. |
| Voice interview hangs | Switch to Text mode in the same session (button on the chat input). |
| WebSocket toast doesn't appear | Refresh the page; the WS reconnects with exponential backoff. The `/admin/notifications` page surfaces the live delivery state. |
| Quiz generation 502s | Anthropic rate limit or quota — rerun once. Watch for 429s on the rate-limit guardrail; if so, wait 5 seconds and retry. |
| Supabase paused mid-demo | Open the dashboard, hit "Restore project". 2 min downtime. |
