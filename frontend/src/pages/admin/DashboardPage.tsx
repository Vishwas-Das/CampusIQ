import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Activity,
  AlertCircle,
  Brain,
  CheckCircle,
  Clock,
  FileText,
  HardDrive,
  Loader2,
  Server,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, dashboardApi } from '../../api/client'
import type { AdminDashboardResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const STAT_ICONS: Record<string, LucideIcon> = {
  'TOTAL USERS': Users,
  'ACTIVE TODAY': Activity,
  DOCUMENTS: FileText,
  QUIZZES: Brain,
}

const ROLE_DOT_COLORS: Record<string, string> = {
  student: 'bg-primary',
  teacher: 'bg-success',
  admin: 'bg-warning',
}

const ROLE_LABELS: Record<string, string> = {
  student: 'Students',
  teacher: 'Teachers',
  admin: 'Admins',
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function DashboardPage() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const d = await dashboardApi.admin()
        if (!cancelled) setData(d)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load admin dashboard',
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
        Loading platform overview…
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'No admin data'}</span>
        </div>
      </Card>
    )
  }

  const storagePercent = Math.min(
    100,
    (data.platform_health.storage_used_gb / Math.max(0.01, data.platform_health.storage_quota_gb)) *
      100,
  )

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
              icon={STAT_ICONS[stat.label] ?? Activity}
              trend={stat.trend ?? undefined}
            />
          </motion.div>
        ))}
      </motion.div>

      <div className="grid grid-cols-2 gap-6">
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>User Breakdown</CardTitle>
            </CardHeader>
            {data.user_breakdown.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">No users yet.</p>
            ) : (
              <div className="space-y-3">
                {data.user_breakdown.map((row) => (
                  <div
                    key={row.role}
                    className="flex items-center justify-between py-2 border-b border-[var(--border-default)] last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          ROLE_DOT_COLORS[row.role] ?? 'bg-primary'
                        }`}
                      />
                      <span className="text-sm text-[var(--text-secondary)]">
                        {ROLE_LABELS[row.role] ?? row.role}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            {data.recent_activity.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">
                No recent platform activity yet.
              </p>
            ) : (
              <div className="space-y-3">
                {data.recent_activity.map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)] mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-primary)]">{item.text}</p>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {relativeTime(item.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      </div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Platform Health</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <Server className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-primary)]">API Response Time</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                  {data.platform_health.api_response_ms}ms
                </span>
                <Badge variant="success" size="sm">
                  Healthy
                </Badge>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-primary)]">Storage Used</span>
              </div>
              <div className="flex items-center gap-3 w-48">
                <ProgressBar value={storagePercent} max={100} size="sm" color="primary" />
                <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap tabular-nums">
                  {data.platform_health.storage_used_gb.toFixed(2)} /{' '}
                  {data.platform_health.storage_quota_gb.toFixed(0)} GB
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-primary)]">Uptime</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                  {data.platform_health.uptime_pct.toFixed(1)}%
                </span>
                <Badge variant="success" size="sm">
                  Excellent
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
