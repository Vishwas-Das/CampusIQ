import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  Eye,
  Flame,
  Loader2,
  MessageCircle,
  Search,
  Zap,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Avatar from '../../components/ui/Avatar'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, analyticsApi } from '../../api/client'
import type {
  ClassAnalytics,
  StudentDetailResponse,
  StudentPerformanceRow,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-danger'
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function StudentDetailsPage() {
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [trendFilter, setTrendFilter] = useState<'all' | 'up' | 'flat' | 'down'>('all')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StudentDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await analyticsApi.class()
        if (!cancelled) {
          setAnalytics(data)
          if (data.student_performance.length > 0) {
            setSelectedId((prev) => prev ?? data.student_performance[0].student_id)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load class analytics',
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

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void (async () => {
      try {
        const d = await analyticsApi.studentDetail(selectedId)
        if (!cancelled) setDetail(d)
      } catch (err) {
        if (!cancelled) {
          setDetailError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load student detail',
          )
          setDetail(null)
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filteredStudents = useMemo<StudentPerformanceRow[]>(() => {
    if (!analytics) return []
    const lower = searchTerm.trim().toLowerCase()
    return analytics.student_performance.filter((s) => {
      if (trendFilter !== 'all' && s.trend !== trendFilter) return false
      if (lower && !s.name.toLowerCase().includes(lower)) return false
      return true
    })
  }, [analytics, searchTerm, trendFilter])

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-12 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading student analytics…
      </Card>
    )
  }

  if (error || !analytics) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'No analytics data'}</span>
        </div>
      </Card>
    )
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Student Details</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {analytics.student_performance.length} students have engaged with your quizzes
          </p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="flex gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search students…"
            icon={Search}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="w-48">
          <Select
            options={[
              { value: 'all', label: 'All trends' },
              { value: 'up', label: 'Improving' },
              { value: 'flat', label: 'Steady' },
              { value: 'down', label: 'Declining' },
            ]}
            value={trendFilter}
            onChange={(e) =>
              setTrendFilter((e.target as HTMLSelectElement).value as typeof trendFilter)
            }
          />
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)]">
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Avg Score
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Quizzes Taken
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Trend
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Weak Area
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Last Active
                  </th>
                  <th className="text-left px-4 py-3 text-[var(--text-tertiary)] font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-[var(--text-tertiary)]"
                    >
                      No students match the current filters yet.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s, i) => (
                    <motion.tr
                      key={s.student_id}
                      className={clsx(
                        'border-b border-[var(--border-default)] last:border-b-0 cursor-pointer hover:bg-[var(--bg-tertiary)]/40',
                        s.student_id === selectedId && 'bg-primary/5',
                      )}
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.05 + Math.min(i, 12) * 0.02 }}
                      onClick={() => setSelectedId(s.student_id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={s.name} size="sm" />
                          <span className="text-[var(--text-primary)] font-medium">{s.name}</span>
                        </div>
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-3 font-semibold',
                          getScoreColor(s.avg_score ?? 0),
                        )}
                      >
                        {s.avg_score != null ? `${s.avg_score.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{s.quizzes_taken}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] capitalize">
                        {s.trend}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-tertiary)]">
                        {s.weak_area ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-tertiary)]">
                        {relativeTime(s.last_attempt_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Eye}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedId(s.student_id)
                          }}
                        >
                          View
                        </Button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>

      {selectedId && (
        <motion.div variants={fadeUp}>
          <Card>
            {detailLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading student detail…
              </div>
            ) : detailError ? (
              <div className="flex items-center gap-2 text-sm text-danger">
                <AlertCircle className="h-4 w-4" />
                {detailError}
              </div>
            ) : detail ? (
              <>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Avatar name={detail.name} size="lg" />
                    <div>
                      <CardTitle>{detail.name}</CardTitle>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {detail.branch ?? '—'}
                        {detail.semester ? ` · Semester ${detail.semester}` : ''}
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-1">
                    <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
                      Recent Quiz Performance
                    </h4>
                    {detail.quiz_scores.length === 0 ? (
                      <p className="text-sm text-[var(--text-tertiary)]">No attempts yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {detail.quiz_scores.map((q) => (
                          <ProgressBar
                            key={q.quiz_id + q.completed_at}
                            label={q.label}
                            value={q.value}
                            showValue
                            size="sm"
                            color={q.value >= 60 ? 'primary' : 'danger'}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-1">
                    <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
                      Weak Areas
                    </h4>
                    {detail.weak_areas.length === 0 ? (
                      <p className="text-sm text-[var(--text-tertiary)]">
                        No weak areas detected yet.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {detail.weak_areas.map((area) => (
                          <Badge key={area} variant="danger" size="sm">
                            {area}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-1">
                    <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
                      Engagement
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Zap className="h-4 w-4 text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">XP:</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {detail.xp_total.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Flame className="h-4 w-4 text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">Streak:</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {detail.streak_days} days
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <MessageCircle className="h-4 w-4 text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">Community:</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {detail.community_contributions} answers
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
