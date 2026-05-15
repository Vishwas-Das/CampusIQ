import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertTriangle,
  BookOpen,
  CheckSquare,
  Clock,
  FileText,
  Loader2,
  Square,
  Swords,
  Target,
} from 'lucide-react'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import {
  ApiError,
  algorithmsApi,
  crashModeApi,
  quizzesApi,
  type CrashTask,
} from '../../api/client'
import type { StudyTaskInput } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const DEFAULT_TARGET = 'Google SWE'
const DEFAULT_DAYS = 3
const FALLBACK_TASKS: StudyTaskInput[] = [
  { topic: 'Arrays & Hashing Patterns', hours: 3, priority: 10, subject_code: 'DAA' },
  { topic: 'Binary Search Variations', hours: 2, priority: 9, subject_code: 'DAA' },
  { topic: 'Graph BFS/DFS', hours: 3, priority: 9, subject_code: 'DAA' },
  { topic: 'Dynamic Programming Basics', hours: 4, priority: 8, subject_code: 'DAA' },
  { topic: 'System Design Fundamentals', hours: 2, priority: 7, subject_code: null },
  { topic: 'Behavioral Question Prep', hours: 2, priority: 5, subject_code: null },
]

interface ActivePlan {
  target: string
  days: number
  startedAt: string
  tasks: CrashTask[]
  completedTopics: Set<string>
  totalHours: number
}

function priorityFromScore(scorePercent: number): number {
  const inverted = (100 - Math.max(0, Math.min(100, scorePercent))) / 10
  return Math.max(1, Math.min(10, Math.round(inverted * 10) / 10))
}

function badgeForPriority(priority: number): { label: string; variant: BadgeVariant } {
  if (priority >= 8) return { label: 'Critical', variant: 'danger' }
  if (priority >= 5) return { label: 'Important', variant: 'warning' }
  return { label: 'Optional', variant: 'default' }
}

function improvementForScore(scorePercent: number): string {
  const gap = Math.max(0, 100 - scorePercent)
  const pct = Math.min(12, Math.round(gap / 8))
  return pct > 0 ? `+${pct}%` : '+1%'
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00:00'
  const totalSeconds = Math.floor(msRemaining / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function CrashModePage() {
  const navigate = useNavigate()
  const [plan, setPlan] = useState<ActivePlan | null>(null)
  const [targetInput, setTargetInput] = useState(DEFAULT_TARGET)
  const [daysInput, setDaysInput] = useState(DEFAULT_DAYS)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const existing = await crashModeApi.getMine()
        if (cancelled) return
        if (existing) {
          const activeplan: ActivePlan = {
            target: existing.target_label,
            days: existing.target_days,
            startedAt: existing.started_at,
            tasks: existing.tasks,
            completedTopics: new Set(existing.completed_topics),
            totalHours: existing.total_hours_scheduled,
          }
          setPlan(activeplan)
          setTargetInput(activeplan.target)
          setDaysInput(activeplan.days)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load your saved crash plan',
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

  const startedAtMs = useMemo(() => {
    if (!plan) return Date.now()
    const t = Date.parse(plan.startedAt)
    return Number.isNaN(t) ? Date.now() : t
  }, [plan])

  const deadlineMs = plan ? startedAtMs + plan.days * 24 * 60 * 60 * 1000 : 0
  const msRemaining = plan ? deadlineMs - now : 0

  const generate = async (options: { target: string; days: number }) => {
    setGenerating(true)
    setError(null)
    try {
      let weakAreas: { topic: string; subject_code: string | null; score_percent: number }[] = []
      try {
        weakAreas = await quizzesApi.myWeakAreas()
      } catch {
        // No quiz history yet — fall back to canned tasks.
      }

      const taskInputs: StudyTaskInput[] = weakAreas.length
        ? weakAreas.map((wa) => ({
            topic: wa.topic,
            hours: 2,
            priority: priorityFromScore(wa.score_percent),
            subject_code: wa.subject_code,
          }))
        : FALLBACK_TASKS

      // Crash Mode prefers backtracking — it produces tight, dense schedules
      // (the "cram everything in N days" feel) whereas the default spread is
      // calmer for normal weekly planning. Different feature, different strategy.
      const schedule = await algorithmsApi.generateSchedule({
        tasks: taskInputs,
        days: options.days,
        strategy: 'backtracking',
      })

      const persisted = await crashModeApi.upsert({
        target_label: options.target,
        target_days: options.days,
        started_at: new Date().toISOString(),
        tasks: schedule.scheduled_tasks.map((t) => ({
          topic: t.topic,
          hours: t.hours,
          priority: t.priority,
          subject_code: t.subject_code,
        })),
        completed_topics: [],
        total_hours_scheduled: schedule.total_hours_scheduled,
      })

      setPlan({
        target: persisted.target_label,
        days: persisted.target_days,
        startedAt: persisted.started_at,
        tasks: persisted.tasks,
        completedTopics: new Set(persisted.completed_topics),
        totalHours: persisted.total_hours_scheduled,
      })
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not generate crash plan',
      )
    } finally {
      setGenerating(false)
    }
  }

  const handleApply = () => {
    void generate({
      target: targetInput.trim() || DEFAULT_TARGET,
      days: Math.max(1, Math.min(14, daysInput || 1)),
    })
  }

  const toggleDone = async (topic: string) => {
    if (!plan) return
    const next = new Set(plan.completedTopics)
    if (next.has(topic)) {
      next.delete(topic)
    } else {
      next.add(topic)
    }
    // Optimistic update.
    setPlan({ ...plan, completedTopics: next })
    try {
      await crashModeApi.setCompletedTopics(Array.from(next))
    } catch (err) {
      // Rollback on failure.
      setPlan(plan)
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not save your progress',
      )
    }
  }

  const planItems = useMemo(() => {
    if (!plan) return []
    return plan.tasks
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .map((t, idx) => {
        const badge = badgeForPriority(t.priority)
        return {
          priority: idx + 1,
          topic: t.topic,
          time: `${t.hours} hour${t.hours === 1 ? '' : 's'}`,
          improvement: improvementForScore(100 - t.priority * 10),
          badge: badge.label,
          badgeVariant: badge.variant,
          subjectCode: t.subject_code,
        }
      })
  }, [plan])

  const completedCount = plan
    ? planItems.filter((p) => plan.completedTopics.has(p.topic)).length
    : 0
  const totalHours = plan?.totalHours ?? 0
  const predictedImprovementPct = plan
    ? Math.min(
        45,
        plan.tasks.reduce((acc, t) => acc + Math.round(t.priority * 0.6), 0),
      )
    : 0

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Top banner */}
      <motion.div variants={fadeUp}>
        <Card className="border-danger/30 bg-danger/5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-5 w-5 text-danger" />
                <h2 className="text-lg font-bold text-danger">CRASH MODE</h2>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                {plan
                  ? `Interview in ${plan.days} day${plan.days === 1 ? '' : 's'}`
                  : 'No active plan yet'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <Target className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-primary)]">
                  Preparing for: <strong>{plan?.target ?? targetInput}</strong>
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="stat-value text-3xl text-danger">
                {plan ? formatCountdown(msRemaining) : '--:--:--'}
              </span>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Time remaining</p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Configuration */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>{plan ? 'Crash Plan Inputs' : 'Start a Crash Plan'}</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-6">
              <CardLabel>Target Role / Company</CardLabel>
              <Input
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder="Google SWE"
              />
            </div>
            <div className="col-span-3">
              <CardLabel>Days Until Interview</CardLabel>
              <Input
                type="number"
                min={1}
                max={14}
                value={String(daysInput)}
                onChange={(e) =>
                  setDaysInput(Math.max(1, Math.min(14, Number(e.target.value) || 1)))
                }
              />
            </div>
            <div className="col-span-3">
              <Button onClick={handleApply} disabled={generating || loading} className="w-full">
                {generating ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Optimizing
                  </span>
                ) : plan ? (
                  'Regenerate'
                ) : (
                  'Generate Plan'
                )}
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>

      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Optimized Study Plan */}
      <motion.div variants={fadeUp}>
        <CardLabel className="mb-3">Optimized Study Plan</CardLabel>
        {loading ? (
          <Card>
            <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your saved crash plan…
            </div>
          </Card>
        ) : generating && !plan ? (
          <Card>
            <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Computing priority-weighted schedule (branch-and-bound)…
            </div>
          </Card>
        ) : !plan ? (
          <Card>
            <p className="text-sm text-[var(--text-tertiary)]">
              You don't have an active crash plan. Set your target and click <strong>Generate Plan</strong> above
              to build one from your weakest quiz topics. Your plan and progress will be saved server-side
              so you can pick up where you left off.
            </p>
          </Card>
        ) : planItems.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--text-tertiary)]">
              No study items returned. Take a few quizzes so CampusIQ can detect weak areas, or
              regenerate to retry.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {planItems.map((item, i) => {
              const done = plan.completedTopics.has(item.topic)
              return (
                <motion.div key={item.topic + i} variants={fadeUp}>
                  <Card className={clsx(done && 'opacity-60')}>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => void toggleDone(item.topic)}
                        className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        {done ? (
                          <CheckSquare className="h-5 w-5 text-success" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>
                      <span
                        className={clsx(
                          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                          item.badgeVariant === 'danger'
                            ? 'bg-danger/10 text-danger'
                            : item.badgeVariant === 'warning'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]',
                        )}
                      >
                        {item.priority}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={clsx(
                            'text-sm font-medium',
                            done
                              ? 'line-through text-[var(--text-tertiary)]'
                              : 'text-[var(--text-primary)]',
                          )}
                        >
                          {item.topic}
                        </p>
                        {item.subjectCode && (
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                            {item.subjectCode}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                        <Clock className="h-3 w-3" />
                        {item.time}
                      </div>
                      <span className="text-xs font-semibold text-success">
                        {item.improvement}
                      </span>
                      <Badge variant={item.badgeVariant} size="sm">
                        {item.badge}
                      </Badge>
                    </div>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </motion.div>

      {/* Bottom stats */}
      {plan && planItems.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <CardLabel>Total Study Time</CardLabel>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{totalHours} hours</p>
                </div>
                <div className="w-px h-8 bg-[var(--border-default)]" />
                <div>
                  <CardLabel>Predicted Improvement</CardLabel>
                  <p className="text-lg font-bold text-success">+{predictedImprovementPct}%</p>
                </div>
                <div className="w-px h-8 bg-[var(--border-default)]" />
                <div>
                  <CardLabel>Progress</CardLabel>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {completedCount}/{planItems.length}
                  </p>
                </div>
              </div>
              <ProgressBar
                value={completedCount}
                max={Math.max(1, planItems.length)}
                color="success"
                size="lg"
                className="w-32"
              />
            </div>
          </Card>
        </motion.div>
      )}

      {/* Quick Access */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Quick Access</CardTitle>
          </CardHeader>
          <div className="flex gap-3 flex-wrap">
            <Button icon={Swords} onClick={() => navigate('/student/interview')}>
              Start Mock Interview
            </Button>
            <Button
              variant="secondary"
              icon={BookOpen}
              onClick={() => navigate('/student/quizzes')}
            >
              Take Practice Quiz
            </Button>
            <Button
              variant="secondary"
              icon={FileText}
              onClick={() => navigate('/student/resume')}
            >
              Review Resume
            </Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
