/**
 * Study Schedule page — port of the "Study Schedule.html" design bundle.
 *
 * Visuals:
 *   • Header card with title + Expand/Collapse-all toggle + 4-up stats
 *     (Total study, Average, Subjects, Schedule) + legend pills.
 *   • A list of expandable day cards. Closed: day name + today dot + subject
 *     pills + total hours + session count + chevron. Open: a vertical
 *     timeline of time blocks (start/end, accent bar, title + type badge,
 *     duration, click-to-toggle if the block has a "today" lock).
 *   • Topics editor below — keeps the existing add-row + day picker +
 *     Re-plan workflow so the user can customise instead of using the
 *     design's hardcoded schedule.
 *   • Skipped tasks pill row + footer tagline.
 *
 * Data wiring is unchanged: `algorithmsApi.generateSchedule({ tasks, days })`
 * returns slots; `groupSlotsIntoBlocks` collapses contiguous same-topic
 * slots into blocks rendered inside the day cards.
 */
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Coffee,
  Lightbulb,
  Loader2,
  Lock,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, algorithmsApi } from '../../api/client'
import Modal from '../../components/ui/Modal'
import type {
  GenerateScheduleResponse,
  ScheduleSlotResponse,
  StudyTaskInput,
} from '../../types'

// ── Animation ───────────────────────────────────────────────────

const stagger: Variants = { animate: { transition: { staggerChildren: 0.05 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// ── Domain ──────────────────────────────────────────────────────

const FULL_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]
const DAY_OPTIONS = [3, 5, 7]
const SUBJECT_CYCLE = ['', 'DAA', 'CN', 'DMS', 'OS'] as const

// Subject palette mirrors the design — five vivid hues plus emerald as a
// spare. Order matters: when the user has more subjects than entries in
// PALETTE_ORDER we wrap around.
type PaletteName = 'purple' | 'blue' | 'amber' | 'pink' | 'cyan' | 'emerald'
const PALETTE_ORDER: PaletteName[] = [
  'purple',
  'blue',
  'amber',
  'pink',
  'cyan',
  'emerald',
]

interface SubjectPalette {
  dot: string
  pillBg: string
  pillText: string
  ring: string
  accent: string
}

const PALETTE: Record<PaletteName, SubjectPalette> = {
  purple: {
    dot: 'bg-purple-500',
    pillBg: 'bg-purple-500/15',
    pillText: 'text-purple-300',
    ring: 'ring-purple-500/30',
    accent: '#A855F7',
  },
  blue: {
    dot: 'bg-blue-500',
    pillBg: 'bg-blue-500/15',
    pillText: 'text-blue-300',
    ring: 'ring-blue-500/30',
    accent: '#3B82F6',
  },
  amber: {
    dot: 'bg-amber-500',
    pillBg: 'bg-amber-500/15',
    pillText: 'text-amber-300',
    ring: 'ring-amber-500/30',
    accent: '#F59E0B',
  },
  pink: {
    dot: 'bg-pink-500',
    pillBg: 'bg-pink-500/15',
    pillText: 'text-pink-300',
    ring: 'ring-pink-500/30',
    accent: '#EC4899',
  },
  cyan: {
    dot: 'bg-cyan-500',
    pillBg: 'bg-cyan-500/15',
    pillText: 'text-cyan-300',
    ring: 'ring-cyan-500/30',
    accent: '#06B6D4',
  },
  emerald: {
    dot: 'bg-emerald-500',
    pillBg: 'bg-emerald-500/15',
    pillText: 'text-emerald-300',
    ring: 'ring-emerald-500/30',
    accent: '#10B981',
  },
}

const UNASSIGNED_KEY = '__unassigned__'
const LOCKED_KEY = '__locked__'

// Seed the page with topics so first-time visitors see something nice.
const DEFAULT_TASKS: StudyTaskInput[] = [
  { topic: 'Arrays & Hashing', hours: 3, priority: 5, subject_code: 'DAA' },
  { topic: 'Trees · DFS / BFS', hours: 2, priority: 5, subject_code: 'DAA' },
  { topic: 'Dynamic Programming', hours: 4, priority: 5, subject_code: 'DAA' },
  { topic: 'TCP / UDP', hours: 2, priority: 5, subject_code: 'CN' },
  { topic: 'Mock Interview Prep', hours: 3, priority: 5, subject_code: null },
]

// ── Block grouping ──────────────────────────────────────────────

interface Block {
  dayIndex: number
  startHour: number
  endHour: number
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
  blocks.sort((a, b) =>
    a.dayIndex !== b.dayIndex
      ? a.dayIndex - b.dayIndex
      : a.startHour - b.startHour,
  )
  return blocks
}

const formatHour = (h: number): string => {
  const hour = ((h % 24) + 24) % 24
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

const spanLabel = (hours: number): string => {
  if (hours <= 0) return '—'
  if (hours === 1) return '1 hr'
  return `${hours} hr`
}

// "Type" badge derived from block metadata. The design uses literal
// strings like "Theory" / "Practice" / "Leetcode medium"; we don't have
// those server-side, so we synthesise something honest from what we do
// have: meal locks are "Break"; everything else is "Study" — with the
// subject as a secondary hint when set.
const blockTypeLabel = (b: Block): string => {
  if (b.isLocked) return 'Break'
  if (b.subjectCode) return `${b.subjectCode} session`
  return 'Study'
}

// ── Subject indexing — derives a palette + display label for every
// distinct subject seen across tasks and blocks. Tasks declared without
// a subject get a single shared "No subject" entry so the legend isn't
// silent. Locked blocks (meals) are their own bucket. ─────────────────

interface SubjectEntry {
  key: string
  code: string | null
  label: string
  palette: SubjectPalette
  hours: number
}

function buildSubjectIndex(
  tasks: StudyTaskInput[],
  blocks: Block[],
): { entries: SubjectEntry[]; map: Map<string, SubjectEntry> } {
  // Stable order keyed by first appearance in `tasks` (then blocks).
  const orderedKeys: string[] = []
  const seen = new Set<string>()
  const declaredHours = new Map<string, number>()

  const keyFor = (subject: string | null | undefined, locked: boolean) => {
    if (locked) return LOCKED_KEY
    return subject ? subject : UNASSIGNED_KEY
  }

  for (const t of tasks) {
    if (!t.topic.trim()) continue
    const k = keyFor(t.subject_code, false)
    if (!seen.has(k)) {
      seen.add(k)
      orderedKeys.push(k)
    }
    declaredHours.set(k, (declaredHours.get(k) ?? 0) + t.hours)
  }
  for (const b of blocks) {
    const k = keyFor(b.subjectCode, b.isLocked)
    if (!seen.has(k)) {
      seen.add(k)
      orderedKeys.push(k)
    }
  }

  const entries: SubjectEntry[] = []
  let paletteIdx = 0
  for (const k of orderedKeys) {
    if (k === LOCKED_KEY) {
      entries.push({
        key: LOCKED_KEY,
        code: null,
        label: 'Meal / break',
        palette: PALETTE.emerald,
        hours: 0,
      })
      continue
    }
    if (k === UNASSIGNED_KEY) {
      entries.push({
        key: UNASSIGNED_KEY,
        code: null,
        label: 'No subject',
        palette: PALETTE.cyan,
        hours: declaredHours.get(k) ?? 0,
      })
      continue
    }
    const palette = PALETTE[PALETTE_ORDER[paletteIdx % PALETTE_ORDER.length]!]
    paletteIdx += 1
    entries.push({
      key: k,
      code: k,
      label: k,
      palette,
      hours: declaredHours.get(k) ?? 0,
    })
  }

  const map = new Map<string, SubjectEntry>()
  for (const e of entries) map.set(e.key, e)
  return { entries, map }
}

const subjectEntryForBlock = (
  b: Block,
  map: Map<string, SubjectEntry>,
): SubjectEntry => {
  if (b.isLocked) return map.get(LOCKED_KEY)!
  return map.get(b.subjectCode ?? UNASSIGNED_KEY)!
}

// ── Page ────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [tasks, setTasks] = useState<StudyTaskInput[]>(DEFAULT_TASKS)
  const [days, setDays] = useState(7)
  const [result, setResult] = useState<GenerateScheduleResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openDays, setOpenDays] = useState<Set<number>>(() => new Set([0]))
  const [editorOpen, setEditorOpen] = useState(false)

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
      // Slightly higher daily cap for short weeks so 5×1hr fits without
      // running out of days. Long weeks stay at the default 3hr/day.
      const dailyCap = days <= 3 ? 4 : 3
      const data = await algorithmsApi.generateSchedule({
        tasks: trimmed,
        days,
        strategy: 'spread',
        daily_cap_hours: dailyCap,
      })
      setResult(data)
      // Open Monday plus any "today" if it falls inside the planned days.
      setOpenDays((prev) => {
        if (prev.size > 0) return prev
        const next = new Set<number>([0])
        return next
      })
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

  const { entries: subjectEntries, map: subjectMap } = useMemo(
    () => buildSubjectIndex(tasks, blocks),
    [tasks, blocks],
  )

  // Total scheduled hours from the blocks (skip meal locks).
  const totalHours = useMemo(
    () =>
      blocks
        .filter((b) => !b.isLocked)
        .reduce((s, b) => s + (b.endHour - b.startHour), 0),
    [blocks],
  )

  // Which day indices have at least one non-locked block.
  const daysWithWork = useMemo(() => {
    const s = new Set<number>()
    for (const b of blocks) if (!b.isLocked) s.add(b.dayIndex)
    return s
  }, [blocks])

  // "Today" highlighting — show the dot only if today's weekday falls
  // inside the scheduled window. JS getDay(): 0=Sun..6=Sat; our day index
  // starts at 0=Mon..6=Sun.
  const todayIndex = useMemo(() => {
    const js = new Date().getDay()
    const monBased = (js + 6) % 7
    return monBased < days ? monBased : null
  }, [days])

  const toggleDay = (idx: number) =>
    setOpenDays((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })

  const allOpen = openDays.size === days && days > 0
  const expandAll = () => setOpenDays(new Set(Array.from({ length: days }, (_, i) => i)))
  const collapseAll = () => setOpenDays(new Set())

  const hasMeaningfulTask = tasks.some((t) => t.topic.trim().length > 0)
  const showEmpty = !result && !hasMeaningfulTask && !running

  const subjectsForLegend = subjectEntries.filter((s) => s.key !== LOCKED_KEY)
  const avgHoursPerDay = days > 0 ? totalHours / days : 0

  const topicsCardProps = {
    tasks,
    days,
    running,
    onUpdate: updateTask,
    onRemove: removeTask,
    onAdd: addTask,
    onCycleSubject: cycleSubject,
    onDaysChange: setDays,
    onReplan: () => void generate(),
    subjectMap,
  }

  return (
    <motion.div
      className="space-y-4 max-w-6xl mx-auto"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <HeaderCard
          totalHours={totalHours}
          avgHoursPerDay={avgHoursPerDay}
          subjectsForLegend={subjectsForLegend}
          daysCount={days}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          allOpen={allOpen}
          onOpenEditor={() => setEditorOpen(true)}
        />
      </motion.div>

      {/* Two-column body: schedule on the left, topics sticky on the right.
          Collapses to a single column below lg so mobile gets the schedule
          first and the editor below. The header "Edit plan" button still
          opens the same editor as a popover on every breakpoint. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <div className="space-y-4 min-w-0">
          {showEmpty ? (
            <motion.div variants={fadeUp}>
              <EmptyState onAdd={addTask} />
            </motion.div>
          ) : (
            <motion.div variants={fadeUp} className="relative space-y-2.5">
              {Array.from({ length: days }).map((_, dayIdx) => (
                <DayCard
                  key={dayIdx}
                  dayIndex={dayIdx}
                  blocks={blocks.filter((b) => b.dayIndex === dayIdx)}
                  subjectMap={subjectMap}
                  isOpen={openDays.has(dayIdx)}
                  isToday={todayIndex === dayIdx}
                  hasWork={daysWithWork.has(dayIdx)}
                  onToggle={() => toggleDay(dayIdx)}
                />
              ))}
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

          {result && result.skipped_tasks.length > 0 && (
            <motion.div variants={fadeUp}>
              <SkippedRow tasks={result.skipped_tasks} />
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <TipsCard />
          </motion.div>
        </div>

        {/* Sticky topics editor on the side. Stays visible while the day
            list scrolls past. */}
        <motion.aside
          variants={fadeUp}
          className="lg:sticky lg:top-[5.5rem] self-start"
        >
          <TopicsCard {...topicsCardProps} compact />
        </motion.aside>
      </div>

      <motion.div
        variants={fadeUp}
        className="pt-2 pb-1 text-center text-[11px] font-mono text-[var(--text-tertiary)]"
      >
        {totalHours} hr{totalHours === 1 ? '' : 's'} ·{' '}
        {subjectsForLegend.length} subject
        {subjectsForLegend.length === 1 ? '' : 's'} · {days} day
        {days === 1 ? '' : 's'} · meal locks shown as breaks
      </motion.div>

      <Modal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="Edit subjects & time"
        size="lg"
      >
        <TopicsCard {...topicsCardProps} chrome="bare" />
      </Modal>
    </motion.div>
  )
}

// ── Header ──────────────────────────────────────────────────────

function HeaderCard({
  totalHours,
  avgHoursPerDay,
  subjectsForLegend,
  daysCount,
  onExpandAll,
  onCollapseAll,
  allOpen,
  onOpenEditor,
}: {
  totalHours: number
  avgHoursPerDay: number
  subjectsForLegend: SubjectEntry[]
  daysCount: number
  onExpandAll: () => void
  onCollapseAll: () => void
  allOpen: boolean
  onOpenEditor: () => void
}) {
  return (
    <div
      className="rounded-xl border p-5 sm:p-6"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
      }}
    >
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Week plan · {daysCount} {daysCount === 1 ? 'day' : 'days'}</span>
          </div>
          <h1 className="mt-1.5 text-2xl sm:text-[28px] font-semibold tracking-tight text-[var(--text-primary)]">
            Study schedule · this week
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)] max-w-xl">
            Fundamentals early, harder topics mid-week, mocks on the
            weekend. Click any day to expand its timeline.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenEditor}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit plan
          </button>
          <button
            onClick={allOpen ? onCollapseAll : onExpandAll}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            {allOpen ? (
              <ChevronsDownUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronsUpDown className="w-3.5 h-3.5" />
            )}
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5">
        <Stat value={String(totalHours)} sub="hrs" label="Total study" />
        <Stat
          value={avgHoursPerDay.toFixed(1)}
          sub="hrs / day"
          label="Average"
        />
        <Stat value={String(subjectsForLegend.length)} label="Subjects" />
        <Stat value={String(daysCount)} sub="days" label="Schedule" />
      </div>

      {subjectsForLegend.length > 0 && (
        <div
          className="mt-6 pt-5 border-t"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
            Legend
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {subjectsForLegend.map((s) => (
              <div
                key={s.key}
                className="inline-flex items-center gap-2 rounded-full border pl-2 pr-3 py-1"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <span className={clsx('w-2 h-2 rounded-full', s.palette.dot)} />
                <span className="text-[12px] text-[var(--text-secondary)]">
                  {s.label}
                </span>
                {s.hours > 0 && (
                  <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                    {s.hours}h
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  value,
  label,
  sub,
}: {
  value: string
  label: string
  sub?: string
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
          {value}
        </span>
        {sub && (
          <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
            {sub}
          </span>
        )}
      </div>
      <span className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mt-0.5">
        {label}
      </span>
    </div>
  )
}

// ── Subject pill (used inside day cards) ────────────────────────

function SubjectPill({ entry }: { entry: SubjectEntry }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        entry.palette.pillBg,
        entry.palette.pillText,
      )}
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', entry.palette.dot)} />
      {entry.label}
    </span>
  )
}

function TypeBadge({ label, palette }: { label: string; palette?: SubjectPalette }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border-subtle)',
        color: palette ? palette.accent : 'var(--text-tertiary)',
      }}
    >
      {label}
    </span>
  )
}

// ── Day card ────────────────────────────────────────────────────

function DayCard({
  dayIndex,
  blocks,
  subjectMap,
  isOpen,
  isToday,
  hasWork,
  onToggle,
}: {
  dayIndex: number
  blocks: Block[]
  subjectMap: Map<string, SubjectEntry>
  isOpen: boolean
  isToday: boolean
  hasWork: boolean
  onToggle: () => void
}) {
  const studyBlocks = blocks.filter((b) => !b.isLocked)
  const totalHrs = studyBlocks.reduce(
    (s, b) => s + (b.endHour - b.startHour),
    0,
  )
  const firstStart = blocks[0]?.startHour
  const lastEnd = blocks[blocks.length - 1]?.endHour
  const subjectEntries = (() => {
    const seen = new Set<string>()
    const out: SubjectEntry[] = []
    for (const b of blocks) {
      if (b.isLocked) continue
      const entry = subjectEntryForBlock(b, subjectMap)
      if (!seen.has(entry.key)) {
        seen.add(entry.key)
        out.push(entry)
      }
    }
    return out
  })()

  return (
    <div
      className={clsx(
        'rounded-xl border transition-colors',
        isOpen
          ? 'border-[var(--border-strong)]'
          : 'border-[var(--border-default)]',
      )}
      style={{ background: 'var(--bg-elevated)' }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 sm:p-5 text-left transition-colors hover:bg-[var(--bg-tertiary)]/40 rounded-xl"
      >
        <div className="w-[88px] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {FULL_DAY_NAMES[dayIndex % 7]}
            </span>
            {isToday && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                style={{ boxShadow: '0 0 8px rgba(16,185,129,0.6)' }}
              />
            )}
          </div>
          <div className="text-[11px] tabular-nums font-mono text-[var(--text-tertiary)] mt-0.5">
            {firstStart !== undefined && lastEnd !== undefined ? (
              `${formatHour(firstStart)} – ${formatHour(lastEnd)}`
            ) : (
              <span className="uppercase tracking-wider">Free</span>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {subjectEntries.length > 0 ? (
            subjectEntries.map((s) => <SubjectPill key={s.key} entry={s} />)
          ) : (
            <span className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-[0.18em]">
              {hasWork ? '' : 'No sessions'}
            </span>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-5 pr-1">
          <div className="text-right">
            <div className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
              {totalHrs} hr{totalHrs === 1 ? '' : 's'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              {studyBlocks.length} session{studyBlocks.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <span
          className="shrink-0 inline-flex w-7 h-7 items-center justify-center rounded-lg text-[var(--text-tertiary)]"
          style={{
            transform: `rotate(${isOpen ? 180 : 0}deg)`,
            transition: 'transform 250ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <ChevronDown className="w-4 h-4" />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="open"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className="px-3 sm:px-4 pb-4 pt-1 border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {blocks.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-[var(--text-tertiary)] uppercase tracking-[0.18em]">
                  Free day
                </div>
              ) : (
                <div className="space-y-0.5 pt-2">
                  {interleaveBreaks(blocks).map((node, i) =>
                    node.kind === 'gap' ? (
                      <BreakRow
                        key={`gap-${i}`}
                        start={node.startHour}
                        end={node.endHour}
                      />
                    ) : (
                      <TimeBlockRow
                        key={`blk-${i}`}
                        block={node.block}
                        entry={subjectEntryForBlock(node.block, subjectMap)}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Breaks: synthesize gap rows between non-adjacent blocks so the
// timeline reads as a continuous day instead of jumping from 11 AM to
// 2 PM. ─────────────────────────────────────────────────────────────

type DayNode =
  | { kind: 'block'; block: Block }
  | { kind: 'gap'; startHour: number; endHour: number }

function interleaveBreaks(blocks: Block[]): DayNode[] {
  const out: DayNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const cur = blocks[i]!
    if (i > 0) {
      const prev = blocks[i - 1]!
      if (cur.startHour > prev.endHour) {
        out.push({
          kind: 'gap',
          startHour: prev.endHour,
          endHour: cur.startHour,
        })
      }
    }
    out.push({ kind: 'block', block: cur })
  }
  return out
}

function BreakRow({ start, end }: { start: number; end: number }) {
  const span = end - start
  return (
    <div className="flex items-center gap-3 pl-[68px] pr-2 py-1.5">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <Coffee className="w-3.5 h-3.5" />
        <span className="text-[11px] tabular-nums">
          {span === 1 ? '1 hr' : `${span} hr`} break
        </span>
        <span className="text-[11px] tabular-nums opacity-70">
          · {formatHour(start)} – {formatHour(end)}
        </span>
      </div>
      <div
        className="flex-1 h-px"
        style={{
          background:
            'linear-gradient(to right, var(--border-subtle), transparent)',
        }}
      />
    </div>
  )
}

function TimeBlockRow({
  block,
  entry,
}: {
  block: Block
  entry: SubjectEntry
}) {
  const duration = block.endHour - block.startHour
  return (
    <div
      className={clsx(
        'group relative flex gap-4 rounded-lg p-3 transition-colors',
        !block.isLocked && 'hover:bg-[var(--bg-tertiary)]/40',
      )}
    >
      <div className="w-[58px] shrink-0 pt-0.5">
        <div className="text-[11px] tabular-nums font-mono text-[var(--text-primary)] leading-tight">
          {formatHour(block.startHour)}
        </div>
        <div className="text-[11px] tabular-nums font-mono text-[var(--text-tertiary)] leading-tight">
          {formatHour(block.endHour)}
        </div>
        <div className="text-[10px] tabular-nums font-mono mt-1 opacity-70 text-[var(--text-tertiary)]">
          {spanLabel(duration)}
        </div>
      </div>

      <div
        className={clsx('w-1 shrink-0 rounded-full self-stretch', entry.palette.dot)}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <h4
            className={clsx(
              'text-sm font-semibold leading-snug',
              block.isLocked && 'italic font-medium',
            )}
            style={{
              color: block.isLocked
                ? 'var(--text-tertiary)'
                : 'var(--text-primary)',
            }}
          >
            {block.isLocked && (
              <Lock className="inline h-3 w-3 mr-1 align-[-2px]" />
            )}
            {block.topic}
          </h4>
          <TypeBadge
            label={blockTypeLabel(block)}
            palette={block.isLocked ? undefined : entry.palette}
          />
        </div>
        {!block.isLocked && block.subjectCode && (
          <p className="mt-1 text-[12px] text-[var(--text-secondary)] leading-relaxed">
            {block.subjectCode} · {spanLabel(duration)} focused session
          </p>
        )}
        {block.isLocked && (
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)] italic">
            Scheduler keeps this hour clear.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Topics editor ───────────────────────────────────────────────

function TopicsCard({
  tasks,
  days,
  running,
  onUpdate,
  onRemove,
  onAdd,
  onCycleSubject,
  onDaysChange,
  onReplan,
  subjectMap,
  compact = false,
  chrome = 'card',
}: {
  tasks: StudyTaskInput[]
  days: number
  running: boolean
  onUpdate: (idx: number, patch: Partial<StudyTaskInput>) => void
  onRemove: (idx: number) => void
  onAdd: () => void
  onCycleSubject: (idx: number) => void
  onDaysChange: (n: number) => void
  onReplan: () => void
  subjectMap: Map<string, SubjectEntry>
  /** Tighter padding + stacked header — used in the sidebar where width
   *  is constrained. */
  compact?: boolean
  /** `card` (default) renders the standalone card chrome. `bare` skips
   *  the outer border so this can sit inside a Modal cleanly. */
  chrome?: 'card' | 'bare'
}) {
  const cardClass =
    chrome === 'card'
      ? clsx('rounded-xl border', compact ? 'p-3.5' : 'p-4 sm:p-5')
      : ''
  const cardStyle =
    chrome === 'card'
      ? {
          background: 'var(--bg-elevated)' as const,
          borderColor: 'var(--border-default)' as const,
        }
      : undefined
  return (
    <div className={cardClass} style={cardStyle}>
      {chrome === 'card' && (
        <div
          className={clsx(
            'flex gap-3 mb-3',
            compact
              ? 'flex-col items-stretch'
              : 'items-center justify-between flex-wrap',
          )}
        >
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
              Topics
            </h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Edit, then Re-plan. The scheduler packs your hours across the week.
            </p>
          </div>
          <div className={clsx('flex items-center gap-2', compact && 'justify-between')}>
            <DayPicker value={days} onChange={onDaysChange} />
            <button
              type="button"
              onClick={onReplan}
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
      )}

      {/* Modal usage gets a slimmer top toolbar (no card header). */}
      {chrome === 'bare' && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <DayPicker value={days} onChange={onDaysChange} />
          <button
            type="button"
            onClick={onReplan}
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
      )}

      <div className="space-y-1.5">
        {tasks.map((task, idx) => (
          <TaskRow
            key={idx}
            task={task}
            subjectMap={subjectMap}
            onChange={(patch) => onUpdate(idx, patch)}
            onCycleSubject={() => onCycleSubject(idx)}
            onRemove={() => onRemove(idx)}
            disabled={running}
            compact={compact}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          disabled={running}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors px-2 py-1.5 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a topic
        </button>
      </div>
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
      className="inline-flex items-center rounded-md border p-0.5"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--bg-secondary)',
      }}
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
  subjectMap,
  onChange,
  onCycleSubject,
  onRemove,
  disabled,
  compact = false,
}: {
  task: StudyTaskInput
  subjectMap: Map<string, SubjectEntry>
  onChange: (patch: Partial<StudyTaskInput>) => void
  onCycleSubject: () => void
  onRemove: () => void
  disabled?: boolean
  compact?: boolean
}) {
  const entry = subjectMap.get(task.subject_code ?? UNASSIGNED_KEY)
  const dotClass = entry?.palette.dot ?? 'bg-zinc-500'
  const subjectLabel = task.subject_code ?? 'No subject'
  return (
    <div
      className={clsx(
        'grid items-center rounded-lg border transition-colors hover:bg-[var(--bg-tertiary)]/40',
        compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-3 py-2',
      )}
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--bg-secondary)',
        gridTemplateColumns: compact
          ? 'auto minmax(0, 1fr) auto 28px'
          : 'auto minmax(0, 1fr) 92px 32px',
      }}
    >
      <button
        type="button"
        onClick={onCycleSubject}
        disabled={disabled}
        title={`Subject: ${subjectLabel} (click to change)`}
        className={clsx(
          'h-3 w-3 rounded-full shrink-0 ring-1 ring-inset ring-white/10 hover:scale-110 transition-transform disabled:opacity-50',
          dotClass,
        )}
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
    <div
      className="inline-flex items-center rounded-md border overflow-hidden"
      style={{
        borderColor: 'var(--border-default)',
        background: 'var(--bg-tertiary)',
      }}
    >
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

// ── Tips card (lifted from the design's final block) ────────────

function TipsCard() {
  return (
    <div
      className="rounded-xl border p-5 sm:p-6"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
      }}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <Lightbulb className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Notes for the week
          </h3>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            <TipItem n="01">
              <span className="text-[var(--text-primary)]">
                Solve cold, then read the editorial.
              </span>{' '}
              Brute-force out loud before you optimize — the muscle that
              wins mocks is narration, not speed.
            </TipItem>
            <TipItem n="02">
              <span className="text-[var(--text-primary)]">
                Hard time-box stuck moments at 12–15 min.
              </span>{' '}
              Read the editorial, close it, re-implement from memory the
              same day. Grinding silently is the slowest learning loop
              there is.
            </TipItem>
            <TipItem n="03">
              <span className="text-[var(--text-primary)]">
                Re-do the problems you flagged.
              </span>{' '}
              The weekend mock and the weakness lap are where the patterns
              actually consolidate — don't skip them when energy is low.
            </TipItem>
          </ul>
        </div>
      </div>
    </div>
  )
}

function TipItem({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="font-mono text-[var(--text-tertiary)] shrink-0">{n}</span>
      <span>{children}</span>
    </li>
  )
}

// ── Skipped tasks ──────────────────────────────────────────────

function SkippedRow({
  tasks,
}: {
  tasks: GenerateScheduleResponse['skipped_tasks']
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-warning/25 bg-warning/5">
      <span className="text-[11px] font-semibold text-warning uppercase tracking-wider">
        Couldn't fit:
      </span>
      {tasks.map((t) => (
        <span
          key={t.topic}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          {t.topic}
          <span className="text-[var(--text-tertiary)]">· {t.hours}h</span>
        </span>
      ))}
      <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
        Try fewer hours or more days, then Re-plan.
      </span>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      className="rounded-xl border border-dashed py-12 px-6 text-center"
      style={{
        background: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
      }}
    >
      <CalendarDays className="h-7 w-7 mx-auto text-[var(--text-tertiary)] mb-3" />
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
