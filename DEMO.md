# CampusIQ — Demo Day Runbook

A 10-minute walkthrough script for a classroom demo, plus the pre-flight
checklist so nothing surprises you on stage.

> Audience: 4th-sem CS faculty at RVCE.
> Focus: every flagship feature, real data, no smoke and mirrors.

---

## Pre-flight checklist (run 30 minutes before)

1. **Supabase project online** — open your project dashboard at
   `https://supabase.com/dashboard/project/<your-project-ref>` and confirm
   "Active" status (the project pauses itself after 7 days of inactivity).
   If paused, hit "Restore project" and wait ~2 minutes.

2. **Env files filled** — both `backend/.env` and `frontend/.env` exist with
   real values. Use the `.env.example` files as templates. Required keys for
   the full demo experience:
   - `DATABASE_URL` (Supabase pooler URL)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET_KEY` (any 32+ char random string)
   - `ANTHROPIC_API_KEY` (Haiku is enough; flip Opus only on demo day)
   - `ELEVENLABS_API_KEY` (optional — without it the demo falls back to
     the browser's built-in voice, which still works)

3. **Opus toggle (optional, for the final demo only):**
   ```
   USE_PRODUCTION_MODEL=True
   ```
   in `backend/.env`. This switches Claude from Haiku 4.5 to Opus 4.6 for
   every AI call. Costs ~10× more per call — flip back to `False` after.

4. **Boot both servers:**
   ```bash
   # Terminal 1 — backend
   cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

   # Terminal 2 — frontend
   cd frontend && npm run dev
   ```
   Verify:
   - http://127.0.0.1:8000/health → 200, `{"status":"ok"}`
   - http://localhost:5173/ → landing page loads, hero video plays

5. **Cosmetic tune-ups:**
   - Cycle to the **dark** theme (top-bar theme switcher) — looks crispest
     for projector display.
   - Close DevTools and any noisy browser tabs.
   - Pre-load the demo accounts in two separate browser profiles so you can
     sign in instantly without typing passwords:
       - profile A → student account
       - profile B → teacher account
       - profile C (optional) → admin account
   - Pre-upload at least one PDF (e.g., the RVCE handbook) via the admin
     CollegeGPT page so the chat demo has real content to cite.

6. **Recovery moves (memorise these):**
   - "Could not reach the server" — backend died; restart Terminal 1.
   - Voice interview hangs — switch to Text mode in the same session
     (button on the chat input).
   - WebSocket toast doesn't appear — refresh the page; the WS reconnects.
   - Quiz generation 502s — Anthropic rate limit; rerun once.

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
| 9:45 | **Admin view** (profile C) — Skill Analytics with the **inclusion-exclusion** Venn breakdown. Notification status table. Wrap up. | `/admin/skill-analytics` |
| 10:00 | Q&A. |

---

## Talking points to emphasize

- **Research paper core (Phase 15):** dynamic edge weights `adjusted = base × (1 − α·mastery(u)) × (1 + β·(1 − mastery(v)))`. α = 0.55 confidence discount, β = 0.40 urgency surcharge.
- **DAA / DMS / CN syllabus mapping:** Heap (Unit III) on the task feed. Greedy + Dijkstra + Knapsack + Prim's + Huffman (Unit IV). DFS unlock detection (Unit II) on the skill tree. Backtracking (Unit V) on the schedule. Hamming + inclusion-exclusion + graph coloring on the algorithm showcase pages. TCP-style sequence numbers on the notification delivery.
- **Cost rule:** every dev/test call uses Haiku 4.5 (~$0.0002/turn). Opus 4.6 only flips on for the live demo.
- **Graceful degradation:** voice interview falls back to browser TTS; ATS scoring 503s cleanly when Anthropic is off; MediaPipe falls back to fallback metrics.

---

## After the demo

- Flip `USE_PRODUCTION_MODEL=False` back to Haiku to stop bleeding Opus credits.
- Capture any feedback into `PHASES.md` under "Phase 22 — post-demo follow-ups".
