import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  BarChart3,
  Brain,
  Download,
  FileText,
  Loader2,
  Megaphone,
  MessageSquare,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import Card, { CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import ProgressBar from '../../components/ui/ProgressBar'
import type { ProgressBarColor } from '../../components/ui/ProgressBar'
import StatCard from '../../components/dashboard/StatCard'
import ScoreRing from '../../components/dashboard/ScoreRing'
import TaskFeed, { type Task } from '../../components/dashboard/TaskFeed'
import ActivityFeed from '../../components/dashboard/ActivityFeed'
import { ApiError, dashboardApi, documentsApi } from '../../api/client'
import type { DashboardResponse, DocumentWithSubject } from '../../types'

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

  // Notes uploaded by teachers across this student's accessible subjects.
  // Loaded in parallel with the dashboard so a slow document list doesn't
  // block the main metrics.
  const [notes, setNotes] = useState<DocumentWithSubject[]>([])
  const [notesLoading, setNotesLoading] = useState(true)

  // The note currently expanded in the preview modal (null = modal closed).
  // We re-fetch by ID on open to get the summary text, which the list endpoint
  // does include — so this is just a UI handle, no extra request needed.
  const [previewNote, setPreviewNote] = useState<DocumentWithSubject | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleDownload = async (note: DocumentWithSubject) => {
    setDownloading(true)
    setDownloadError(null)
    try {
      // Authenticated fetch (browser won't send Bearer on a plain <a href>),
      // then trigger a download by clicking a temporary anchor with the blob URL.
      const { blob } = await documentsApi.downloadBlob(note.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Use the teacher's chapter name (the name they entered in the upload
      // form) as the download filename — that's the meaningful label.
      // Compute it client-side so we don't rely on Content-Disposition
      // parsing (RFC 5987 encoded variants can leak %20 into the browser).
      const ext = note.file_name.includes('.')
        ? note.file_name.slice(note.file_name.lastIndexOf('.'))
        : ''
      const sanitisedChapter = note.chapter
        ? note.chapter.replace(/[<>:"/\\|?*]/g, '').trim().replace(/\.+$/, '')
        : ''
      a.download = sanitisedChapter ? `${sanitisedChapter}${ext}` : note.file_name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not download the file',
      )
    } finally {
      setDownloading(false)
    }
  }

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

    // Fetch documents independently — failure here shouldn't blank the dashboard.
    void (async () => {
      try {
        const docs = await documentsApi.list()
        if (!cancelled) {
          // Show only teacher-uploaded public docs (not the student's own
          // private notes — those are scoped to the Note Assistant page).
          setNotes(docs.filter((d) => d.owner_student_id === null))
        }
      } catch {
        // Silent — notes card just stays empty
      } finally {
        if (!cancelled) setNotesLoading(false)
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

        {/* Notes uploaded by teachers — public docs across this student's subjects.
            Click navigates to the Note Assistant where the student can chat with the doc. */}
        <motion.div initial={fadeUpInitial} animate={fadeUpAnimate(0.5)}>
          <CardLabel className="mb-3 block">NOTES UPLOADED</CardLabel>
          {notesLoading ? (
            <Card className="flex items-center gap-2 justify-center py-6 text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading notes…</span>
            </Card>
          ) : notes.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                No notes uploaded yet. Materials shared by your teachers will appear here.
              </p>
            </Card>
          ) : (
            <Card padding={false}>
              <ul className="divide-y divide-[var(--border-primary)]">
                {notes.slice(0, 5).map((n) => (
                  <li
                    key={n.id}
                    onClick={() => {
                      setDownloadError(null)
                      setPreviewNote(n)
                    }}
                    className="px-4 py-3 flex items-center gap-3 text-sm cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <FileText className="h-4 w-4 text-[var(--text-secondary)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-[var(--text-primary)]">
                        {n.chapter || n.title || n.file_name}
                      </div>
                    </div>
                    <Badge size="sm" variant="primary">
                      {n.subject_code}
                    </Badge>
                    <Badge
                      size="sm"
                      variant={
                        n.processing_status === 'ready'
                          ? 'success'
                          : n.processing_status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {n.processing_status}
                    </Badge>
                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
                      {relativeTime(n.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
              {notes.length > 5 && (
                <button
                  onClick={() => navigate('/student/notes')}
                  className="w-full px-4 py-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-t border-[var(--border-primary)] transition-colors"
                >
                  View all {notes.length} notes →
                </button>
              )}
            </Card>
          )}
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

      {/* Note preview modal — opens when student clicks a row in NOTES UPLOADED.
          Shows the AI summary + lets them download the file or open the chat. */}
      <Modal
        isOpen={previewNote !== null}
        onClose={() => setPreviewNote(null)}
        // Prefer the chapter (teacher-given name in the upload form) over
        // the raw uploaded filename. Same precedence we use for the dashboard
        // row label AND the download filename, so the student sees one
        // consistent identity for this note across every surface.
        title={
          previewNote?.chapter ??
          previewNote?.title ??
          previewNote?.file_name ??
          'Note'
        }
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-danger min-h-[1rem]">
              {downloadError}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPreviewNote(null)
                  navigate('/student/notes')
                }}
              >
                <MessageSquare className="h-4 w-4" />
                Open in Note Assistant
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => previewNote && void handleDownload(previewNote)}
                disabled={downloading || !previewNote}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? 'Downloading…' : 'Download'}
              </Button>
            </div>
          </div>
        }
      >
        {previewNote && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="primary" size="sm">
                {previewNote.subject_code} · {previewNote.subject_name}
              </Badge>
              <Badge
                size="sm"
                variant={
                  previewNote.processing_status === 'ready'
                    ? 'success'
                    : previewNote.processing_status === 'failed'
                      ? 'danger'
                      : 'warning'
                }
              >
                {previewNote.processing_status}
              </Badge>
              {/* Only show the raw upload filename when the teacher didn't
                  set a chapter. With a chapter, the modal title IS the
                  identity — the raw name would just clutter and undermine
                  the teacher-chosen label. */}
              {!previewNote.chapter && (
                <span className="text-[var(--text-tertiary)]">
                  {previewNote.file_name}
                </span>
              )}
              <span className="text-[var(--text-tertiary)]">
                · {relativeTime(previewNote.created_at)}
              </span>
            </div>

            <div>
              <CardLabel className="mb-2 block">AI SUMMARY</CardLabel>
              {previewNote.summary ? (
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {previewNote.summary}
                </p>
              ) : previewNote.processing_status === 'ready' ? (
                <p className="text-sm text-[var(--text-tertiary)] italic">
                  No summary was generated for this document.
                </p>
              ) : previewNote.processing_status === 'failed' ? (
                <p className="text-sm text-danger">
                  This document failed to process. Ask the teacher to re-upload it.
                </p>
              ) : (
                <p className="text-sm text-[var(--text-tertiary)] italic">
                  This document is still being processed. The summary will appear here once it's ready.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
