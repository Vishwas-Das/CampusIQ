import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  Brain,
  ChevronRight,
  FileText,
  Loader2,
  Megaphone,
  PlusCircle,
  Send,
  TrendingUp,
  Upload,
  User as UserIcon,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TeacherActivityType } from '../../types'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import Select from '../../components/ui/Select'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, dashboardApi } from '../../api/client'
import type {
  DocumentProcessingStatus,
  TeacherAnalyticsResponse,
  TeacherDashboardResponse,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const STAT_ICONS: Record<string, LucideIcon> = {
  'TOTAL STUDENTS': Users,
  DOCUMENTS: FileText,
  'QUIZZES PUBLISHED': Brain,
  'CLASS AVERAGE': TrendingUp,
}

// Icon shown next to each Recent Activity row, picked by event type.
// Visual cue helps the teacher scan the feed without reading every line.
const ACTIVITY_ICONS: Record<TeacherActivityType, LucideIcon> = {
  doc_uploaded: Upload,
  quiz_created: PlusCircle,
  quiz_published: Send,
  attempt_received: UserIcon,
  announcement: Megaphone,
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

interface QuickAction {
  title: string
  description: string
  icon: LucideIcon
  to: string
}

const quickActions: QuickAction[] = [
  {
    title: 'Upload Document',
    description: 'Upload PDFs, DOCX, or PPTX files for AI processing',
    icon: Upload,
    to: '/teacher/documents',
  },
  {
    title: 'Create Quiz',
    description: 'Generate quizzes automatically from your documents',
    icon: PlusCircle,
    to: '/teacher/quizzes',
  },
  {
    title: 'Post Announcement',
    description: 'Notify students about deadlines and updates',
    icon: Megaphone,
    to: '/teacher/announcements',
  },
]

const statusVariant: Record<
  DocumentProcessingStatus,
  'success' | 'warning' | 'danger' | 'default'
> = {
  ready: 'success',
  processing: 'warning',
  pending: 'default',
  failed: 'danger',
}

const statusLabel: Record<DocumentProcessingStatus, string> = {
  ready: 'Ready',
  processing: 'Processing',
  pending: 'Pending',
  failed: 'Failed',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<TeacherDashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Per-subject analytics drill-down. `subjectId === ''` means "All subjects".
  const [analyticsSubjectId, setAnalyticsSubjectId] = useState<string>('')
  const [analytics, setAnalytics] = useState<TeacherAnalyticsResponse | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const d = await dashboardApi.teacher()
        if (!cancelled) setData(d)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load teacher dashboard',
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

  // Refetch analytics whenever the dropdown changes. Also runs once on
  // first render to populate the default ("All subjects") view.
  useEffect(() => {
    let cancelled = false
    setAnalyticsLoading(true)
    void (async () => {
      try {
        const a = await dashboardApi.teacherAnalytics(
          analyticsSubjectId || null,
        )
        if (!cancelled) setAnalytics(a)
      } catch {
        if (!cancelled) setAnalytics(null)
      } finally {
        if (!cancelled) setAnalyticsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [analyticsSubjectId])

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-12 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading your dashboard…
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'No dashboard data'}</span>
        </div>
      </Card>
    )
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="grid grid-cols-4 gap-4">
        {data.stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 1, y: 0, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.06, duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <StatCard
              label={stat.label}
              value={stat.value}
              icon={STAT_ICONS[stat.label] ?? FileText}
              trend={stat.trend ?? undefined}
            />
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={fadeUp}>
        <CardLabel className="mb-3 block">QUICK ACTIONS</CardLabel>
        <div className="grid grid-cols-3 gap-4">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Card
                key={action.title}
                hover
                className="cursor-pointer group"
                onClick={() => navigate(action.to)}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)] group-hover:bg-primary/10 transition-colors">
                    <Icon className="h-5 w-5 text-[var(--text-secondary)] group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[var(--text-primary)]">
                      {action.title}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {action.description}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
                </div>
              </Card>
            )
          })}
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader
            action={
              <span
                className="text-xs text-[var(--text-secondary)] cursor-pointer hover:text-[var(--text-primary)]"
                onClick={() => navigate('/teacher/documents')}
              >
                View All
              </span>
            }
          >
            <CardTitle>Recent Uploads</CardTitle>
          </CardHeader>
          {data.recent_uploads.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              No uploads yet. Use Quick Actions above to upload your first document.
            </p>
          ) : (
            <div className="space-y-3">
              {data.recent_uploads.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between py-2 border-b border-[var(--border-default)] last:border-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {doc.name}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {doc.subject_name ?? doc.subject_code ?? '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {formatDate(doc.created_at)}
                    </span>
                    <Badge variant={statusVariant[doc.status]} size="sm" dot>
                      {statusLabel[doc.status]}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      {/* RECENT ACTIVITY — uploads, quizzes, announcements, and student
          attempts on this teacher's quizzes, merged and sorted by time.
          Clicking a row jumps to the relevant page. */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          {data.recent_activity.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              Your actions in the app will show up here — uploads, quiz
              publishes, announcements, and student attempts.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.recent_activity.map((item, i) => {
                const Icon = ACTIVITY_ICONS[item.type] ?? FileText
                const clickable = !!item.action_url
                return (
                  <li
                    key={`${item.occurred_at}-${i}`}
                    onClick={() => {
                      if (clickable) navigate(item.action_url!)
                    }}
                    className={`flex items-start gap-3 py-2 px-2 -mx-2 rounded-md transition-colors ${
                      clickable ? 'cursor-pointer hover:bg-[var(--bg-tertiary)]' : ''
                    }`}
                  >
                    <Icon className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">
                        {item.title}
                      </p>
                      {item.subtitle && (
                        <p className="text-xs text-[var(--text-tertiary)] truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums shrink-0">
                      {relativeTime(item.occurred_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Class Performance</CardTitle>
          </CardHeader>
          {data.class_average == null ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              No quiz attempts yet. Once students start attempting your published quizzes, the
              class average will appear here.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Overall summary row — overall avg + total active students */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
                    Overall average
                  </p>
                  <p className="text-3xl font-bold text-[var(--text-primary)] tabular-nums">
                    {data.class_average.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider text-right">
                    Active students
                  </p>
                  <p className="text-3xl font-bold text-[var(--text-primary)] tabular-nums">
                    {data.students_total}
                  </p>
                </div>
              </div>

              {/* ─── Drill-down: weakest topics + most missed + score
                  distribution, filterable by subject via the dropdown. */}
              <div className="pt-3 border-t border-[var(--border-default)] space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
                    Drill-down
                  </span>
                  <div className="w-56">
                    <Select
                      options={[
                        { value: '', label: 'All subjects' },
                        ...data.class_performance_by_subject.map((s) => ({
                          value: s.subject_id,
                          label: `${s.subject_code} — ${s.subject_name}`,
                        })),
                      ]}
                      value={analyticsSubjectId}
                      onChange={(e) => setAnalyticsSubjectId(e.target.value)}
                    />
                  </div>
                </div>

                {analyticsLoading || !analytics ? (
                  <p className="text-xs text-[var(--text-tertiary)] py-3">
                    Loading analytics…
                  </p>
                ) : analytics.total_attempts === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)] py-3">
                    No attempts in this scope yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Weakest topics — lowest accuracy first. */}
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                        Weakest topics
                      </p>
                      {analytics.weakest_topics.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          Not enough data yet — topics need ≥ 2 attempts to appear.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {analytics.weakest_topics.map((t) => (
                            <li key={t.topic} className="text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-primary)] truncate flex-1">
                                  {t.topic}
                                </span>
                                <span
                                  className={`tabular-nums shrink-0 font-semibold ${
                                    t.accuracy_pct >= 80
                                      ? 'text-success'
                                      : t.accuracy_pct >= 60
                                        ? 'text-warning'
                                        : 'text-danger'
                                  }`}
                                >
                                  {t.accuracy_pct.toFixed(0)}%
                                </span>
                              </div>
                              <ProgressBar
                                value={t.accuracy_pct}
                                max={100}
                                size="sm"
                                color={
                                  t.accuracy_pct >= 80
                                    ? 'success'
                                    : t.accuracy_pct >= 60
                                      ? 'warning'
                                      : 'danger'
                                }
                              />
                              <p className="text-[10px] text-[var(--text-tertiary)]">
                                {t.correct} / {t.attempts} answered correctly
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Score distribution — histogram. */}
                    <div>
                      <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                        Score distribution
                      </p>
                      <ul className="space-y-2">
                        {analytics.score_distribution.map((b) => {
                          const max = Math.max(
                            ...analytics.score_distribution.map((x) => x.count),
                            1,
                          )
                          const pct = (b.count / max) * 100
                          return (
                            <li key={b.bucket_label} className="text-xs space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[var(--text-secondary)] tabular-nums">
                                  {b.bucket_label}
                                </span>
                                <span className="text-[var(--text-primary)] tabular-nums">
                                  {b.count}
                                </span>
                              </div>
                              <ProgressBar value={pct} max={100} size="sm" color="primary" />
                            </li>
                          )
                        })}
                      </ul>
                    </div>

                    {/* Most missed questions — full width. */}
                    <div className="md:col-span-2">
                      <p className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                        Most missed questions
                      </p>
                      {analytics.most_missed_questions.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          No questions have been missed by 2+ students yet.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {analytics.most_missed_questions.map((q) => (
                            <li
                              key={q.question_id}
                              className="text-xs p-2 rounded-md border border-[var(--border-default)]"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span
                                  className="text-[var(--text-primary)] truncate flex-1"
                                  title={q.question_text}
                                >
                                  {q.question_text}
                                </span>
                                <span
                                  className={`tabular-nums shrink-0 font-semibold ${
                                    q.accuracy_pct >= 60
                                      ? 'text-warning'
                                      : 'text-danger'
                                  }`}
                                >
                                  {q.accuracy_pct.toFixed(0)}%
                                </span>
                              </div>
                              <p className="text-[10px] text-[var(--text-tertiary)]">
                                {q.quiz_title} · {q.times_correct} / {q.times_asked} correct
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Per-subject breakdown table. Only subjects with attempts
                  appear; the backend filters empty subjects out so this
                  list never shows zero-row noise. */}
              {data.class_performance_by_subject.length > 0 && (
                <div className="pt-3 border-t border-[var(--border-default)]">
                  <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                    By subject
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--text-tertiary)] text-left">
                        <th className="font-medium py-1.5">Subject</th>
                        <th className="font-medium py-1.5 text-right">Students</th>
                        <th className="font-medium py-1.5 text-right">Attempts</th>
                        <th className="font-medium py-1.5 text-right">Avg score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.class_performance_by_subject.map((row) => (
                        <tr
                          key={row.subject_id}
                          className="border-t border-[var(--border-default)]"
                        >
                          <td className="py-2 text-[var(--text-primary)]">
                            <span className="font-medium">{row.subject_code}</span>
                            <span className="text-[var(--text-tertiary)] ml-2 text-xs">
                              {row.subject_name}
                            </span>
                          </td>
                          <td className="py-2 text-right text-[var(--text-secondary)] tabular-nums">
                            {row.students_count}
                          </td>
                          <td className="py-2 text-right text-[var(--text-secondary)] tabular-nums">
                            {row.attempts_count}
                          </td>
                          <td
                            className={`py-2 text-right font-semibold tabular-nums ${
                              row.avg_score >= 80
                                ? 'text-success'
                                : row.avg_score >= 60
                                  ? 'text-warning'
                                  : 'text-danger'
                            }`}
                          >
                            {row.avg_score.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}
