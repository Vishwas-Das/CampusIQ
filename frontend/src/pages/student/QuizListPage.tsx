import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  Loader2,
  Play,
  TrendingDown,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, quizzesApi } from '../../api/client'
import type {
  AttemptHistoryRow,
  Difficulty,
  QuizSummary,
  WeakAreaResponse,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const difficultyVariant: Record<Difficulty, BadgeVariant> = {
  easy: 'success',
  medium: 'warning',
  hard: 'danger',
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-danger'
}

function formatTime(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/** Render a remaining-time chip label like "2h 14m" or "47m 12s" or "8s". */
function formatRemaining(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

type QuizState =
  | { kind: 'upcoming'; msUntilOpen: number }
  | { kind: 'live'; msUntilClose: number | null }
  | { kind: 'closed' }
  | { kind: 'submitted' }

/** Derive the takeable state of a quiz given the wall-clock NOW.
 *
 * Priority: already attempted > before window > after window > open.
 * The frontend trusts these values for display; the BACKEND still
 * enforces the same checks on submit, so a tampered client can't bypass. */
function deriveQuizState(quiz: QuizSummary, now: number): QuizState {
  if (quiz.has_attempted) return { kind: 'submitted' }
  const openTs = quiz.opens_at ? new Date(quiz.opens_at).getTime() : null
  const closeTs = quiz.closes_at ? new Date(quiz.closes_at).getTime() : null
  if (openTs !== null && now < openTs) {
    return { kind: 'upcoming', msUntilOpen: openTs - now }
  }
  if (closeTs !== null && now > closeTs) {
    return { kind: 'closed' }
  }
  return {
    kind: 'live',
    msUntilClose: closeTs !== null ? Math.max(0, closeTs - now) : null,
  }
}

const tabs = ['Available', 'History', 'Weak Areas'] as const
type Tab = typeof tabs[number]

export default function QuizListPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('Available')

  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [history, setHistory] = useState<AttemptHistoryRow[]>([])
  const [weakAreas, setWeakAreas] = useState<WeakAreaResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Re-render every second so "Opens in 2h 14m" / "12m 47s left" stay live.
  // Cheap — only the badge labels recompute; the quizzes array doesn't refetch.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [q, h, w] = await Promise.all([
          quizzesApi.list(),
          quizzesApi.myAttempts(),
          quizzesApi.myWeakAreas(),
        ])
        if (cancelled) return
        setQuizzes(q)
        setHistory(h)
        setWeakAreas(w)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load quizzes',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)] w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === tab
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading && (
        <Card className="flex items-center gap-2 justify-center py-6 text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </Card>
      )}

      {/* Available Tab */}
      {!loading && activeTab === 'Available' && (
        <>
          {quizzes.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                No published quizzes yet. Check back once your teachers publish their first one.
              </p>
            </Card>
          ) : (
            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              variants={stagger}
              initial="initial"
              animate="animate"
            >
              {quizzes.map((quiz) => {
                const state = deriveQuizState(quiz, now)
                const seconds = quiz.time_limit_seconds ?? (quiz.time_limit_minutes ?? 0) * 60

                // Status chip rendered above the action button.
                let statusChip: React.ReactNode = null
                if (state.kind === 'upcoming') {
                  statusChip = (
                    <Badge variant="info" size="sm">
                      Opens in {formatRemaining(state.msUntilOpen)}
                    </Badge>
                  )
                } else if (state.kind === 'live') {
                  statusChip = (
                    <Badge variant="success" size="sm">
                      Live{state.msUntilClose !== null
                        ? ` · ${formatRemaining(state.msUntilClose)} left`
                        : ''}
                    </Badge>
                  )
                } else if (state.kind === 'closed') {
                  statusChip = (
                    <Badge variant="default" size="sm">Closed</Badge>
                  )
                } else if (state.kind === 'submitted') {
                  statusChip = (
                    <Badge variant="primary" size="sm">Submitted</Badge>
                  )
                }

                // Action button changes label + behavior per state.
                let action: React.ReactNode = null
                if (state.kind === 'live') {
                  action = (
                    <Button
                      size="sm"
                      icon={Play}
                      className="w-full mt-auto"
                      onClick={() => navigate(`/student/quizzes/${quiz.id}/take`)}
                    >
                      Start Quiz
                    </Button>
                  )
                } else if (state.kind === 'submitted') {
                  action = (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full mt-auto"
                      onClick={() => setActiveTab('History')}
                    >
                      View answers
                    </Button>
                  )
                } else {
                  // upcoming or closed → disabled button conveys the reason
                  action = (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full mt-auto opacity-60"
                      disabled
                    >
                      {state.kind === 'upcoming' ? 'Not open yet' : 'Quiz closed'}
                    </Button>
                  )
                }

                return (
                  <motion.div key={quiz.id} variants={fadeUp}>
                    <Card hover className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-[var(--text-primary)] truncate">
                            {quiz.subject_code}
                          </h3>
                          <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">
                            {quiz.title}
                          </p>
                        </div>
                        {/* Difficulty badge intentionally hidden BEFORE the
                            student submits, to avoid priming ("HARD" tanks
                            performance just from the label). Shown post-hoc
                            in History + Result page. */}
                        {quiz.has_attempted && (
                          <Badge variant={difficultyVariant[quiz.difficulty]} size="sm">
                            {quiz.difficulty}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)] flex-wrap">
                        <span className="flex items-center gap-1">
                          <HelpCircle className="h-3 w-3" />
                          {quiz.question_count} questions
                        </span>
                        {seconds > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatRemaining(seconds * 1000)}
                          </span>
                        )}
                      </div>
                      {statusChip && <div>{statusChip}</div>}
                      {action}
                    </Card>
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </>
      )}

      {/* History Tab */}
      {!loading && activeTab === 'History' && (
        <motion.div variants={fadeUp} initial="initial" animate="animate">
          {history.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                You haven't completed any quizzes yet.
              </p>
            </Card>
          ) : (
            <Card padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-default)]">
                      {['Date', 'Quiz', 'Subject', 'Score', 'Time', 'Difficulty'].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() =>
                          navigate(
                            `/student/quizzes/${row.quiz_id}/result/${row.id}`,
                          )
                        }
                        className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                        title="Open review — see your answers + the correct ones"
                      >
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          {formatDate(row.completed_at)}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                          {row.quiz_title}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">{row.subject_code}</td>
                        <td className={`px-4 py-3 font-semibold ${scoreColor(row.score)}`}>
                          {row.score.toFixed(0)}%
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          {formatTime(row.time_taken_seconds)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={difficultyVariant[row.difficulty]} size="sm">
                            {row.difficulty}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </motion.div>
      )}

      {/* Weak Areas Tab */}
      {!loading && activeTab === 'Weak Areas' && (
        <>
          {weakAreas.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                No weak areas detected yet. Take a few quizzes and we'll spot your soft spots
                automatically (boolean threshold: &lt; 60% across ≥ 2 attempts).
              </p>
            </Card>
          ) : (
            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
              variants={stagger}
              initial="initial"
              animate="animate"
            >
              {weakAreas.map((area) => (
                <motion.div key={area.topic} variants={fadeUp}>
                  <Card className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-danger" />
                          {area.topic}
                        </h3>
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {area.subject_code}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-danger">
                        {area.score_percent.toFixed(0)}%
                      </span>
                    </div>
                    <ProgressBar
                      value={area.score_percent}
                      max={100}
                      size="sm"
                      color={area.score_percent < 40 ? 'danger' : 'warning'}
                    />
                    <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                      <TrendingDown className="h-3 w-3 text-[var(--text-tertiary)] mt-0.5 shrink-0" />
                      <span>{area.suggestion}</span>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          )}
        </>
      )}
    </div>
  )
}
