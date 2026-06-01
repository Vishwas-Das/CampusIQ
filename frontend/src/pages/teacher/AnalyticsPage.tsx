import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import ProgressBar from '../../components/ui/ProgressBar'
import Select from '../../components/ui/Select'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, analyticsApi, subjectsApi } from '../../api/client'
import type { ClassAnalytics, Subject } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function getBarColor(score: number): 'danger' | 'warning' | 'success' {
  if (score < 50) return 'danger'
  if (score < 70) return 'warning'
  return 'success'
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-[var(--text-tertiary)]'
  if (score >= 70) return 'text-success font-medium'
  if (score >= 50) return 'text-warning font-medium'
  return 'text-danger font-medium'
}

export default function AnalyticsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void subjectsApi.list().then(setSubjects).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await analyticsApi.class(
          subjectFilter && subjectFilter !== 'all' ? subjectFilter : undefined,
        )
        if (!cancelled) setAnalytics(data)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load analytics',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [subjectFilter])

  const subjectOptions = useMemo(
    () => [
      { value: 'all', label: 'All My Subjects' },
      ...subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    ],
    [subjects],
  )

  const stats = useMemo(() => {
    if (!analytics) return [] as { label: string; value: string; icon: LucideIcon }[]
    const h = analytics.headline
    return [
      {
        label: 'CLASS AVERAGE',
        value: h.class_average != null ? `${h.class_average.toFixed(0)}%` : '—',
        icon: BarChart3,
      },
      {
        label: 'COMPLETION RATE',
        value: h.completion_rate != null ? `${h.completion_rate.toFixed(0)}%` : '—',
        icon: CheckCircle,
      },
      {
        label: 'MOST MISSED',
        value: h.most_missed_topic ?? '—',
        icon: AlertTriangle,
      },
      {
        label: 'ACTIVE STUDENTS',
        value: h.active_students.toString(),
        icon: Users,
      },
    ]
  }, [analytics])

  const distributionMax = useMemo(() => {
    if (!analytics) return 1
    return Math.max(1, ...analytics.score_distribution.map((b) => b.count))
  }, [analytics])

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Filter */}
      <motion.div variants={fadeUp} className="w-72">
        <Select
          options={subjectOptions}
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
        />
      </motion.div>

      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-12 text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading analytics…
        </Card>
      )}

      {!loading && analytics && (
        <>
          {/* Stats Row */}
          <motion.div variants={fadeUp} className="grid grid-cols-4 gap-4">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 1, y: 0, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.06, duration: 0.1 }}
              >
                <StatCard {...stat} />
              </motion.div>
            ))}
          </motion.div>

          {/* Score Distribution */}
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Score Distribution</CardTitle>
              </CardHeader>
              {analytics.score_distribution.every((b) => b.count === 0) ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                  No quiz attempts yet for this scope.
                </p>
              ) : (
                <div className="flex items-end gap-3 h-44 px-2">
                  {analytics.score_distribution.map((bucket) => {
                    const heightPct = (bucket.count / distributionMax) * 100
                    return (
                      <div
                        key={bucket.label}
                        className="flex-1 flex flex-col items-center justify-end gap-2"
                      >
                        <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                          {bucket.count}
                        </div>
                        <div
                          className="w-full rounded-t-md bg-primary/70 hover:bg-primary transition-colors"
                          style={{
                            height: `${Math.max(heightPct, bucket.count > 0 ? 4 : 0)}%`,
                            minHeight: bucket.count > 0 ? '4px' : '0',
                          }}
                        />
                        <div className="text-xs text-[var(--text-tertiary)]">{bucket.label}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </motion.div>

          {/* Weakest Topics */}
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Weakest Topics (boolean threshold &lt; 60%)</CardTitle>
              </CardHeader>
              {analytics.weak_topics.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                  No weak topics detected — great work, class!
                </p>
              ) : (
                <div className="space-y-4">
                  {analytics.weak_topics.map((item) => (
                    <div key={item.topic} className="flex items-center gap-4">
                      <span className="text-sm text-[var(--text-primary)] w-56 shrink-0 truncate">
                        {item.topic}
                      </span>
                      <div className="flex-1">
                        <ProgressBar
                          value={item.score_percent}
                          max={100}
                          color={getBarColor(item.score_percent)}
                          size="md"
                        />
                      </div>
                      <span className="text-sm font-medium text-[var(--text-secondary)] w-16 text-right tabular-nums">
                        {item.score_percent.toFixed(0)}%
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)] w-16 text-right tabular-nums">
                        {item.attempts} att
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>

          {/* Student Performance */}
          <motion.div variants={fadeUp}>
            <Card padding={false}>
              <CardHeader className="px-4 pt-4">
                <CardTitle>Student Performance</CardTitle>
              </CardHeader>
              {analytics.student_performance.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                  No student attempts yet for this scope.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-default)]">
                        <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Name
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Quizzes Taken
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Avg Score
                        </th>
                        <th className="text-center px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Trend
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                          Weak Area
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.student_performance.map((s) => (
                        <tr
                          key={s.student_id}
                          className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                            {s.name}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-secondary)] tabular-nums">
                            {s.quizzes_taken}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${scoreColor(s.avg_score)}`}>
                            {s.avg_score != null ? `${s.avg_score.toFixed(0)}%` : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.trend === 'up' ? (
                              <TrendingUp className="h-4 w-4 text-success inline-block" />
                            ) : s.trend === 'down' ? (
                              <TrendingDown className="h-4 w-4 text-danger inline-block" />
                            ) : (
                              <Minus className="h-4 w-4 text-[var(--text-tertiary)] inline-block" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {s.weak_area ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
