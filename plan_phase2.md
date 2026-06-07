# DSA Coach — Phase 2 Plan (Curriculum Import + Chrome Extension)

> Detailed execution plan. Phase 1 (in-app Socratic coach + LeetCode redirect +
> self-report solve) is **done and verified**. Phase 2 turns the coach into a
> full **curriculum** driven by an uploaded question sheet, and gives it **eyes
> on LeetCode** via a browser extension so it can help where students actually
> grind.

## What Phase 1 already gives us (reuse, don't rebuild)

- `chat_type = 'dsa_coach'` sessions bound to a problem (`chat_sessions.coding_problem_id`), with `assistant_meta = {coach_mode, hint_level}`. — `backend/app/models/chat.py`
- The coach brain: `backend/app/services/dsa_coach.py` — Socratic system prompt, hint ladder (`nudge → guide → spell_it_out`), solution mode. Streams via `claude_client.stream_completion` (Haiku cost rule respected). **This is the single brain both Phase-2 front-ends call.**
- Dispatch in `routes/chat.py:send_message` (branches on `DSA_COACH`); request carries `coach_mode` + `hint_level`.
- `coding_problems.leetcode_url` + `POST /coding/problems/{slug}/mark-solved` (idempotent XP + skill-mastery via `coding_skill_mastery.bump_mastery_for_solve`).
- Frontend: `components/coding/CoachChat.tsx` (self-contained, reuses `ChatMessage` + `ChatInput`; Hint/Solution toggle + auto-escalating intensity ladder; **lazily creates the session on first message**). `CodingProblemPage` (view toggle: LeetCode+Coach | Code Editor; Open-on-LeetCode + I-solved-it). `chatApi.streamMessage({coachMode, hintLevel})`, `codingApi.markSolved`.

The two new surfaces in Phase 2 (in-app learning path, and the extension) are both **clients of the same coach endpoint** — the brain does not change.

> **Note:** the exact column names/shape below are assumed; confirm against the actual `.xlsx` when it arrives and adjust the importer's column map only. Everything else is shape-agnostic.

---

## Part A — Curriculum from the Excel sheet (in-app learning path)

**Goal:** ingest the sheet (questions classified by difficulty + type/pattern, an ordered study path, LeetCode links) into a curriculum the student walks in order, each problem opening the Phase-1 coach + LeetCode.

### A1. Data model

A pattern layer + a generalized problem row (so a LeetCode-only problem with no in-app judge can coexist with the 5 Phase-1 judge problems).

- **New** `coding_patterns` — `id, slug, name, description, order_index, skill_node_names (JSON)`. One row per pattern ("Two Pointers", "Sliding Window", "Binary Search", "BFS/DFS", "DP", …). `order_index` is the path order across patterns. `skill_node_names` maps the pattern onto Phase-15 skill-graph nodes so progress feeds the adaptive engine.
- **Extend** `coding_problems` (migration `000000000006`): add `pattern_id` (FK → coding_patterns, nullable), `path_order` (int, nullable), and a `source` enum `('seed_inapp' | 'curriculum')` defaulting to `seed_inapp`. **Make the judge-only columns nullable** (`function_signature`, `visible_test_cases`, `hidden_test_cases`, `starter_code`, `reference_solution`, `function_name`, `comparator`) so a curriculum row needs only `{slug, title, difficulty, leetcode_url, pattern_id, path_order, topic_tags, skill_node_names}`. Existing seed rows keep `source='seed_inapp'` and their judge fields.
  - Frontend impact: `ProblemDetail` judge fields become optional; `CodingProblemPage` only shows the **Code Editor** toggle when `source === 'seed_inapp'` (curriculum problems are LeetCode + Coach only).

### A2. Importer

`backend/scripts/import_curriculum.py` (run from `backend/`, mirrors `seed_demo.py`):
- Read `.xlsx` with **openpyxl** (light; add to `requirements.txt`) — or accept a CSV export to avoid the dep.
- Column map (confirm on receipt): `difficulty`, `pattern`/`type`, `order`, `title`, `link`.
- Derive `slug` from the LeetCode URL (`/problems/<slug>/`). Upsert patterns by slug (assign `order_index` by first-seen pattern order), then upsert problems by slug — **idempotent**, re-runnable.
- `difficulty` → `CodingDifficulty`; `pattern` → `pattern_id` + carry the pattern's `skill_node_names` onto the problem (so `mark-solved` still bumps the right skills).
- `--reset` flag to wipe `source='curriculum'` rows + patterns before re-import.

### A3. API

`backend/app/api/routes/coding.py`:
- `GET /coding/patterns` → ordered patterns, each with its problems (in `path_order`) + per-user solved status (reuse `_per_user_statuses`) + per-pattern progress.
- Reuse `mark-solved` unchanged.

### A4. Learning-path UI

Restructure `CodingProblemsPage` into two tabs (or a new `/student/coding/path`):
- **Path** (default): patterns as an ordered vertical stepper / accordion; each shows a progress bar (solved/total) and its problems in order, each row reusing the Phase-1 row (difficulty badge, solved check, **Coach** + **LeetCode** actions). "Continue" jumps to the first unsolved problem.
- **All problems**: the current flat filterable list.
- Surface the **Phase-15 adaptive engine**: highlight the pattern to focus next based on mastery gaps — this is where "the adaptive engine drives a real external curriculum" becomes literal (and strengthens the research narrative).

### A5. Verify (Part A)

Import the sheet → patterns + problems appear in order → open a curriculum problem → coach works, "Open on LeetCode" goes to the right URL, "I solved it" advances path progress + skill tree. `pytest` green, `typecheck/lint/build` clean.

---

## Part B — "Claude in Chrome"-style extension (the flagship)

**Goal:** a Manifest V3 extension whose side panel is the **same coach**, context-aware of the LeetCode problem the student is on (and their editor code + failed tests). LeetCode is the IDE; CampusIQ is the teacher that travels with them.

### B1. Backend: coach-by-LeetCode-slug

The extension sees LeetCode problems that may not be in our DB, so the coach must bind to a **slug + scraped context**, not only an internal UUID.
- Extend `ChatSessionCreate` (and `chat_service.create_session`) to accept `leetcode_slug` + optional `problem_context` (title/description/constraints scraped from the page) for `dsa_coach` sessions. Resolve order in `dsa_coach.stream_coach_response`: bound `coding_problem_id` → else match `coding_problems` by `leetcode_url`/slug → else use the passed-in `problem_context` straight in the prompt (no problem row persisted).
- Optionally add nullable `chat_sessions.leetcode_slug` (migration) so external sessions are found-or-created by slug.
- Per-message context: accept an optional `user_code` + `failed_tests` on the coach message so hints can be **specific to the student's current code** ("your inner loop never resets `current` — what should it reset to?"). This is the capability a redirect-only chat can't match.
- **CORS:** add `chrome-extension://<id>` to `CORS_ALLOWED_ORIGINS`.
- **Real-AC signal:** when the content script detects LeetCode's "Accepted", call `mark-solved` by slug → genuine, hard-to-fake completion feeding XP + mastery (we don't *need* it — coach is help, not police — but the extension gets it for free).

### B2. Extension (Manifest V3)

`extension/` (its own package; React + Vite, can import the existing `CoachChat`):
- **`manifest.json`**: `host_permissions: ["https://leetcode.com/*"]`, `permissions: ["sidePanel","storage","activeTab"]`, `externally_connectable.matches: ["https://<campusiq-domain>/*"]` (for the auth handshake), background service worker, content script on `https://leetcode.com/problems/*`.
- **Content script**: scrape `{slug (from URL), title, description, constraints}`; read the user's code from **Monaco** (`window.monaco.editor.getModels()[0].getValue()` — more robust than DOM) or LeetCode's GraphQL (`/graphql` `questionData`); detect submission results / failed cases. Push to the side panel via `chrome.runtime.sendMessage`. **Plan for selector breakage** (LeetCode is an obfuscated SPA) with a graceful "paste your code" fallback.
- **Side panel** (`chrome.sidePanel`): a small React app rendering **the Phase-1 `CoachChat`** (same Hint/Solution + ladder UX) bound to the current slug, attaching the scraped code/tests to each message. Re-binds automatically as the user navigates LeetCode problems.
- **Background service worker**: relays content-script ↔ side-panel messages; holds auth.

### B3. Auth bridge (JWT)

The extension calls the CampusIQ backend as the logged-in student:
- "Connect CampusIQ" in the side panel opens the web app login; on success the app `postMessage`/`chrome.runtime.sendMessage`s the JWT to the extension (allowed via `externally_connectable`). Store in `chrome.storage.local`; attach `Authorization: Bearer` to coach + mark-solved calls. Re-prompt on 401.

### B4. Distribution

**Side-load (Load unpacked)** for the capstone demo — zero store wait, fully demoable. Chrome Web Store submission later (review = days–weeks); does not gate the demo.

### B5. Verify (Part B)

Side-load → open a real LeetCode problem → side panel shows the coach bound to that problem → ask a hint → the coach references the actual problem + the student's current code (paste a buggy attempt, confirm the hint targets the bug) → escalate the ladder → switch to Solution → submit on LeetCode and confirm AC reporting flips the problem to solved + awards XP in the web app.

---

## Sequencing

1. **A1–A3** curriculum data model + importer + `GET /coding/patterns` (needs the real sheet).
2. **A4** learning-path UI (reuses Phase-1 coach + LeetCode/Coach row components).
3. **B1** coach-by-slug + per-message code context + CORS (unblocks both curriculum LeetCode-only problems and the extension).
4. **B2–B3** extension: manifest + content script + side panel (reuse `CoachChat`) + auth bridge.
5. **B5/real-AC** completion signal → `mark-solved` by slug.
6. End-to-end verify (Parts A + B).

## Risks / decisions to confirm

- **Excel shape** — confirm columns on receipt; only the importer's column map should change.
- **LeetCode scraping is brittle** — prefer Monaco/GraphQL hooks over DOM; ship the paste-fallback. Ongoing maintenance when LeetCode redesigns.
- **Judge-field nullability migration** — verify the 5 existing seed rows still validate after the columns go nullable (`source='seed_inapp'` keeps them whole).
- **Cost** — multi-turn coach + per-message code context uses more tokens; stay on Haiku, bound hint length (already capped at 600 tokens in `dsa_coach.py`), cache problem context in the session.
- **Scored surfaces** — keep coach/practice as *help*; only verified signals (quizzes, interviews, and optionally extension-confirmed real AC) feed the recruiter-facing pillars. Self-report stays in the unscored/low-trust lane.
