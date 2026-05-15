/**
 * CampusIQ dress-rehearsal harness.
 *
 * Walks the 10-minute DEMO.md script end-to-end against a running
 * frontend + backend, asserts the key text on each page, and prints
 * a per-step timestamp at the end so you can confirm the demo really
 * fits in 10 minutes.
 *
 * Use this 30 minutes before stage time as part of the pre-flight
 * checklist in DEMO.md. Catching a 404 or a broken streaming endpoint
 * in this script saves a live demo from blowing up.
 *
 * --------------------------------------------------------------------
 * One-time setup:
 *
 *   cd frontend
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *
 * Run:
 *
 *   # Local dev (both servers running):
 *   BASE_URL=http://localhost:5173 \
 *   API_URL=http://127.0.0.1:8000/api/v1 \
 *   npx playwright test scripts/dress_rehearsal.spec.ts
 *
 *   # Against hosted Render + Vercel (the real demo path):
 *   BASE_URL=https://campusiq.vercel.app \
 *   API_URL=https://campusiq-backend.onrender.com/api/v1 \
 *   npx playwright test scripts/dress_rehearsal.spec.ts
 *
 * The harness assumes `scripts/seed_demo.py` has been run so the
 * `student.demo@example.com / DemoPass123` account exists with the
 * seeded quizzes + resume + announcements.
 * --------------------------------------------------------------------
 */
import { expect, test } from '@playwright/test'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000/api/v1'

const STUDENT_EMAIL = 'student.demo@example.com'
const TEACHER_EMAIL = 'teacher.a@example.com'
const ADMIN_EMAIL = 'admin.demo@example.com'
const DEMO_PASSWORD = 'DemoPass123'

// Timings the demo runner targets (minutes:seconds since stage start).
const SCRIPT_BUDGET_MS = 10 * 60 * 1000 // 10 minutes total

interface Step {
  label: string
  startedAt: number
  durationMs: number
}

async function loginViaApi(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const resp = await request.post(`${API_URL}/auth/login`, {
    data: { email, password: DEMO_PASSWORD },
  })
  if (!resp.ok()) {
    throw new Error(`login failed for ${email}: ${resp.status()} ${await resp.text()}`)
  }
  const body = await resp.json()
  return { token: body.access_token, user: body.user }
}

test.describe('CampusIQ demo dress rehearsal', () => {
  test('10-minute demo walkthrough hits every page', async ({ page, request }) => {
    test.setTimeout(SCRIPT_BUDGET_MS + 60_000) // budget + 1 min slack for awaits

    const steps: Step[] = []
    const startedTotal = Date.now()

    const track = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now()
      const out = await run()
      steps.push({
        label,
        startedAt: startedAt - startedTotal,
        durationMs: Date.now() - startedAt,
      })
      return out
    }

    // ── 0:00 Landing ──
    await track('Landing page hero loads', async () => {
      await page.goto(`${BASE_URL}/`)
      // Marketing hero / CTA — the landing page has multiple "Get started"
      // entry points; any one is enough proof the page rendered.
      await expect(page.getByText(/Get started/i).first()).toBeVisible({
        timeout: 15_000,
      })
    })

    // ── Auth → student ──
    await track('Login as seeded student', async () => {
      const { token, user } = await loginViaApi(request, STUDENT_EMAIL)
      await page.addInitScript(
        ([t, u]) => {
          window.localStorage.setItem(
            'campusiq-auth',
            JSON.stringify({ state: { user: u, token: t }, version: 0 }),
          )
        },
        [token, user] as const,
      )
    })

    // ── 1:00 Student dashboard ──
    await track('Student dashboard shows seeded XP/streak', async () => {
      await page.goto(`${BASE_URL}/student`)
      await expect(page.getByText(/Dashboard/i).first()).toBeVisible()
      // Seeded student has CGPA 9.10 and XP 420 — assert at least one
      // surfaces so we know the profile load worked.
      await expect(
        page.getByText(/420|CampusIQ Score|Score|Streak/i).first(),
      ).toBeVisible()
    })

    // ── 1:30 AI Note Assistant ──
    await track('Note Assistant page mounts', async () => {
      await page.goto(`${BASE_URL}/student/notes`)
      await expect(
        page.getByText(/Note Assistant|AI Note|Subjects/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 2:30 CollegeGPT ──
    await track('CollegeGPT page mounts', async () => {
      await page.goto(`${BASE_URL}/student/college-gpt`)
      await expect(
        page.getByText(/CollegeGPT|RVCE|Handbook/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 3:30 Quiz list (we navigate but don't auto-take a quiz — the
    // student would do that live with ~30s of clicking) ──
    await track('Quiz list shows seeded quizzes', async () => {
      await page.goto(`${BASE_URL}/student/quizzes`)
      // At least one of the five seeded quizzes by title.
      await expect(
        page.getByText(/Huffman|Dijkstra|Knapsack|Set Theory|Graphs/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 4:30 Resume Builder ──
    await track('Resume Builder shows seeded content', async () => {
      await page.goto(`${BASE_URL}/student/resume`)
      // Seeded resume name + at least one seeded project.
      await expect(page.getByText('Demo Student').first()).toBeVisible({
        timeout: 10_000,
      })
      await expect(page.getByText(/CampusIQ/i).first()).toBeVisible()
    })

    // ── 5:30 Skill Gap (research core) ──
    await track('Adaptive Learning Engine renders Dijkstra paths', async () => {
      await page.goto(`${BASE_URL}/student/skill-gap`)
      await expect(
        page.getByText(/Adaptive Learning Engine|Skill Gap|Dijkstra/i).first(),
      ).toBeVisible({ timeout: 10_000 })
      // Either the skeleton or the plan body needs to show up within ~10s.
      await expect(
        page
          .getByText(/Computing your adaptive plan|Gap Score|Skill Map/i)
          .first(),
      ).toBeVisible({ timeout: 12_000 })
    })

    // ── 6:30 Mock Interview (setup screen — no live AI call) ──
    await track('Mock Interview setup screen', async () => {
      await page.goto(`${BASE_URL}/student/interview`)
      await expect(
        page.getByText(/Mock Interview|Persona|Company|Start Interview/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 7:30 Confidence Coach (setup, no recording) ──
    await track('Confidence Coach page mounts', async () => {
      await page.goto(`${BASE_URL}/student/confidence`)
      await expect(
        page.getByText(/Confidence|Start Recording|Filler|Eye Contact/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 8:15 Boss Battles ──
    await track('Boss Battles shows the auto-seeded battles', async () => {
      await page.goto(`${BASE_URL}/student/boss-battles`)
      await expect(
        page.getByText(/Algorithms Boss Battle|Discrete Math Speed Round|Computer Networks Sprint/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 8:45 Profile → share link ──
    let studentId: string | null = null
    await track('Profile page renders the seeded persona', async () => {
      await page.goto(`${BASE_URL}/student/profile`)
      await expect(page.getByText('Demo Student').first()).toBeVisible({
        timeout: 10_000,
      })
      // Pull the student id out of localStorage (set during the login step
      // via addInitScript) so we can hit the public profile URL next.
      const id = await page.evaluate(() => {
        const raw = window.localStorage.getItem('campusiq-auth')
        if (!raw) return null
        try {
          return JSON.parse(raw)?.state?.user?.id ?? null
        } catch {
          return null
        }
      })
      studentId = typeof id === 'string' ? id : null
      expect(studentId, 'expected student id in persisted auth state').toBeTruthy()
    })

    // ── 8:55 Public recruiter profile (open in same tab) ──
    await track('Public recruiter profile loads', async () => {
      if (!studentId) test.skip(true, 'no student id')
      await page.goto(`${BASE_URL}/p/${studentId}`)
      await expect(page.getByText('Public profile').first()).toBeVisible({
        timeout: 10_000,
      })
    })

    // ── 9:15 Teacher view ──
    await track('Teacher analytics view', async () => {
      const { token, user } = await loginViaApi(request, TEACHER_EMAIL)
      await page.evaluate(
        ([t, u]) => {
          window.localStorage.setItem(
            'campusiq-auth',
            JSON.stringify({ state: { user: u, token: t }, version: 0 }),
          )
        },
        [token, user] as const,
      )
      await page.goto(`${BASE_URL}/teacher`)
      await expect(
        page.getByText(/Teacher|Analytics|Class|Students/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── 9:45 Admin notification + skill analytics view ──
    await track('Admin notification dashboard', async () => {
      const { token, user } = await loginViaApi(request, ADMIN_EMAIL)
      await page.evaluate(
        ([t, u]) => {
          window.localStorage.setItem(
            'campusiq-auth',
            JSON.stringify({ state: { user: u, token: t }, version: 0 }),
          )
        },
        [token, user] as const,
      )
      await page.goto(`${BASE_URL}/admin/notifications`)
      await expect(
        page.getByText(/Notification Status|DELIVERY RATE|PENDING|FAILED/i).first(),
      ).toBeVisible({ timeout: 10_000 })
    })

    // ── Report ──
    const totalMs = Date.now() - startedTotal
    // Test output goes to the test report — easier to read than the
    // raw console.log when running in CI.
    console.log('\nDress rehearsal step timings:')
    for (const s of steps) {
      const mm = Math.floor(s.startedAt / 60000)
      const ss = Math.floor((s.startedAt % 60000) / 1000)
      console.log(
        `  ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ` +
          `${s.durationMs.toString().padStart(5)} ms  ${s.label}`,
      )
    }
    console.log(
      `\nTotal: ${(totalMs / 1000).toFixed(1)}s  (10-min budget: ${(
        SCRIPT_BUDGET_MS / 1000
      ).toFixed(0)}s)`,
    )

    expect(totalMs, 'demo path took longer than the 10-minute budget').toBeLessThan(
      SCRIPT_BUDGET_MS,
    )
  })
})
