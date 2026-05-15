import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Flag,
  Loader2,
  Send,
  X as XIcon,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, quizzesApi } from '../../api/client'
import type { QuizForStudent } from '../../types'

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

/** mm:ss when under an hour, h:mm:ss when an hour or more. Used both for
 *  elapsed time and the countdown — same shape, same code path. */
function formatHMS(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function QuizTakingPage() {
  const { quizId } = useParams<{ quizId: string }>()
  const navigate = useNavigate()
  const [quiz, setQuiz] = useState<QuizForStudent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  // Once auto-submit has fired we MUST NOT fire it again (timer keeps ticking
  // while the network call is in flight). Ref is fine — no re-render needed.
  const autoSubmittedRef = useRef(false)

  // ── Flag-question state ──
  // flaggedIds = which question IDs the student has flagged (for icon color).
  // flagReasonsById = the saved reason text, so re-opening the popover
  //   shows what they typed before (lets them edit it).
  // flagPopoverFor = the question ID whose popover is currently open
  //   (null = closed). Only one popover at a time.
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [flagReasonsById, setFlagReasonsById] = useState<Record<string, string | null>>({})
  const [flagPopoverFor, setFlagPopoverFor] = useState<string | null>(null)
  const [flagPopoverReason, setFlagPopoverReason] = useState('')
  const [flagBusy, setFlagBusy] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  useEffect(() => {
    if (!quizId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const data = await quizzesApi.getAsStudent(quizId)
        if (cancelled) return
        // Block entry if the backend says the student has already submitted —
        // we shouldn't even render the taking screen. Send them to History.
        if (data.has_attempted) {
          navigate('/student/quizzes', { replace: true })
          return
        }
        // Block entry if the window is closed — friendly error + go back.
        const nowMs = Date.now()
        if (data.opens_at && nowMs < new Date(data.opens_at).getTime()) {
          setError(
            `This quiz opens at ${new Date(data.opens_at).toLocaleString()}`,
          )
          return
        }
        if (data.closes_at && nowMs > new Date(data.closes_at).getTime()) {
          setError(
            `This quiz closed at ${new Date(data.closes_at).toLocaleString()}`,
          )
          return
        }
        setQuiz(data)
        startedAtRef.current = Date.now()
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load quiz',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quizId, navigate])

  useEffect(() => {
    if (!startedAtRef.current) return
    const id = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [quiz])

  const sortedQuestions = useMemo(() => {
    if (!quiz) return []
    return [...quiz.questions].sort((a, b) => a.order_index - b.order_index)
  }, [quiz])

  const currentQuestion = sortedQuestions[currentIdx]
  const answeredCount = Object.values(answers).filter((v) => v && v.length > 0).length

  const handleSelect = (option: string) => {
    if (!currentQuestion) return
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }))
  }

  // ── Flag helpers ──
  // Load existing flags once the quiz is in hand so icons render correctly
  // (e.g. on page refresh mid-quiz, we don't lose what was already flagged).
  useEffect(() => {
    if (!quizId || !quiz) return
    void (async () => {
      try {
        const flags = await quizzesApi.myFlagsForQuiz(quizId)
        const ids = new Set(flags.map((f) => f.question_id))
        const reasons: Record<string, string | null> = {}
        for (const f of flags) reasons[f.question_id] = f.reason
        setFlaggedIds(ids)
        setFlagReasonsById(reasons)
      } catch {
        // Silent — flagging is best-effort; missing reload shouldn't block the quiz
      }
    })()
  }, [quizId, quiz])

  const openFlagPopover = (qid: string) => {
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

  const handleSubmit = async () => {
    if (!quiz) return
    // Double-submit guard: the button disables on `submitting`, but a
    // rapid double-click can fire before React flushes that state, so
    // also guard imperatively here.
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        answers: sortedQuestions.map((q) => ({
          question_id: q.id,
          student_answer: answers[q.id] ?? '',
        })),
        time_taken_seconds: startedAtRef.current
          ? Math.floor((Date.now() - startedAtRef.current) / 1000)
          : null,
      }
      const result = await quizzesApi.submitAttempt(quiz.id, payload)
      // Stash the result in sessionStorage so the result page can render it without
      // a second network call.
      sessionStorage.setItem(`quiz-result-${result.id}`, JSON.stringify(result))
      navigate(`/student/quizzes/${quiz.id}/result/${result.id}`)
    } catch (err) {
      // 409 = backend says this student already has an attempt for this quiz.
      // Don't show a generic error — route them to History where they can
      // see their existing attempt.
      if (err instanceof ApiError && err.status === 409) {
        navigate('/student/quizzes', { replace: true })
        return
      }
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Submit failed',
      )
      setSubmitting(false)
    }
  }

  // ── Auto-submit when the student leaves the tab/app (Page Visibility API) ──
  // ALWAYS submits on visibility change — no Pause exception. The browser
  // fires "visibilitychange" whenever this page goes hidden (other tab,
  // minimized window, phone locked, app backgrounded). All of those count
  // as "left the quiz", so we submit whatever they had so far.
  //
  // We guard with autoSubmittedRef so the handler only fires once — without
  // it, the event could trigger twice (e.g. tab switch + window blur).
  useEffect(() => {
    if (!quiz) return

    const onVisibilityChange = () => {
      if (document.hidden && !autoSubmittedRef.current && !submitting) {
        autoSubmittedRef.current = true
        void handleSubmit()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, submitting])

  // ── Live countdown: min(time_limit_seconds, closes_at - quizStart) - elapsed ──
  // We compute the *cap* once when the quiz loads (won't change), then the
  // remaining seconds is just cap - elapsed in every render.
  const totalAllowedSeconds = useMemo(() => {
    if (!quiz || !startedAtRef.current) return null
    const limit = quiz.time_limit_seconds ??
      (quiz.time_limit_minutes ? quiz.time_limit_minutes * 60 : null)
    if (limit === null && !quiz.closes_at) return null

    const fromCloseSec = quiz.closes_at
      ? Math.max(0, Math.floor((new Date(quiz.closes_at).getTime() - startedAtRef.current) / 1000))
      : Number.POSITIVE_INFINITY
    const fromLimitSec = limit ?? Number.POSITIVE_INFINITY
    const cap = Math.min(fromCloseSec, fromLimitSec)
    return cap === Number.POSITIVE_INFINITY ? null : cap
  }, [quiz])

  const remainingSeconds =
    totalAllowedSeconds === null ? null : Math.max(0, totalAllowedSeconds - elapsed)

  // Auto-submit when the timer hits zero. Guard with a ref so the submit
  // only fires once even though the timer keeps ticking past 0.
  useEffect(() => {
    if (
      remainingSeconds !== null &&
      remainingSeconds <= 0 &&
      !autoSubmittedRef.current &&
      !submitting &&
      quiz
    ) {
      autoSubmittedRef.current = true
      void handleSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds, submitting, quiz])

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading quiz…
      </Card>
    )
  }

  if (error || !quiz) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'Quiz not found'}</span>
        </div>
        <Button variant="secondary" onClick={() => navigate('/student/quizzes')} icon={ArrowLeft}>
          Back to quizzes
        </Button>
      </Card>
    )
  }

  if (!currentQuestion) {
    return (
      <Card>
        <p className="text-sm text-[var(--text-tertiary)]">This quiz has no questions yet.</p>
      </Card>
    )
  }

  const progress = ((currentIdx + 1) / sortedQuestions.length) * 100

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{quiz.title}</h1>
            <p className="text-xs text-[var(--text-tertiary)]">
              {quiz.subject_code} — {quiz.subject_name}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {/* When there's a per-attempt cap we show the countdown (big +
                colored when low). Otherwise we fall back to elapsed time. */}
            {remainingSeconds !== null ? (
              <span
                className={`inline-flex items-center gap-1 font-mono tabular-nums text-sm ${
                  remainingSeconds <= 60
                    ? 'text-danger font-semibold'
                    : remainingSeconds <= 300
                      ? 'text-warning'
                      : 'text-[var(--text-primary)]'
                }`}
                title="Time remaining"
              >
                <Clock className="h-3.5 w-3.5" />
                {formatHMS(remainingSeconds)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[var(--text-tertiary)]">
                <Clock className="h-3.5 w-3.5" />
                {formatHMS(elapsed)}
              </span>
            )}
            {/* Difficulty badge intentionally NOT shown during the take —
                seeing "HARD" before answering primes worse performance.
                The result page reveals it post-submission. */}
          </div>
        </div>
        <ProgressBar value={progress} max={100} size="sm" color="primary" />
        <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
          <span>
            Question {currentIdx + 1} of {sortedQuestions.length}
          </span>
          <span>
            {answeredCount} / {sortedQuestions.length} answered
          </span>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <motion.div key={currentQuestion.id} variants={fadeUp} initial="initial" animate="animate">
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-medium text-[var(--text-primary)] leading-relaxed">
              {currentQuestion.question_text}
            </p>
            {/* Flag button (replaces the difficulty badge — difficulty is
                intentionally hidden during the quiz to avoid priming).
                Outline icon = not flagged, filled = flagged. */}
            <button
              type="button"
              onClick={() => openFlagPopover(currentQuestion.id)}
              disabled={submitting}
              className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs border transition-colors ${
                flaggedIds.has(currentQuestion.id)
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={
                flaggedIds.has(currentQuestion.id)
                  ? 'You flagged this question — click to edit or remove'
                  : 'Flag this question if it seems broken or ambiguous'
              }
            >
              <Flag
                className="h-3.5 w-3.5"
                fill={flaggedIds.has(currentQuestion.id) ? 'currentColor' : 'none'}
              />
              {flaggedIds.has(currentQuestion.id) ? 'Flagged' : 'Flag'}
            </button>
          </div>

          {/* Flag popover — inline below the question. We use inline (not
              positioned absolute) so it can't get clipped or hidden behind
              other cards on tiny screens. */}
          {flagPopoverFor === currentQuestion.id && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
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
                placeholder='Optional — e.g. "Two options look correct" or "Typo in question"'
                className="w-full px-2 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-warning resize-none"
                disabled={flagBusy}
              />
              {flagError && (
                <p className="text-xs text-danger">{flagError}</p>
              )}
              <div className="flex items-center justify-between gap-2">
                {flaggedIds.has(currentQuestion.id) ? (
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

          <ul className="space-y-2">
            {currentQuestion.options?.map((opt) => {
              const selected = answers[currentQuestion.id] === opt
              return (
                <li key={opt}>
                  <button
                    onClick={() => handleSelect(opt)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3 ${
                      selected
                        ? 'border-primary bg-primary/5 text-[var(--text-primary)]'
                        : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selected ? 'border-primary' : 'border-[var(--border-strong)]'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </motion.div>

      <div className="flex justify-between items-center">
        <Button
          variant="secondary"
          icon={ArrowLeft}
          disabled={currentIdx === 0}
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>

        {currentIdx === sortedQuestions.length - 1 ? (
          <Button
            icon={submitting ? undefined : Send}
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                Submit ({answeredCount}/{sortedQuestions.length})
              </>
            )}
          </Button>
        ) : (
          <Button
            icon={ArrowRight}
            onClick={() => setCurrentIdx((i) => Math.min(sortedQuestions.length - 1, i + 1))}
          >
            Next
          </Button>
        )}
      </div>

      {/* Question dots navigator */}
      <div className="flex flex-wrap gap-2 justify-center">
        {sortedQuestions.map((q, i) => {
          const isAnswered = !!answers[q.id]
          const isCurrent = i === currentIdx
          return (
            <button
              key={q.id}
              onClick={() => setCurrentIdx(i)}
              className={`h-7 w-7 rounded text-xs font-medium border transition-all ${
                isCurrent
                  ? 'border-primary bg-primary text-[var(--bg-elevated)]'
                  : isAnswered
                    ? 'border-success/50 bg-success/10 text-success'
                    : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)]'
              }`}
              title={`Question ${i + 1}${isAnswered ? ' (answered)' : ''}`}
            >
              {isAnswered && !isCurrent ? <CheckCircle2 className="h-3.5 w-3.5 mx-auto" /> : i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
