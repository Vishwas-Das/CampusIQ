import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  CalendarRange,
  Loader2,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, algorithmsApi } from '../../api/client'
import type {
  GenerateScheduleResponse,
  ScheduleSlotResponse,
  StudyTaskInput,
} from '../../types'

// ── Animation ───────────────────────────────────────────────────

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// ── Domain ──────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_OPTIONS = [3, 5, 7]

// Subjects cycle when the user clicks the row's colour dot. Empty string =
// no subject (the dot stays neutral).
const SUBJECT_CYCLE = ['', 'DAA', 'CN', 'DMS', 'OS'] as const

type Tone = { tint: string; ring: string }
const SUBJECT_TONES: Record<string, Tone> = {
  DAA: { tint: 'rgba(99, 102, 241, 0.16)', ring: '#6366F1' },
  CN: { tint: 'rgba(168, 85, 247, 0.16)', ring: '#A855F7' },
  DMS: { tint: 'rgba(16, 185, 129, 0.16)', ring: '#10B981' },
  OS: { tint: 'rgba(245, 158, 11, 0.16)', ring: '#F59E0B' },
}
const DEFAULT_TONE: Tone = {
  tint: 'rgba(56, 189, 248, 0.16)',
  ring: '#38BDF8',
}
const LOCKED_TONE: Tone = {
  tint: 'transparent',
  ring: 'rgba(255, 255, 255, 0.18)',
}
const NEUTRAL_DOT = 'rgba(255, 255, 255, 0.18)'

const toneFor = (subject?: string | null, locked?: boolean): Tone => {
  if (locked) return LOCKED_TONE
  if (!subject) return DEFAULT_TONE
  return SUBJECT_TONES[subject] ?? DEFAULT_TONE
}

const dotColorFor = (subject?: string | null): string => {
  if (!subject) return NEUTRAL_DOT
  return SUBJECT_TONES[subject]?.ring ?? DEFAULT_TONE.ring
}

const DEFAULT_TASKS: StudyTaskInput[] = [
  { topic: 'Arrays & Hashing', hours: 3, priority: 5, subject_code: 'DAA' },
  { topic: 'Trees + DFS/BFS', hours: 2, priority: 5, subject_code: 'DAA' },
  { topic: 'Dynamic Programming', hours: 4, priority: 5, subject_code: 'DAA' },
  { topic: 'TCP / UDP', hours: 2, priority: 5, subject_code: 'CN' },
  { topic: 'Mock Interview Prep', hours: 3, priority: 5, subject_code: null },
]

// ── Block grouping ──────────────────────────────────────────────

interface Block {
  dayIndex: number
  startHour: number
  endHour: number // exclusive
  topic: string
  subjectCode: string | null
  isLocked: boolean
}

function groupSlotsIntoBlocks(slots: ScheduleSlotResponse[]): Block[] {
  const byDay = new Map<number, ScheduleSlotResponse[]>()
  for (const s of slots) {
    if (!s.topic) continue
    if (!byDay.has(s.day_index)) byDay.set(s.day_index, [])
    byDay.get(s.day_index)!.push(s)
  }
  const blocks: Block[] = []
  for (const [day, daySlots] of byDay) {
    daySlots.sort((a, b) => a.hour_index - b.hour_index)
    let cur: Block | null = null
    for (const s of daySlots) {
      if (
        cur &&
        s.hour_index === cur.endHour &&
        s.topic === cur.topic &&
        (s.subject_code ?? null) === cur.subjectCode &&
        s.is_locked === cur.isLocked
      ) {
        cur.endHour += 1
      } else {
        if (cur) blocks.push(cur)
        cur = {
          dayIndex: day,
          startHour: s.hour_index,
          endHour: s.hour_index + 1,
          topic: s.topic!,
          subjectCode: s.subject_code ?? null,
          isLocked: s.is_locked,
        }
      }
    }
    if (cur) blocks.push(cur)
  }
  return blocks
}

const formatHour = (h: number): string => {
  const hour = ((h % 24) + 24) % 24
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

// ── Page ────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [tasks, setTasks] = useState<StudyTaskInput[]>(DEFAULT_TASKS)
  const [days, setDays] = useState(3)
  const [result, setResult] = useState<GenerateScheduleResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generate = async () => {
    const trimmed = tasks
      .map((t) => ({ ...t, topic: t.topic.trim(), priority: 5 }))
      .filter((t) => t.topic.length > 0 && t.hours > 0)
    if (trimmed.length === 0) {
      setResult(null)
      setError(null)
      return
    }
    setRunning(true)
    setError(null)
    try {
      const data = await algorithmsApi.generateSchedule({ tasks: trimmed, days })
      setResult(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not build the schedule. Try fewer hours per topic or more days.',
      )
    } finally {
      setRunning(false)
    }
  }

  const addTask = () =>
    setTasks((prev) => [
      ...prev,
      { topic: '', hours: 1, priority: 5, subject_code: null },
    ])
  const removeTask = (idx: number) =>
    setTasks((prev) => prev.filter((_, i) => i !== idx))
  const updateTask = (idx: number, patch: Partial<StudyTaskInput>) =>
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)))
  const cycleSubject = (idx: number) => {
    const current = (tasks[idx]?.subject_code ?? '') as (typeof SUBJECT_CYCLE)[number]
    const pos = SUBJECT_CYCLE.indexOf(current)
    const next = SUBJECT_CYCLE[(pos + 1) % SUBJECT_CYCLE.length]
    updateTask(idx, { subject_code: next || null })
  }

  const blocks = useMemo(
    () => (result ? groupSlotsIntoBlocks(result.slots) : []),
    [result],
  )

  // Auto-tighten the hour window so the grid only spans what's actually
  // populated (incl. the lunch / dinner locks). No empty hours at the top
  // or bottom.
  const { hourStart, hourEnd } = useMemo(() => {
    if (!result || result.slots.length === 0) {
      return { hourStart: 9, hourEnd: 21 }
    }
    let minH = Infinity
    let maxH = -Infinity
    for (const s of result.slots) {
      if (!s.topic) continue
      if (s.hour_index < minH) minH = s.hour_index
      if (s.hour_index + 1 > maxH) maxH = s.hour_index + 1
    }
    if (!isFinite(minH) || !isFinite(maxH)) {
      return { hourStart: 9, hourEnd: 21 }
    }
    return {
      hourStart: Math.max(0, minH),
      hourEnd: Math.min(24, maxH),
    }
  }, [result])

  const hourCount = hourEnd - hourStart
  const hasMeaningfulTask = tasks.some((t) => t.topic.trim().length > 0)
  const showEmpty = !result && !hasMeaningfulTask && !running

  return (
    <motion.div
      className="space-y-5 max-w-5xl mx-auto"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
          Study Schedule
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Plan your week in a few clicks.
        </p>
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

      {/* ── Hero: empty state or weekly grid ─────────────────── */}
      {showEmpty ? (
        <motion.div variants={fadeUp}>
          <EmptyState onAdd={addTask} />
        </motion.div>
      ) : (
        <motion.div variants={fadeUp} className="relative">
          <WeeklyGrid
            days={days}
            hourStart={hourStart}
            hourCount={hourCount}
            blocks={blocks}
          />
          {running && (
            <div
              aria-live="polite"
              className="absolute inset-0 flex items-center justify-center rounded-xl bg-[var(--bg-primary)]/55 backdrop-blur-[1px]"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-sm text-xs text-[var(--text-secondary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Re-planning…
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Topics + toolbar ─────────────────────────────────── */}
      <motion.div variants={fadeUp} className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
            Topics
          </h2>
          <div className="flex items-center gap-2">
            <DayPicker value={days} onChange={setDays} />
            <button
              type="button"
              onClick={() => void generate()}
              disabled={running}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-plan
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          {tasks.map((task, idx) => (
            <TaskRow
              key={idx}
              task={task}
              onChange={(patch) => updateTask(idx, patch)}
              onCycleSubject={() => cycleSubject(idx)}
              onRemove={() => removeTask(idx)}
              disabled={running}
            />
          ))}
          <button
            type="button"
            onClick={addTask}
            disabled={running}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-2 py-1.5 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a topic
          </button>
        </div>
      </motion.div>

      {/* ── Skipped ──────────────────────────────────────────── */}
      {result && result.skipped_tasks.length > 0 && (
        <motion.div variants={fadeUp}>
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-warning/25 bg-warning/5">
            <span className="text-[11px] font-semibold text-warning uppercase tracking-wider">
              Couldn't fit:
            </span>
            {result.skipped_tasks.map((t) => (
              <span
                key={t.topic}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-default)]"
              >
                {t.topic}
                <span className="text-[var(--text-tertiary)]">· {t.hours}h</span>
              </span>
            ))}
            <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
              Try fewer hours or more days, then Re-plan.
            </span>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] py-12 px-6 text-center">
      <CalendarRange className="h-7 w-7 mx-auto text-[var(--text-tertiary)] mb-3" />
      <p className="text-sm text-[var(--text-secondary)] max-w-sm mx-auto">
        Add a topic below — your week's plan appears the moment you hit Re-plan.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
      >
        <Plus className="h-3.5 w-3.5" />
        Add your first topic
      </button>
    </div>
  )
}

function DayPicker({
  value,
  onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div
      role="group"
      aria-label="Day count"
      className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-0.5"
    >
      {DAY_OPTIONS.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={clsx(
            'text-xs px-2.5 py-1 rounded transition-colors',
            value === n
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
        >
          {n} days
        </button>
      ))}
    </div>
  )
}

function TaskRow({
  task,
  onChange,
  onCycleSubject,
  onRemove,
  disabled,
}: {
  task: StudyTaskInput
  onChange: (patch: Partial<StudyTaskInput>) => void
  onCycleSubject: () => void
  onRemove: () => void
  disabled?: boolean
}) {
  const dot = dotColorFor(task.subject_code)
  const subjectLabel = task.subject_code ?? 'No subject'
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]/40 transition-colors"
      style={{ gridTemplateColumns: 'auto minmax(0, 1fr) 92px 32px' }}
    >
      <button
        type="button"
        onClick={onCycleSubject}
        disabled={disabled}
        title={`Subject: ${subjectLabel} (click to change)`}
        className="h-3 w-3 rounded-full shrink-0 ring-1 ring-inset ring-white/10 hover:scale-110 transition-transform disabled:opacity-50"
        style={{ background: dot }}
        aria-label={`Cycle subject (currently ${subjectLabel})`}
      />
      <input
        type="text"
        placeholder="Topic — e.g. Dynamic Programming"
        value={task.topic}
        onChange={(e) => onChange({ topic: e.target.value })}
        disabled={disabled}
        className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none min-w-0"
      />
      <HoursStepper
        value={task.hours}
        onChange={(v) => onChange({ hours: Math.max(1, Math.min(12, v)) })}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove topic"
        className="h-7 w-7 rounded-md text-[var(--text-tertiary)] hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function HoursStepper({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 1}
        className="h-7 w-7 inline-flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
        aria-label="Fewer hours"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="text-xs font-medium tabular-nums text-[var(--text-secondary)] w-[36px] text-center select-none">
        {value}
        <span className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] ml-0.5">
          hr
        </span>
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= 12}
        className="h-7 w-7 inline-flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
        aria-label="More hours"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  )
}

function WeeklyGrid({
  days,
  hourStart,
  hourCount,
  blocks,
}: {
  days: number
  hourStart: number
  hourCount: number
  blocks: Block[]
}) {
  const ROW_HEIGHT = 48
  const HEADER_HEIGHT = 36
  // Tighten the min column width as the day count goes up so 7 days fits
  // a typical laptop without horizontal scroll, while 3 days still uses
  // generous columns.
  const minColWidth = days >= 7 ? 96 : days >= 5 ? 128 : 160

  // Which day columns have at least one block in them — used to render a
  // subtle "Free" label in days the scheduler left empty.
  const daysWithWork = useMemo(() => {
    const s = new Set<number>()
    for (const b of blocks) if (!b.isLocked) s.add(b.dayIndex)
    return s
  }, [blocks])

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div
        className="relative rounded-xl overflow-hidden border border-[var(--border-default)] bg-[var(--bg-elevated)]"
        style={{
          display: 'grid',
          gridTemplateColumns: `56px repeat(${days}, minmax(${minColWidth}px, 1fr))`,
          gridTemplateRows: `${HEADER_HEIGHT}px repeat(${hourCount}, ${ROW_HEIGHT}px)`,
        }}
      >
        {/* Every cell uses explicit gridColumn + gridRow so the row-spanning
            blocks below don't shove the backdrop cells around via auto-flow. */}

        {/* Corner */}
        <div
          className="bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-default)]"
          style={{ gridColumn: 1, gridRow: 1 }}
        />

        {/* Day headers — slightly bolder, with a subtle bottom accent so the
            header reads separated from the cells below. */}
        {Array.from({ length: days }).map((_, d) => (
          <div
            key={`day-${d}`}
            className="bg-[var(--bg-tertiary)]/50 border-l border-b border-[var(--border-default)] flex items-center justify-center text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]"
            style={{ gridColumn: d + 2, gridRow: 1 }}
          >
            {DAY_LABELS[d % 7]}
          </div>
        ))}

        {/* Hour labels (column 1) */}
        {Array.from({ length: hourCount }).map((_, i) => {
          const hour = hourStart + i
          return (
            <div
              key={`label-${i}`}
              className={clsx(
                'flex items-start justify-end pr-2 pt-1 text-[10px] tabular-nums text-[var(--text-tertiary)] bg-[var(--bg-elevated)]',
                i !== 0 && 'border-t border-[var(--border-default)]/50',
              )}
              style={{ gridColumn: 1, gridRow: i + 2 }}
            >
              {formatHour(hour)}
            </div>
          )
        })}

        {/* Day cell backdrops — one per (day, hour). These sit BEHIND blocks
            in z-order because they appear earlier in the DOM. */}
        {Array.from({ length: hourCount }).map((_, i) =>
          Array.from({ length: days }).map((_, d) => (
            <div
              key={`bg-${i}-${d}`}
              className={clsx(
                'bg-[var(--bg-elevated)] border-l border-[var(--border-default)]/40',
                i !== 0 && 'border-t border-[var(--border-default)]/50',
              )}
              style={{ gridColumn: d + 2, gridRow: i + 2 }}
            />
          )),
        )}

        {/* "Free" badge in any day column the scheduler didn't touch — runs
            vertically through the middle hour of the column. */}
        {Array.from({ length: days }).map((_, d) => {
          if (daysWithWork.has(d)) return null
          // Span all hour rows so the label can centre vertically.
          return (
            <div
              key={`free-${d}`}
              className="pointer-events-none flex items-center justify-center text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]/60"
              style={{
                gridColumn: d + 2,
                gridRow: `2 / span ${hourCount}`,
              }}
            >
              Free
            </div>
          )
        })}

        {/* Blocks layered on top — they share grid cells with backdrops but
            render last in the DOM so they paint over them. */}
        {blocks.map((b, i) => {
          const top = b.startHour - hourStart
          const span = b.endHour - b.startHour
          if (top < 0 || top + span > hourCount) return null
          const tone = toneFor(b.subjectCode, b.isLocked)
          return (
            <div
              key={`b-${i}`}
              className={clsx(
                'relative m-1 rounded-md px-3 py-2 flex flex-col justify-between overflow-hidden z-10 transition-shadow',
                !b.isLocked && 'hover:shadow-md',
                b.isLocked && 'opacity-70',
              )}
              style={{
                gridColumn: b.dayIndex + 2,
                gridRow: `${top + 2} / span ${span}`,
                background: tone.tint,
                borderLeft: `3px solid ${tone.ring}`,
              }}
            >
              <span
                className={clsx(
                  'text-[13px] font-semibold leading-tight',
                  b.isLocked ? 'italic font-medium' : 'line-clamp-2',
                )}
                style={{
                  color: b.isLocked ? 'var(--text-tertiary)' : 'var(--text-primary)',
                }}
                title={b.topic}
              >
                {b.isLocked && (
                  <Lock className="inline h-3 w-3 mr-1 align-[-2px]" />
                )}
                {b.topic}
              </span>
              {!b.isLocked && b.subjectCode && (
                <span
                  className="text-[10px] font-mono uppercase tracking-wider self-end"
                  style={{ color: tone.ring, opacity: 1.85 }}
                >
                  {b.subjectCode}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
