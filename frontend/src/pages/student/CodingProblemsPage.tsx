import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Loader2, Check, Circle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, codingApi } from '../../api/client'
import DifficultyBadge from '../../components/coding/DifficultyBadge'
import type {
  CodingDifficulty,
  CodingStatsResponse,
  ProblemListItem,
  UserProblemStatus,
} from '../../types'

const fadeUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

type DifficultyFilter = 'all' | CodingDifficulty
type StatusFilter = 'all' | UserProblemStatus


export default function CodingProblemsPage() {
  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [stats, setStats] = useState<CodingStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diffFilter, setDiffFilter] = useState<DifficultyFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const [probs, st] = await Promise.all([
          codingApi.listProblems(),
          codingApi.getStats(),
        ])
        if (cancelled) return
        setProblems(probs)
        setStats(st)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load coding problems.',
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

  const filtered = useMemo(() => {
    return problems.filter((p) => {
      if (diffFilter !== 'all' && p.difficulty !== diffFilter) return false
      if (statusFilter !== 'all' && p.user_status !== statusFilter) return false
      return true
    })
  }, [problems, diffFilter, statusFilter])

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] m-0">Coding</h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
          LeetCode-style practice. Code runs in your browser via Pyodide — no
          server round-trips, no setup. Solving a problem updates your skill
          tree and adds to your XP.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {stats && <StatsBanner stats={stats} />}

      <Filters
        diffFilter={diffFilter}
        statusFilter={statusFilter}
        onDiffChange={setDiffFilter}
        onStatusChange={setStatusFilter}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading problems…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-tertiary)] text-center">
          No problems match your current filters.
        </div>
      ) : (
        <ProblemList rows={filtered} />
      )}
    </div>
  )
}


function StatsBanner({ stats }: { stats: CodingStatsResponse }) {
  const solvedTotal = stats.solved_easy + stats.solved_medium + stats.solved_hard
  const items = [
    {
      label: 'Solved',
      value: `${solvedTotal} / ${stats.total_problems}`,
      sub: `${stats.total_submissions} attempts`,
    },
    {
      label: 'Easy',
      value: stats.solved_easy,
      sub: null,
      colour: 'text-success',
    },
    {
      label: 'Medium',
      value: stats.solved_medium,
      sub: null,
      colour: 'text-warning',
    },
    {
      label: 'Hard',
      value: stats.solved_hard,
      sub: null,
      colour: 'text-danger',
    },
    {
      label: 'Streak',
      value: stats.streak_days,
      sub: stats.streak_days === 1 ? 'day' : 'days',
    },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            {it.label}
          </div>
          <div className={clsx('text-xl font-bold mt-1', it.colour ?? 'text-[var(--text-primary)]')}>
            {it.value}
          </div>
          {it.sub && (
            <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">{it.sub}</div>
          )}
        </div>
      ))}
    </div>
  )
}


function Filters({
  diffFilter,
  statusFilter,
  onDiffChange,
  onStatusChange,
}: {
  diffFilter: DifficultyFilter
  statusFilter: StatusFilter
  onDiffChange: (v: DifficultyFilter) => void
  onStatusChange: (v: StatusFilter) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <FilterGroup label="Difficulty">
        <FilterChip active={diffFilter === 'all'} onClick={() => onDiffChange('all')}>
          All
        </FilterChip>
        <FilterChip active={diffFilter === 'easy'} onClick={() => onDiffChange('easy')}>
          Easy
        </FilterChip>
        <FilterChip active={diffFilter === 'medium'} onClick={() => onDiffChange('medium')}>
          Medium
        </FilterChip>
        <FilterChip active={diffFilter === 'hard'} onClick={() => onDiffChange('hard')}>
          Hard
        </FilterChip>
      </FilterGroup>

      <FilterGroup label="Status">
        <FilterChip active={statusFilter === 'all'} onClick={() => onStatusChange('all')}>
          All
        </FilterChip>
        <FilterChip
          active={statusFilter === 'solved'}
          onClick={() => onStatusChange('solved')}
        >
          Solved
        </FilterChip>
        <FilterChip
          active={statusFilter === 'attempted'}
          onClick={() => onStatusChange('attempted')}
        >
          Attempted
        </FilterChip>
        <FilterChip
          active={statusFilter === 'unsolved'}
          onClick={() => onStatusChange('unsolved')}
        >
          Unsolved
        </FilterChip>
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
        active
          ? 'bg-[var(--bg-elevated)] border-[var(--border-strong)] text-[var(--text-primary)]'
          : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
      )}
    >
      {children}
    </button>
  )
}


function ProblemList({ rows }: { rows: ProblemListItem[] }) {
  return (
    <motion.div
      className="space-y-2"
      initial="initial"
      animate="animate"
      variants={{ animate: { transition: { staggerChildren: 0.04 } } }}
    >
      {rows.map((row) => (
        <motion.div key={row.id} variants={fadeUp}>
          <Link
            to={`/student/coding/${row.slug}`}
            className="block rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] transition-colors p-4"
          >
            <div className="flex items-center gap-4">
              <StatusIcon status={row.user_status} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                  {row.title}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {row.topic_tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <DifficultyBadge difficulty={row.difficulty} size="sm" />
            </div>
          </Link>
        </motion.div>
      ))}
    </motion.div>
  )
}

function StatusIcon({ status }: { status: UserProblemStatus }) {
  if (status === 'solved') {
    return <Check className="h-4 w-4 text-success shrink-0" />
  }
  if (status === 'attempted') {
    return <Clock className="h-4 w-4 text-warning shrink-0" />
  }
  return <Circle className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
}
