import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Flag,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X as XIcon,
  XCircle,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, quizzesApi } from '../../api/client'
import type { QuizAttemptResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-danger'
}

function scoreBarColor(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

export default function QuizResultPage() {
  const { quizId, attemptId } = useParams<{ quizId: string; attemptId: string }>()
  const navigate = useNavigate()
  const [result, setResult] = useState<QuizAttemptResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Flag state (mirror of the taking page) ──
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [flagReasonsById, setFlagReasonsById] = useState<Record<string, string | null>>({})
  const [flagPopoverFor, setFlagPopoverFor] = useState<string | null>(null)
  const [flagPopoverReason, setFlagPopoverReason] = useState('')
  const [flagBusy, setFlagBusy] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  // After-submit flagging is allowed for FLAG_AFTER_SUBMIT_DAYS days.
  // Past that, the icon still shows the flag state but clicking it doesn't
  // open the popover. Backend ALSO enforces this (frontend is just UX).
  const FLAG_AFTER_SUBMIT_DAYS = 3
  const canFlagAfterSubmit = useMemo(() => {
    if (!result) return false
    const submitted = new Date(result.completed_at).getTime()
    const ageDays = (Date.now() - submitted) / (1000 * 60 * 60 * 24)
    return ageDays <= FLAG_AFTER_SUBMIT_DAYS
  }, [result])

  useEffect(() => {
    if (!attemptId) return
    let cancelled = false

    // FAST path: read the freshly-submitted result from session storage so we
    // don't double-fetch when the student just finished the quiz.
    const cached = sessionStorage.getItem(`quiz-result-${attemptId}`)
    if (cached) {
      try {
        setResult(JSON.parse(cached) as QuizAttemptResponse)
        setLoading(false)
        return
      } catch {
        // Fall through to the network fetch.
      }
    }

    // SLOW path: cache miss (student came back later — day before exam, etc.)
    // Hit the new GET /attempts/{id} endpoint and render the same shape.
    void (async () => {
      try {
        const data = await quizzesApi.getAttempt(attemptId)
        if (!cancelled) setResult(data)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load this attempt',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [attemptId])

  // Load existing flags once we know the quiz ID. Silent on errors —
  // missing flag state is non-blocking for the review experience.
  useEffect(() => {
    if (!quizId || !result) return
    void (async () => {
      try {
        const flags = await quizzesApi.myFlagsForQuiz(quizId)
        const ids = new Set(flags.map((f) => f.question_id))
        const reasons: Record<string, string | null> = {}
        for (const f of flags) reasons[f.question_id] = f.reason
        setFlaggedIds(ids)
        setFlagReasonsById(reasons)
      } catch {
        // ignore
      }
    })()
  }, [quizId, result])

  const openFlagPopover = (qid: string) => {
    if (!canFlagAfterSubmit) return
    setFlagPopoverFor(qid)
    setFlagPopoverReason(flagReasonsById[qid] ?? '')
    setFlagError(null)
  }
  const closeFlagPopover = () => {
    setFlagPopoverFor(null)
    setFlagPopoverReason('')
    setFlagError(null)
  }
  const saveFlag = async () => {
    if (!quizId || !flagPopoverFor) return
    setFlagBusy(true)
    setFlagError(null)
    const reason = flagPopoverReason.trim() || null
    const qid = flagPopoverFor
    try {
      await quizzesApi.flagQuestion(quizId, qid, reason)
      setFlaggedIds((prev) => {
        const next = new Set(prev)
        next.add(qid)
        return next
      })
      setFlagReasonsById((prev) => ({ ...prev, [qid]: reason }))
      closeFlagPopover()
    } catch (err) {
      setFlagError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not save the flag',
      )
    } finally {
      setFlagBusy(false)
    }
  }
  const removeFlag = async () => {
    if (!quizId || !flagPopoverFor) return
    setFlagBusy(true)
    setFlagError(null)
    const qid = flagPopoverFor
    try {
      await quizzesApi.unflagQuestion(quizId, qid)
      setFlaggedIds((prev) => {
        const next = new Set(prev)
        next.delete(qid)
        return next
      })
      setFlagReasonsById((prev) => {
        const next = { ...prev }
        delete next[qid]
        return next
      })
      closeFlagPopover()
    } catch (err) {
      setFlagError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not remove the flag',
      )
    } finally {
      setFlagBusy(false)
    }
  }

  const groupedByTopic = useMemo(() => {
    if (!result) return new Map<string, { correct: number; total: number }>()
    const map = new Map<string, { correct: number; total: number }>()
    for (const g of result.graded_answers) {
      const topic = g.topic || 'General'
      const cur = map.get(topic) ?? { correct: 0, total: 0 }
      cur.total += 1
      if (g.is_correct) cur.correct += 1
      map.set(topic, cur)
    }
    return map
  }, [result])

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading attempt…
      </Card>
    )
  }

  if (!result) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">
            {error ?? "We couldn't find this attempt's result."}
          </span>
        </div>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/student/quizzes')}>
          Back to quizzes
        </Button>
      </Card>
    )
  }

  return (
    <motion.div
      className="space-y-4 max-w-3xl mx-auto"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Score hero card */}
      <motion.div variants={fadeUp}>
        <Card className="space-y-4 text-center">
          <h1 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Your Score
          </h1>
          <div className="space-y-2">
            <div className={`text-5xl font-bold ${scoreColor(result.score)}`}>
              {result.score.toFixed(0)}%
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {result.correct_count} of {result.total_questions} correct
              {result.time_taken_seconds != null && (
                <>
                  {' · '}
                  {Math.floor(result.time_taken_seconds / 60)}m{' '}
                  {result.time_taken_seconds % 60}s
                </>
              )}
            </p>
          </div>
          <ProgressBar
            value={result.score}
            max={100}
            showValue={false}
            color={scoreBarColor(result.score)}
          />
          {result.next_difficulty_recommendation && (
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)]">
              <Sparkles className="h-3.5 w-3.5 text-info" />
              Next recommended difficulty:{' '}
              <Badge size="sm" variant="info">
                {result.next_difficulty_recommendation}
              </Badge>
              <span className="text-[var(--text-tertiary)]">(greedy adaptive selection)</span>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Per-topic breakdown */}
      {groupedByTopic.size > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Topic Breakdown</CardTitle>
            </CardHeader>
            <ul className="space-y-3">
              {Array.from(groupedByTopic.entries()).map(([topic, { correct, total }]) => {
                const pct = (correct / total) * 100
                const weak = pct < 60
                return (
                  <li key={topic} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-primary)] flex items-center gap-2">
                        {weak ? (
                          <TrendingDown className="h-3.5 w-3.5 text-danger" />
                        ) : (
                          <TrendingUp className="h-3.5 w-3.5 text-success" />
                        )}
                        {topic}
                      </span>
                      <span className={`tabular-nums ${weak ? 'text-danger' : 'text-success'}`}>
                        {correct}/{total} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <ProgressBar
                      value={pct}
                      max={100}
                      size="sm"
                      color={pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'danger'}
                    />
                  </li>
                )
              })}
            </ul>
          </Card>
        </motion.div>
      )}

      {/* Question-by-question review */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Question Review</CardTitle>
          </CardHeader>
          {!canFlagAfterSubmit && (
            <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
              Flag window for this attempt has closed (3 days since submission).
              Existing flags are still visible.
            </p>
          )}
          <ul className="space-y-4">
            {result.graded_answers.map((g, i) => {
              const isFlagged = flaggedIds.has(g.question_id)
              return (
              <li key={g.question_id} className="space-y-2">
                <div className="flex items-start gap-2">
                  {g.is_correct ? (
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {i + 1}. {g.question_text}
                    </p>
                    {g.topic && (
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                        {g.topic}
                      </span>
                    )}
                  </div>
                  {/* Flag pill — read-only after 3 days but still shows state */}
                  <button
                    type="button"
                    onClick={() => openFlagPopover(g.question_id)}
                    disabled={!canFlagAfterSubmit}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs border transition-colors ${
                      isFlagged
                        ? 'border-warning/40 bg-warning/10 text-warning'
                        : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    title={
                      !canFlagAfterSubmit
                        ? 'Flag window closed (3 days since submit)'
                        : isFlagged
                          ? 'You flagged this — click to edit or remove'
                          : 'Flag this question if it seems broken'
                    }
                  >
                    <Flag
                      className="h-3.5 w-3.5"
                      fill={isFlagged ? 'currentColor' : 'none'}
                    />
                    {isFlagged ? 'Flagged' : 'Flag'}
                  </button>
                </div>
                <div className="ml-6 space-y-1 text-xs">
                  <div>
                    <span className="text-[var(--text-tertiary)]">Your answer: </span>
                    <span className={g.is_correct ? 'text-success' : 'text-danger'}>
                      {g.student_answer || <em>(blank)</em>}
                    </span>
                  </div>
                  {!g.is_correct && (
                    <div>
                      <span className="text-[var(--text-tertiary)]">Correct answer: </span>
                      <span className="text-success">{g.correct_answer}</span>
                    </div>
                  )}
                  {g.explanation && (
                    <p className="text-[var(--text-tertiary)] italic mt-1">
                      {g.explanation}
                    </p>
                  )}
                </div>

                {/* Inline flag popover — appears under the question being flagged. */}
                {flagPopoverFor === g.question_id && (
                  <div className="ml-6 rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-warning uppercase tracking-wider">
                        Why are you flagging this?
                      </span>
                      <button
                        type="button"
                        onClick={closeFlagPopover}
                        disabled={flagBusy}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>
                    <textarea
                      value={flagPopoverReason}
                      onChange={(e) => setFlagPopoverReason(e.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder='Optional — e.g. "Two options look correct"'
                      className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-warning resize-none"
                      disabled={flagBusy}
                    />
                    {flagError && (
                      <p className="text-xs text-danger">{flagError}</p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      {isFlagged ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void removeFlag()}
                          disabled={flagBusy}
                        >
                          Remove flag
                        </Button>
                      ) : (
                        <span />
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void saveFlag()}
                        disabled={flagBusy}
                      >
                        {flagBusy ? 'Saving…' : 'Save flag'}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
              )
            })}
          </ul>
        </Card>
      </motion.div>

      {result.weak_topics.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Weak Areas From This Attempt</CardTitle>
            </CardHeader>
            <ul className="space-y-1 text-sm">
              {result.weak_topics.map((t) => (
                <li key={t} className="flex items-center gap-2 text-danger">
                  <TrendingDown className="h-3.5 w-3.5" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      )}

      <div className="flex justify-start gap-2">
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/student/quizzes')}>
          Back to quizzes
        </Button>
        {/* Retake button removed — students get exactly one attempt per quiz
            (enforced on the backend via the 409 in submit_attempt). Allowing
            "Retake quiz" here would have routed back to the take page only
            for the backend to reject the submit. */}
      </div>
    </motion.div>
  )
}
