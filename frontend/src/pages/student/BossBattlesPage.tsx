import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  Crown,
  Loader2,
  Sparkles,
  Swords,
  Timer,
  Trophy,
} from 'lucide-react'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { ApiError, bossBattlesApi } from '../../api/client'
import type {
  BossBattle,
  BossBattleDetail,
  BossBattleLeaderboardRow,
  BossBattleListResponse,
  BossBattleStatus,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const STATUS_BADGE: Record<BossBattleStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  upcoming: 'warning',
  past: 'default',
}

function formatTimer(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.max(0, secs % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatRelative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}

export default function BossBattlesPage() {
  const [list, setList] = useState<BossBattleListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeBattle, setActiveBattle] = useState<BossBattleDetail | null>(null)
  const [activeAnswers, setActiveAnswers] = useState<Record<string, string>>({})
  const [activeElapsed, setActiveElapsed] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<
    | {
        battleId: string
        battleTitle: string
        score: number
        correct: number
        total: number
        bonus: number
        rank: number | null
        leaderboard: BossBattleLeaderboardRow[]
      }
    | null
  >(null)

  const startedAtRef = useRef<number | null>(null)
  const tickerRef = useRef<number | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await bossBattlesApi.list()
      setList(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load boss battles',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Tick the in-battle countdown.
  useEffect(() => {
    if (!activeBattle) {
      if (tickerRef.current != null) window.clearInterval(tickerRef.current)
      tickerRef.current = null
      return undefined
    }
    if (startedAtRef.current == null) startedAtRef.current = Date.now()
    tickerRef.current = window.setInterval(() => {
      const started = startedAtRef.current ?? Date.now()
      setActiveElapsed(Math.floor((Date.now() - started) / 1000))
    }, 250)
    return () => {
      if (tickerRef.current != null) window.clearInterval(tickerRef.current)
      tickerRef.current = null
    }
  }, [activeBattle])

  const startBattle = useCallback(async (battle: BossBattle) => {
    setSubmitError(null)
    setLastResult(null)
    setActiveAnswers({})
    setActiveElapsed(0)
    startedAtRef.current = Date.now()
    try {
      const detail = await bossBattlesApi.get(battle.id)
      setActiveBattle(detail)
    } catch (err) {
      setSubmitError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not open boss battle',
      )
    }
  }, [])

  const cancelBattle = useCallback(() => {
    setActiveBattle(null)
    setActiveAnswers({})
    setActiveElapsed(0)
    startedAtRef.current = null
  }, [])

  const submitBattle = useCallback(async () => {
    if (!activeBattle) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const elapsed = activeElapsed
      const result = await bossBattlesApi.submit(activeBattle.id, {
        answers: activeAnswers,
        elapsed_seconds: elapsed,
      })
      // Refetch the battle detail so we can show the leaderboard reflecting
      // this fresh submission (best-effort — leaderboard panel is hidden if
      // the refetch fails).
      let leaderboard: BossBattleLeaderboardRow[] = []
      try {
        const detail = await bossBattlesApi.get(activeBattle.id)
        leaderboard = detail.leaderboard ?? []
      } catch {
        /* keep going — leaderboard is optional polish */
      }
      setLastResult({
        battleId: activeBattle.id,
        battleTitle: activeBattle.title,
        score: result.score,
        correct: result.correct_count,
        total: result.total_questions,
        bonus: result.speed_bonus,
        rank: result.entry.rank,
        leaderboard,
      })
      setActiveBattle(null)
      void reload()
    } catch (err) {
      setSubmitError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not submit boss battle',
      )
    } finally {
      setSubmitting(false)
    }
  }, [activeAnswers, activeBattle, activeElapsed, reload])

  const remaining = useMemo(() => {
    if (!activeBattle?.time_limit_seconds) return null
    return Math.max(0, activeBattle.time_limit_seconds - activeElapsed)
  }, [activeBattle, activeElapsed])

  // Auto-submit when the timer hits zero.
  useEffect(() => {
    if (activeBattle && remaining != null && remaining <= 0 && !submitting) {
      void submitBattle()
    }
  }, [activeBattle, remaining, submitBattle, submitting])

  if (loading && !list) {
    return (
      <Card className="flex items-center gap-2 justify-center py-12 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading boss battles…
      </Card>
    )
  }

  if (error || !list) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'No data'}</span>
        </div>
      </Card>
    )
  }

  if (activeBattle) {
    const timerColor =
      remaining != null && remaining <= 10
        ? 'text-danger'
        : remaining != null && remaining <= 30
          ? 'text-warning'
          : 'text-[var(--text-primary)]'
    return (
      <motion.div
        className="space-y-4"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.div variants={fadeUp}>
          <Card className="border-warning/30 bg-warning/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Swords className="h-5 w-5 text-warning" />
                  <h2 className="text-lg font-bold text-[var(--text-primary)]">
                    {activeBattle.title}
                  </h2>
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  {activeBattle.description}
                </p>
              </div>
              <div className="text-right">
                <span className={clsx('stat-value text-3xl tabular-nums', timerColor)}>
                  {remaining != null ? formatTimer(remaining) : formatTimer(activeElapsed)}
                </span>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {remaining != null ? 'Remaining' : 'Elapsed'}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        {submitError && (
          <motion.div
            variants={fadeUp}
            className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </motion.div>
        )}

        {activeBattle.questions.map((q, idx) => (
          <motion.div key={q.id} variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>
                  Q{idx + 1}. {q.question}
                </CardTitle>
              </CardHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {q.options.map((opt) => {
                  const selected = activeAnswers[q.id] === opt
                  return (
                    <button
                      key={opt}
                      onClick={() =>
                        setActiveAnswers((prev) => ({ ...prev, [q.id]: opt }))
                      }
                      className={clsx(
                        'text-left px-3 py-2 rounded-lg border text-sm transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-tertiary)]/40 text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            </Card>
          </motion.div>
        ))}

        <motion.div variants={fadeUp} className="flex gap-2">
          <Button onClick={() => void submitBattle()} disabled={submitting}>
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </span>
            ) : (
              'Submit Battle'
            )}
          </Button>
          <Button variant="ghost" onClick={cancelBattle} disabled={submitting}>
            Quit
          </Button>
        </motion.div>
      </motion.div>
    )
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Boss Battles</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Timed high-difficulty challenges. Score = % correct + speed bonus. Top performers
            climb the leaderboard.
          </p>
        </div>
      </motion.div>

      {lastResult && (
        <motion.div variants={fadeUp}>
          <Card className="border-success/30 bg-success/5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Trophy className="h-5 w-5 text-success" />
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {lastResult.battleTitle} — final {lastResult.score.toFixed(0)}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {lastResult.correct}/{lastResult.total} correct · speed bonus +
                    {lastResult.bonus.toFixed(0)}
                    {lastResult.rank ? ` · rank #${lastResult.rank}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLastResult(null)}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                aria-label="Dismiss result"
              >
                Dismiss
              </button>
            </div>
            {lastResult.leaderboard.length > 0 && (
              <div className="space-y-1.5">
                <CardLabel className="block uppercase">Top performers</CardLabel>
                <ol className="space-y-1">
                  {lastResult.leaderboard.slice(0, 5).map((row) => (
                    <li
                      key={`${row.student_id}-${row.rank}`}
                      className="flex items-center justify-between gap-3 text-sm py-1.5 px-2 rounded-md bg-[var(--bg-tertiary)]/40"
                    >
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-xs text-[var(--text-tertiary)] w-5 text-right">
                          {row.rank}
                        </span>
                        <span className="text-[var(--text-primary)]">{row.name}</span>
                      </span>
                      <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                        {row.score.toFixed(0)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {(['active', 'upcoming', 'past'] as const).map((bucket) => {
        const items = list[bucket]
        if (!items.length) return null
        return (
          <motion.div key={bucket} variants={fadeUp} className="space-y-3">
            <CardLabel className="block uppercase">{bucket}</CardLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((battle) => (
                <Card key={battle.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <Swords className="h-4 w-4 text-warning" />
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">
                          {battle.title}
                        </h3>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">{battle.description}</p>
                    </div>
                    <Badge variant={STATUS_BADGE[battle.status]} size="sm">
                      {battle.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1">
                      <Timer className="h-3 w-3" /> {battle.time_limit_seconds}s
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary" /> {battle.xp_reward} XP
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Crown className="h-3 w-3 text-warning" /> {battle.question_count} Qs
                    </span>
                    {battle.status === 'upcoming' && (
                      <span>· starts {formatRelative(battle.start_time)}</span>
                    )}
                    {battle.status === 'active' && (
                      <span>· ends {formatRelative(battle.end_time)}</span>
                    )}
                  </div>
                  {battle.my_entry && (
                    <p className="text-xs text-success">
                      Best score: {battle.my_entry.score.toFixed(0)}
                      {battle.my_entry.rank ? ` · rank #${battle.my_entry.rank}` : ''}
                    </p>
                  )}
                  <div className="mt-1">
                    {battle.status === 'active' ? (
                      <Button onClick={() => void startBattle(battle)} icon={Swords}>
                        {battle.my_entry ? 'Battle Again' : 'Enter Battle'}
                      </Button>
                    ) : battle.status === 'upcoming' ? (
                      <Button disabled variant="secondary">
                        Locked
                      </Button>
                    ) : (
                      <Button variant="ghost" onClick={() => void startBattle(battle)} icon={Trophy}>
                        View Leaderboard
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}
