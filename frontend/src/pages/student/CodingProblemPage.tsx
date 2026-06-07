import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  Play,
  Send,
  RotateCcw,
  Trophy,
  ExternalLink,
  CheckCircle2,
  Code2,
  Lightbulb,
} from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, codingApi } from '../../api/client'
import ProblemDescription from '../../components/coding/ProblemDescription'
import CodeEditor from '../../components/coding/CodeEditor'
import TestResultPanel from '../../components/coding/TestResultPanel'
import CoachChat from '../../components/coding/CoachChat'
import { runUserCode, type TestResult } from '../../components/coding/pyodideRunner'
import type { ProblemDetail, ProblemRunnerPayload } from '../../types'

type RunStatus = 'passed' | 'failed' | 'error' | null
type View = 'coach' | 'editor'
type XpBanner = {
  xp_earned: number
  leveled_up: boolean
  new_level?: number | null
  source: 'submit' | 'leetcode'
}

function localStorageKeyFor(slug: string): string {
  return `campusiq-code-${slug}`
}

export default function CodingProblemPage() {
  const { slug } = useParams<{ slug: string }>()
  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // LeetCode + Coach is the focus; the in-app editor is an optional toggle.
  const [view, setView] = useState<View>('coach')

  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [markingSolved, setMarkingSolved] = useState(false)

  const [results, setResults] = useState<TestResult[] | null>(null)
  const [status, setStatus] = useState<RunStatus>(null)
  const [passedCount, setPassedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [runtimeMs, setRuntimeMs] = useState<number | undefined>(undefined)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [xpBanner, setXpBanner] = useState<XpBanner | null>(null)

  // Cache the runner payload (hidden tests) per problem so Submit doesn't
  // hit the network every time.
  const runnerPayloadRef = useRef<ProblemRunnerPayload | null>(null)

  // ── Load problem on mount / slug change ──
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoading(true)
    setError(null)
    runnerPayloadRef.current = null
    void (async () => {
      try {
        const p = await codingApi.getProblem(slug)
        if (cancelled) return
        setProblem(p)
        const stored = window.localStorage.getItem(localStorageKeyFor(slug))
        const starter = p.starter_code.python ?? Object.values(p.starter_code)[0] ?? ''
        setCode(stored ?? starter)
        setResults(null)
        setStatus(null)
        setXpBanner(null)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load this problem.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  // ── Persist in-progress code to localStorage ──
  useEffect(() => {
    if (!slug) return
    if (code === '') return
    try {
      window.localStorage.setItem(localStorageKeyFor(slug), code)
    } catch {
      /* quota / privacy mode — fine to ignore */
    }
  }, [code, slug])

  const applyRunOutcome = useCallback(
    (outcome: Awaited<ReturnType<typeof runUserCode>>) => {
      setResults(outcome.results)
      setStatus(outcome.status)
      setPassedCount(outcome.passedCount)
      setTotalCount(outcome.totalCount)
      setRuntimeMs(outcome.runtimeMs)
      setErrorMessage(outcome.errorMessage)
    },
    [],
  )

  const handleRun = useCallback(async () => {
    if (!problem || running || submitting) return
    setRunning(true)
    setXpBanner(null)
    try {
      const outcome = await runUserCode({
        userCode: code,
        functionName: problem.function_name,
        testCases: problem.visible_test_cases,
        comparator: problem.comparator,
      })
      applyRunOutcome(outcome)
    } finally {
      setRunning(false)
    }
  }, [problem, running, submitting, code, applyRunOutcome])

  const handleSubmit = useCallback(async () => {
    if (!problem || !slug || running || submitting) return
    setSubmitting(true)
    setXpBanner(null)
    try {
      // Fetch the full runner payload (visible + hidden) lazily.
      let payload = runnerPayloadRef.current
      if (!payload) {
        payload = await codingApi.getRunnerPayload(slug)
        runnerPayloadRef.current = payload
      }
      const allTests = [...payload.visible_test_cases, ...payload.hidden_test_cases]
      const outcome = await runUserCode({
        userCode: code,
        functionName: problem.function_name,
        testCases: allTests,
        comparator: problem.comparator,
      })
      applyRunOutcome(outcome)

      const submitResult = await codingApi.submit(slug, {
        language: 'python',
        code,
        status: outcome.status,
        passed_count: outcome.passedCount,
        total_count: outcome.totalCount,
        runtime_ms: Math.round(outcome.runtimeMs),
        error_message: outcome.errorMessage,
      })

      if (submitResult.first_solve) {
        setXpBanner({
          xp_earned: submitResult.xp_earned,
          leveled_up: submitResult.leveled_up,
          new_level: submitResult.new_level,
          source: 'submit',
        })
        // Refresh problem to pick up the unlocked reference solution.
        try {
          const refreshed = await codingApi.getProblem(slug)
          setProblem(refreshed)
        } catch {
          /* non-fatal — banner still shows */
        }
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Submission failed.',
      )
    } finally {
      setSubmitting(false)
    }
  }, [problem, slug, running, submitting, code, applyRunOutcome])

  const handleMarkSolved = useCallback(async () => {
    if (!problem || !slug || markingSolved) return
    setMarkingSolved(true)
    setXpBanner(null)
    try {
      const res = await codingApi.markSolved(slug)
      if (res.first_solve) {
        setXpBanner({
          xp_earned: res.xp_earned,
          leveled_up: res.leveled_up,
          new_level: res.new_level,
          source: 'leetcode',
        })
      }
      // Refresh so the status flips to Solved and the reference solution unlocks.
      try {
        const refreshed = await codingApi.getProblem(slug)
        setProblem(refreshed)
      } catch {
        /* non-fatal */
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not log this as solved.',
      )
    } finally {
      setMarkingSolved(false)
    }
  }, [problem, slug, markingSolved])

  const handleReset = useCallback(() => {
    if (!problem) return
    const starter = problem.starter_code.python ?? Object.values(problem.starter_code)[0] ?? ''
    setCode(starter)
  }, [problem])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] p-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading problem…
      </div>
    )
  }

  if (error || !problem) {
    return (
      <div className="space-y-3">
        <Link
          to="/student/coding"
          className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to problems
        </Link>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error ?? 'Problem not found.'}</span>
        </div>
      </div>
    )
  }

  const solved = problem.user_status === 'solved'

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Top action bar: back · view toggle · LeetCode + I-solved-it */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <Link
            to="/student/coding"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <ViewToggle view={view} onChange={setView} />
        </div>

        <div className="flex items-center gap-2">
          <a
            href={problem.leetcode_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open on LeetCode
          </a>
          {solved ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-success/15 text-success border border-success/30">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Solved
            </span>
          ) : (
            <button
              type="button"
              onClick={handleMarkSolved}
              disabled={markingSolved}
              title="Log that you solved this on LeetCode — awards XP + skill mastery"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors',
                'border-success/40 text-success hover:bg-success/10',
                markingSolved && 'opacity-50 cursor-not-allowed',
              )}
            >
              {markingSolved ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              I solved it
            </button>
          )}
        </div>
      </div>

      {xpBanner && (
        <div className="mb-3 flex items-center gap-3 p-3 rounded-lg border border-success/30 bg-success/10 text-sm">
          <Trophy className="h-5 w-5 text-success shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-success">
              {xpBanner.source === 'submit' ? 'First Accepted!' : 'Nice — logged as solved!'}
            </div>
            <div className="text-[var(--text-secondary)] text-[12.5px]">
              +{xpBanner.xp_earned} XP
              {xpBanner.leveled_up ? ` — you leveled up to level ${xpBanner.new_level}!` : ''}
              . Reference solution is now visible on the left.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 flex-1">
        <section className="overflow-y-auto pr-1">
          <ProblemDescription
            title={problem.title}
            difficulty={problem.difficulty}
            topicTags={problem.topic_tags}
            description={problem.description}
            examples={problem.examples}
            hints={problem.hints}
            referenceSolution={problem.reference_solution}
            solved={solved}
          />
        </section>

        <section className="flex flex-col min-h-0">
          {view === 'editor' ? (
            <>
              <ActionBar
                running={running}
                submitting={submitting}
                onRun={handleRun}
                onSubmit={handleSubmit}
                onReset={handleReset}
              />
              <div className="flex-1 min-h-[240px] rounded-lg border border-[var(--border-default)] overflow-hidden bg-[var(--bg-secondary)]">
                <CodeEditor value={code} onChange={setCode} language="python" />
              </div>
              <div className="mt-3 overflow-y-auto max-h-[40vh]">
                <TestResultPanel
                  loading={running || submitting}
                  results={results}
                  errorMessage={errorMessage}
                  status={status}
                  passedCount={passedCount}
                  totalCount={totalCount}
                  runtimeMs={runtimeMs}
                />
              </div>
            </>
          ) : (
            <CoachChat problemId={problem.id} problemTitle={problem.title} />
          )}
        </section>
      </div>
    </div>
  )
}


function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { key: View; label: string; Icon: typeof Lightbulb }[] = [
    { key: 'coach', label: 'LeetCode + Coach', Icon: Lightbulb },
    { key: 'editor', label: 'Code Editor', Icon: Code2 },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className="inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]"
    >
      {opts.map(({ key, label, Icon }) => {
        const active = key === view
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}


function ActionBar({
  running,
  submitting,
  onRun,
  onSubmit,
  onReset,
}: {
  running: boolean
  submitting: boolean
  onRun: () => void
  onSubmit: () => void
  onReset: () => void
}) {
  const busy = running || submitting
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors',
            'border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
            busy && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            busy && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Send className="h-3.5 w-3.5" />
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      <button
        type="button"
        onClick={onReset}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title="Reset code to the starter template"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>
    </div>
  )
}
