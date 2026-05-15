# CampusIQ — Demo Day Runbook

A 10-minute walkthrough script for a classroom demo, plus the pre-flight
checklist so nothing surprises you on stage.

> Audience: 4th-sem CS faculty at RVCE.
> Focus: every flagship feature, real data, no smoke and mirrors.

---

## Pre-flight checklist (run 30 minutes before)

The demo runs against a hosted backend (Render Starter) + hosted
frontend (Vercel) + Supabase Postgres. Both teacher laptops and the
projector point at the same `https://campusiq.vercel.app` URL. See
[HOSTING.md](./HOSTING.md) for the one-time setup; this is the
on-the-day flow.

1. **Hosted backend health** — from any laptop on the demo network:
   ```bash
   curl https://<render-service>.onrender.com/health
   # → {"status":"ok","service":"CampusIQ API","version":"0.1.0","environment":"production"}
   ```
   If it 502s or times out: open the Render dashboard, redeploy the
   service, wait for green.

2. **Supabase project online** — open
   https://supabase.com/dashboard/project/<your-project-ref> and confirm
   "Active" status (the free-tier project pauses itself after 7 days
   of inactivity). If paused, hit "Restore project" and wait ~2 minutes.
   The UptimeRobot ping documented in HOSTING.md should normally keep
   this hot — but verify anyway.

3. **Render env vars set** — open Render → service → Environment and
   confirm these keys have real values:
   - `DATABASE_URL` (Supabase pooler, port 5432)
   - `JWT_SECRET_KEY` (32+ char random)
   - `ANTHROPIC_API_KEY` (production Anthropic key)
   - `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `CORS_ALLOWED_ORIGINS` includes the Vercel domain
   - `OPENAI_API_KEY` (for Whisper ASR — optional, falls back to
     browser SpeechRecognition)
   - `ELEVENLABS_API_KEY` (for 5-voice TTS — optional, falls back to
     browser speechSynthesis)

4. **Opus toggle for the final demo only:** in Render Environment, set
   ```
   USE_PRODUCTION_MODEL=True
   ```
   This swaps every Claude call from Haiku 4.5 to Opus 4.6 (~10× the
   per-call cost). Render auto-redeploys on save (~30s). **Flip back
   to `False` immediately after the demo** so dev sessions don't keep
   burning Opus.

5. **Seed / reset demo state** — open Render → service → Shell and run:
   ```bash
   cd /app && .venv/bin/python scripts/seed_demo.py --reset
   ```
   Restores the four canonical accounts (passwords all `DemoPass123`):
   - `teacher.a@example.com` — owns DAA (CD343AI)
   - `teacher.b@example.com` — owns DMS (CS241AT)
   - `student.demo@example.com` — rich state (CGPA, target Google SWE,
     4 quiz attempts incl. a deliberate weak-area, seeded resume)
   - `admin.demo@example.com`
   See `backend/scripts/README.md` for what's seeded.

6. **Dress-rehearsal smoke test** — from your laptop, run the
   Playwright harness against the hosted stack:
   ```bash
   cd frontend
   BASE_URL=https://campusiq.vercel.app \
   API_URL=https://<render-service>.onrender.com/api/v1 \
   npx playwright test scripts/dress_rehearsal.spec.ts
   ```
   The script walks every page in this runbook and asserts the key
   content on each. Test must pass. Inline timings tell you whether
   the demo really fits 10 minutes against the live network.

7. **Three browser profiles pre-logged-in** — using https://campusiq.vercel.app:
   - **Teacher A laptop**: signed in as `teacher.a@example.com`
   - **Teacher B laptop**: signed in as `teacher.b@example.com`
   - **Projector** (your driving laptop): signed in as
     `student.demo@example.com`. Cycle the top-bar theme to **dark**
     (crispest on a projector) and close DevTools + every noisy tab.
     A second profile signed in as `admin.demo@example.com` in another
     window is handy for the 9:45 admin moment.

8. **Recovery moves on stage** — memorise these:
   | Symptom | Fix |
   |---|---|
   | "Could not reach the server" toast | Render service crashed — open the dashboard, hit Manual Deploy. ~30s back. |
   | Voice interview hangs | Switch to Text mode (toggle on the chat input). |
   | Toast notifications stop appearing | Refresh the page; the WS reconnects with backoff. Check `/admin/notifications` for live delivery state. |
   | Quiz generation 502s | Anthropic rate limit. Wait 5s, retry once. |
   | 429 from any AI endpoint | The per-user Claude rate-limiter (20/min) fired. Pause, retry. |
   | Supabase paused mid-demo | Click "Restore project" in the Supabase dashboard. ~2min downtime. |

---

## 10-minute demo script

| min | what | where |
|---|---|---|
| 0:00 | **Landing page** — hero video, italic-serif headline, bento, two flagship showcases, CTA. "This is the surface a recruiter sees." | `/` |
| 0:30 | Click **Get started** → land on signup, pick **Student**, fill creds. | `/signup` |
| 1:00 | **Student dashboard** — XP / streak / 4-pillar score card, smart task feed (heap-prioritised), recent activity, announcements panel. Mention "the task feed is a min-heap of 4 signals — unattempted quizzes, failed retakes, weak topics, daily-login bonus." | `/student` |
| 1:30 | **AI Note Assistant** — pick a subject (the one you pre-uploaded the PDF to), ask a question. Streamed answer, scroll to see the cited chunk. | `/student/notes` |
| 2:30 | **CollegeGPT** — pre-uploaded handbook chat. Ask "what's the attendance requirement for labs?" Live RAG over Huffman-compressed chunks via pgvector. | `/student/college-gpt` |
| 3:30 | **Quiz** — open Quizzes, hit a published one, take it (~30 s of clicking), submit. See: per-question grading, weak-topic flagging, **adaptive next-difficulty hint** (greedy promote/demote), XP awarded → notification toast pops at bottom-right. | `/student/quizzes` |
| 4:30 | **Resume Builder** — open, type one chat message ("I'm Arun, CSE branch, built CampusIQ"), watch the AI Coach patch the live preview. Hit **ATS Score** with a sample JD, then **Import from GitHub** with `arun-sanjay`. | `/student/resume` |
| 5:30 | **Adaptive Learning Engine** (research core) — pick **Google → SWE**, slide hours to 15. Show: gap %, **Dijkstra paths** through the skill graph, **0/1 Knapsack** plan filling the time budget, **Prim's MST**. Mention dynamic edge rescaling. | `/student/skill-gap` |
| 6:30 | **Mock Interview** (text mode) — pick Google + Tough persona, send 1 answer per round, fast-forward to debrief showing hire verdict + per-round scores. Notification toast fires the moment the debrief lands. | `/student/interview` |
| 7:30 | **Confidence Coach** — record 30 s of yourself answering "tell me about yourself", stop → see eye-contact, posture, filler words, WPM, clarity (Claude-scored), Recharts timeline. | `/student/confidence` |
| 8:15 | **Boss Battle** — pick one, play the rapid-fire timed challenge, see the result + leaderboard. | `/student/boss-battles` |
| 8:45 | **Profile** → click **Share** → open the copied URL `/p/{id}` in a new tab. Show the public recruiter view with all 4 pillars, badges, target companies. "This is the link a student would put on their resume." | `/student/profile` → `/p/:id` |
| 9:15 | **Teacher view** (switch to profile B) — Class Performance page with score histogram, weakest topics, per-student trends; Similarity Checker showing **Hamming distance** flagged pairs. | `/teacher/analytics` |
| 9:45 | **Admin view** (profile C) — Skill Analytics with the **inclusion-exclusion** Venn breakdown, then flip to **Notification Status** to show the live TCP-style delivery table (retries, ACKed timestamps, per-row latency_ms). Have a teacher post a fresh announcement on Laptop A while the projector watches the row appear, retry, and flip to ACKED in real time. | `/admin/skill-analytics` → `/admin/notifications` |
| 10:00 | Q&A. |

---

## Talking points to emphasize

- **Research paper core (Phase 15):** dynamic edge weights `adjusted = base × (1 − α·mastery(u)) × (1 + β·(1 − mastery(v)))`. α = 0.55 confidence discount, β = 0.40 urgency surcharge.
- **DAA / DMS / CN syllabus mapping:** Heap (Unit III) on the task feed. Greedy + Dijkstra + Knapsack + Prim's + Huffman (Unit IV). DFS unlock detection (Unit II) on the skill tree. Backtracking + branch-and-bound (Unit V) on Crash Mode; round-robin spread for the regular weekly Schedule. Hamming + inclusion-exclusion + graph coloring on the algorithm showcase pages. **TCP-style sequence numbers + client ACKs + exponential-backoff retry (1, 2, 4, 8s)** on the notification delivery — verifiable live on the `/admin/notifications` page.
- **Cost rule:** every dev/test call uses Haiku 4.5 (~$0.0002/turn). Opus 4.6 only flips on for the live demo.
- **Graceful degradation:** voice interview falls back to browser TTS; ATS scoring 503s cleanly when Anthropic is off; MediaPipe falls back to fallback metrics.

---

## After the demo

- Flip `USE_PRODUCTION_MODEL=False` back to Haiku to stop bleeding Opus credits.
- Run `python scripts/reset_demo.py && python scripts/seed_demo.py` on
  Render's shell to reset the four demo accounts to a clean baseline
  in case the next rehearsal needs it.
- Capture any feedback into `PHASES.md` under "Phase 22 — post-demo follow-ups".
