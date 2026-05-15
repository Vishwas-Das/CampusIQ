# Demo seed + reset scripts

Two tiny CLIs to manage the canonical CampusIQ demo state. Run them
from the `backend/` directory so the `.env` loader picks up the right
`DATABASE_URL`.

## `seed_demo.py` — idempotent demo seed

```bash
cd backend
.venv/bin/python scripts/seed_demo.py            # idempotent upsert
.venv/bin/python scripts/seed_demo.py --reset    # wipe + reseed (clean baseline)
.venv/bin/python scripts/seed_demo.py --no-rag   # reserved flag (no-op today)
```

Creates four accounts with fixed password `DemoPass123`:

| Role | Email | What's there |
|---|---|---|
| Teacher A (DAA) | `teacher.a@example.com` | Owns CD343AI · 3 quizzes (Huffman, Dijkstra, 0/1 Knapsack) · 1 announcement |
| Teacher B (DMS) | `teacher.b@example.com` | Owns CS241AT · 2 quizzes (Set Theory + Inclusion-Exclusion, Graphs + Coloring) · 1 announcement |
| Student | `student.demo@example.com` | Profile filled in (CSE 4th sem, CGPA 9.10, target Google SWE, GitHub `arun-sanjay`) · 4 quiz attempts (one strong on Dijkstra, one **weak on Knapsack** so the weak-area panel lights up) · seeded resume with the CampusIQ + Quiz Engine projects · one `study_optimizer_results` row so SkillGap has prior history |
| Admin | `admin.demo@example.com` | Plain admin account |

Boss battles are auto-seeded by the existing `boss_battles_service.seed_sample_battles`
(per-title idempotent), so the leaderboard, Hamming similarity, and quiz-scheduling
demos all have data on first request.

## `reset_demo.py` — wipe only the demo accounts

```bash
cd backend
.venv/bin/python scripts/reset_demo.py
```

Deletes the four demo users; `ondelete="CASCADE"` on their FKs drops their
attempts, resume, profile, announcements, and study optimizer rows with
them. Other accounts on the DB (including the seeded boss-battle `Challenge`
rows) are left alone. Re-running `seed_demo.py` afterward restores the
baseline in under a second.

## When to use

| Situation | Command |
|---|---|
| Fresh DB on a new Render deploy | `seed_demo.py` |
| Demo accounts got into a weird state mid-rehearsal | `seed_demo.py --reset` |
| One demo run ended with the student's resume edited / quizzes attempted in surprising ways | `reset_demo.py && seed_demo.py` |
| Adding a new question to a seeded quiz | Manually edit the quiz in the SQL DB; the script's `get_or_create_quiz` only inserts when missing — it won't overwrite |

## Reseeding under Render

The hosted Render service has a shell — Render → service → Shell tab. Run:

```bash
cd /app && .venv/bin/python scripts/seed_demo.py --reset
```

Same script, same idempotent behaviour. The `--reset` is safe because the
demo users are namespaced by their well-known emails.
