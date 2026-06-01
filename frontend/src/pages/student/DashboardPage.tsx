import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  BarChart3,
  Brain,
  Loader2,
  Megaphone,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import Card, { CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import type { ProgressBarColor } from '../../components/ui/ProgressBar'
import StatCard from '../../components/dashboard/StatCard'
import ScoreRing from '../../components/dashboard/ScoreRing'
import TaskFeed, { type Task } from '../../components/dashboard/TaskFeed'
import ActivityFeed from '../../components/dashboard/ActivityFeed'
import { ApiError, dashboardApi } from '../../api/client'
import type { DashboardResponse } from '../../types'

// Start at full opacity — see PageTransition.tsx for why we never animate
// opacity (rAF can be throttled). We still animate the y-translate.
const fadeUpInitial = { y: 16 }
const fadeUpAnimate = (delay: number) => ({
  y: 0,
  transition: { duration: 0.1, delay, ease: [0.25, 0.46, 0.45, 0.94] as const },
})

interface PillarRow {
  label: string
  value: number
  color: ProgressBarColor
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const d = await dashboardApi.me()
        if (!cancelled) setData(d)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load dashboard',
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

  const pillars: PillarRow[] = [
    { label: 'Academic', value: data.score.academic, color: 'primary' },
    { label: 'Skills', value: data.score.skill, color: 'purple' },
    { label: 'Interview', value: data.score.interview, color: 'warning' },
    { label: 'Placement', value: data.score.placement, color: 'success' },
  ]

  const stats: { label: string; value: string; icon: LucideIcon; trend?: number }[] = [
    {
      label: 'CAMPUSIQ SCORE',
      value: data.score.total.toFixed(0),
      icon: BarChart3,
    },
    {
      label: 'TOTAL XP',
      value: data.xp.xp_total.toLocaleString(),
      icon: Zap,
    },
    {
      label: 'QUIZZES DONE',
      value: data.stats.quizzes_attempted.toString(),
      icon: Brain,
    },
    {
      label: 'AVG SCORE',
      value: data.stats.avg_quiz_score != null ? `${data.stats.avg_quiz_score.toFixed(0)}%` : '—',
      icon: Trophy,
    },
  ]

  // Dashboard tasks come from the heap-based task feed; clicking jumps to the action_url
  const tasksForFeed: Task[] = data.tasks.map((t) => ({
    title: t.title,
    priority: t.priority,
    reason: t.reason,
  }))

  const handleTaskClick = (i: number) => {
    const target = data.tasks[i]
    if (target?.action_url) navigate(target.action_url)
  }

  return (
    <div className="flex gap-6">
      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Identity Badge */}
        <motion.div
          initial={fadeUpInitial}
          animate={fadeUpAnimate(0)}
          className="flex items-center justify-between"
        >
          <Badge variant="primary" size="lg">
            {data.semester ? `Semester ${data.semester}` : 'CampusIQ'} —{' '}
            {data.branch ?? 'B.Tech'}
          </Badge>
          <div className="flex items-center gap-4 text-sm text-[var(--text-tertiary)]">
            <span>{data.xp.streak_days} day streak</span>
            <span>×{data.xp.streak_multiplier.toFixed(2)} XP multiplier</span>
          </div>
        </motion.div>

        {/* Stat Cards */}
        <div className="grid grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ y: 20, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.06, duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <StatCard {...stat} className="glow-border" />
            </motion.div>
          ))}
        </div>

        {/* Score Detail */}
        <motion.div initial={fadeUpInitial} animate={fadeUpAnimate(0.35)}>
          <Card padding={false} className="glow-border">
            <div className="p-5 flex items-center gap-8">
              <ScoreRing score={Math.round(data.score.total)} label="CampusIQ" />
              <div className="flex-1 space-y-3">
                {pillars.map((p) => (
                  <ProgressBar
                    key={p.label}
                    label={p.label}
                    value={p.value}
                    showValue
                    color={p.color}
                    size="sm"
                  />
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Task Feed */}
        <motion.div initial={fadeUpInitial} animate={fadeUpAnimate(0.4)}>
          <CardLabel className="mb-3 block">WHAT SHOULD I DO NEXT?</CardLabel>
          {tasksForFeed.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                You're all caught up. New tasks will appear once your teachers publish more quizzes.
              </p>
            </Card>
          ) : (
            <div onClick={(e) => {
              // Bubble click → which task div?
              const target = (e.target as HTMLElement).closest('[data-task-idx]')
              if (target) {
                const idx = Number(target.getAttribute('data-task-idx'))
                if (!Number.isNaN(idx)) handleTaskClick(idx)
              }
            }}>
              {/*
                The TaskFeed component is dumb — it doesn't know about action_urls.
                We wrap each task in a clickable div carrying its index so the
                bubbling click handler above can route to the right URL.
              */}
              <div className="space-y-2">
                {data.tasks.map((task, i) => (
                  <div key={i} data-task-idx={i}>
                    <TaskFeed tasks={[{ title: task.title, priority: task.priority, reason: task.reason }]} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        {/* XP Bar */}
        <motion.div initial={fadeUpInitial} animate={fadeUpAnimate(0.45)}>
          <Card className="glow-border">
            <div className="flex items-center gap-3">
              <Zap className="h-4 w-4 text-[var(--text-primary)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Level {data.xp.current_level}
              </span>
              <div className="flex-1">
                <ProgressBar
                  value={data.xp.xp_into_level}
                  max={Math.max(1, data.xp.next_level_threshold - (data.xp.next_level_threshold - data.xp.xp_to_next_level - data.xp.xp_into_level))}
                  size="md"
                />
              </div>
              <span className="text-xs text-[var(--text-tertiary)]">
                {data.xp.xp_total.toLocaleString()} / {data.xp.next_level_threshold.toLocaleString()} XP
              </span>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Right Sidebar */}
      <motion.div
        className="w-72 shrink-0 space-y-6"
        initial={{ x: 20 }}
        animate={{ x: 0 }}
        transition={{ delay: 0, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <Card className="glow-border">
          <CardLabel className="mb-3 block">RECENT ACTIVITY</CardLabel>
          {data.recent_activity.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">
              No XP events yet. Take a quiz to start earning XP.
            </p>
          ) : (
            <ActivityFeed
              activities={data.recent_activity.map((a) => ({
                text: `${a.title} (+${a.xp_earned} XP)`,
                time: relativeTime(a.created_at),
              }))}
            />
          )}
        </Card>

        <Card className="glow-border">
          <CardLabel className="mb-3 block">QUICK STATS</CardLabel>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Quizzes attempted</span>
              <span className="text-[var(--text-primary)] tabular-nums">
                {data.stats.quizzes_attempted}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Quizzes passed</span>
              <span className="text-success tabular-nums">{data.stats.quizzes_passed}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Streak</span>
              <span className="text-[var(--text-primary)] tabular-nums">
                {data.xp.streak_days} days
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Level</span>
              <span className="text-[var(--text-primary)] tabular-nums">
                {data.xp.current_level}
              </span>
            </div>
          </div>
        </Card>

        <Card className="glow-border">
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <CardLabel>ANNOUNCEMENTS</CardLabel>
          </div>
          {(data.announcements ?? []).length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">
              No announcements yet. Your teachers' updates will show up here.
            </p>
          ) : (
            <div className="space-y-3">
              {(data.announcements ?? []).map((ann) => (
                <div key={ann.id} className="text-sm">
                  <p className="text-[var(--text-primary)] font-medium leading-snug">
                    {ann.title}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                    {ann.body}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {ann.author_name ?? 'Teacher'}
                    {ann.subject_code && <> · {ann.subject_code}</>}
                    {' · '}
                    {relativeTime(ann.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  )
}
