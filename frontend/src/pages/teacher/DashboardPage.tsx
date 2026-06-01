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
  TrendingUp,
  Upload,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, dashboardApi } from '../../api/client'
import type {
  DocumentProcessingStatus,
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
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
                  Class average
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
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}
