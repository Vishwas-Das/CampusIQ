import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import Select from '../../components/ui/Select'
import { ApiError, skillsApi } from '../../api/client'
import type {
  AdaptivePlanResponse,
  CompanyProfile,
  SkillPathResult,
} from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// Visible representation of the pipeline running server-side while the
// plan is being computed (mastery → rescale → Dijkstra → Knapsack).
// Cycles through the four steps so the user has something to read
// during a 2–5s wait. We don't actually know which step the server is
// on, so this is a cosmetic indicator, not real progress — keep the
// per-step timing slow enough that it feels intentional, not nervous.
const PLAN_STEPS: ReadonlyArray<{ label: string; detail: string }> = [
  {
    label: 'Reading your mastery',
    detail: 'Per-topic averages from your quiz history + declared skills',
  },
  {
    label: 'Rescaling skill graph edges',
    detail: 'adjusted = base × (1 − α·mastery(u)) × (1 + β·gap(v))',
  },
  {
    label: 'Dijkstra to every required skill',
    detail: 'Multi-target shortest paths with the dynamic weights',
  },
  {
    label: '0/1 Knapsack over your hours',
    detail: 'DP picks the topics that maximise predicted gain',
  },
]

function PlanComputeSkeleton() {
  const [activeStep, setActiveStep] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveStep((s) => (s + 1) % PLAN_STEPS.length)
    }, 850)
    return () => window.clearInterval(id)
  }, [])
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Computing your adaptive plan…
          </h3>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            Combining four DAA algorithms over your live mastery snapshot.
          </p>
        </div>
      </div>
      <ol className="space-y-3 pl-1">
        {PLAN_STEPS.map((step, i) => {
          const active = i === activeStep
          const passed = i < activeStep
          return (
            <li key={step.label} className="flex items-start gap-3">
              <div
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full transition-colors duration-300"
                style={{
                  background: active
                    ? 'var(--gradient-accent, #A78BFA)'
                    : passed
                      ? 'var(--text-tertiary)'
                      : 'var(--border-default)',
                  boxShadow: active
                    ? '0 0 12px var(--glow-color, rgba(167,139,250,0.4))'
                    : undefined,
                }}
              />
              <div className="min-w-0">
                <p
                  className="text-sm font-medium transition-colors duration-300"
                  style={{
                    color: active || passed
                      ? 'var(--text-primary)'
                      : 'var(--text-tertiary)',
                  }}
                >
                  {step.label}
                </p>
                <p className="text-xs font-mono text-[var(--text-tertiary)] mt-0.5">
                  {step.detail}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

export default function SkillGapPage() {
  const [companies, setCompanies] = useState<CompanyProfile[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(true)

  const [companyKey, setCompanyKey] = useState<string>('')
  const [hours, setHours] = useState<number>(15)

  const [plan, setPlan] = useState<AdaptivePlanResponse | null>(null)
  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load company list on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await skillsApi.companies()
        if (cancelled) return
        setCompanies(data)
        // Auto-select Google SWE if available
        const google = data.find((c) => c.company === 'Google')
        const first = google ?? data[0]
        if (first) setCompanyKey(`${first.company}__${first.role}`)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load company profiles',
          )
        }
      } finally {
        if (!cancelled) setLoadingCompanies(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Re-compute the plan whenever company or hours changes
  useEffect(() => {
    if (!companyKey) return
    const [company, role] = companyKey.split('__')
    let cancelled = false
    void (async () => {
      setComputing(true)
      setError(null)
      try {
        const result = await skillsApi.buildPlan({
          company,
          role,
          available_hours: hours,
        })
        if (cancelled) return
        setPlan(result)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Plan computation failed',
          )
        }
      } finally {
        if (!cancelled) setComputing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyKey, hours])

  const companyOptions = useMemo(
    () =>
      companies.map((c) => ({
        value: `${c.company}__${c.role}`,
        label: `${c.company} — ${c.role}`,
      })),
    [companies],
  )

  const readiness = plan ? 100 - plan.gap.gap_percent : 0
  const gap = plan?.gap
  const knapsack = plan?.knapsack

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            Adaptive Learning Engine
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Dijkstra shortest path + Knapsack 0/1 DP, rescaled by your quiz mastery
          </p>
        </div>
        {plan && (
          <Badge variant="info" size="lg">
            <Sparkles className="h-3.5 w-3.5 mr-1 inline" />
            Cosine sim {(plan.gap.cosine_similarity * 100).toFixed(0)}%
          </Badge>
        )}
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeUp} className="flex flex-wrap gap-4 items-end">
        <div className="w-72">
          <Select
            label="Target Company / Role"
            options={companyOptions}
            value={companyKey}
            onChange={(e) => setCompanyKey(e.target.value)}
            disabled={loadingCompanies}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
            Time budget
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={Minus}
            onClick={() => setHours((h) => Math.max(1, h - 1))}
          />
          <span className="stat-value text-2xl w-14 text-center">{hours}</span>
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setHours((h) => h + 1)} />
          <span className="text-sm text-[var(--text-tertiary)]">hours / week</span>
        </div>
        {computing && (
          <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Recomputing…
          </span>
        )}
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

      {/* First-time compute (no prior plan visible) — show the four-step
          skeleton so the 2-5s wait isn't a blank page. Subsequent
          recomputes keep the old plan visible with the small pill above. */}
      {computing && !plan && !error && (
        <motion.div variants={fadeUp}>
          <PlanComputeSkeleton />
        </motion.div>
      )}

      {plan && gap && (
        <>
          {/* Gap score card */}
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Gap Score — {plan.company.company} {plan.company.role}</CardTitle>
              </CardHeader>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <span className="stat-value text-4xl">{gap.gap_percent.toFixed(0)}%</span>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">Skills gap remaining</p>
                </div>
                <div className="flex-1 space-y-2">
                  <ProgressBar
                    value={readiness}
                    label="Readiness"
                    showValue
                    color={readiness >= 70 ? 'success' : readiness >= 40 ? 'warning' : 'danger'}
                    size="lg"
                  />
                  <p className="text-xs text-[var(--text-secondary)]">
                    You are {readiness.toFixed(0)}% ready for {plan.company.company}{' '}
                    {plan.company.role} — covering {gap.present_count} of {gap.required_count}{' '}
                    required skills.
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Skill Map */}
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Skill Map</CardTitle>
                <div className="flex gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span className="w-3 h-3 rounded border-2 border-success bg-success/10" />{' '}
                    Current
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span className="w-3 h-3 rounded border-2 border-primary bg-primary/10" />{' '}
                    Path (Dijkstra)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <span className="w-3 h-3 rounded border-2 border-danger border-dashed" />{' '}
                    Missing
                  </span>
                </div>
              </CardHeader>
              <div className="space-y-4">
                {/* Current skills */}
                {gap.student_has.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                      What you already have ({gap.student_has.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {gap.student_has.map((s) => (
                        <div
                          key={s}
                          className="rounded-lg border-2 border-success bg-success/5 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dijkstra paths — one line per target */}
                <div>
                  <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                    Shortest paths (Dijkstra, dynamically weighted by your mastery)
                  </p>
                  <div className="space-y-2">
                    {plan.paths.map((p: SkillPathResult) => (
                      <div
                        key={p.target}
                        className={`rounded-lg border p-3 text-sm ${
                          p.reachable
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-danger/30 bg-danger/5'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {p.nodes.length === 0 && (
                              <span className="text-[var(--text-tertiary)] italic">
                                {p.target} (unreachable)
                              </span>
                            )}
                            {p.nodes.map((node, i) => (
                              <span key={`${node}-${i}`} className="flex items-center gap-2">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {node}
                                </span>
                                {i < p.nodes.length - 1 && (
                                  <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)]" />
                                )}
                              </span>
                            ))}
                          </div>
                          <Badge
                            variant={p.reachable ? 'info' : 'danger'}
                            size="sm"
                          >
                            {p.total_hours.toFixed(1)}h
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Knapsack optimization result */}
          {knapsack && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    Optimized Study Plan — 0/1 Knapsack DP
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                    <Target className="h-3 w-3" />
                    Budget: {knapsack.budget_hours}h · Used: {knapsack.total_hours}h
                  </div>
                </CardHeader>
                {knapsack.items.length === 0 ? (
                  <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                    No learnable skills in range — either you've mastered everything or nothing is
                    reachable. Try adjusting your hours budget.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border-default)]">
                            <th className="text-left py-2 text-[var(--text-tertiary)] font-medium">
                              Topic
                            </th>
                            <th className="text-left py-2 text-[var(--text-tertiary)] font-medium">
                              Hours
                            </th>
                            <th className="text-left py-2 text-[var(--text-tertiary)] font-medium">
                              Value
                            </th>
                            <th className="text-left py-2 text-[var(--text-tertiary)] font-medium">
                              Why
                            </th>
                            <th className="text-left py-2 text-[var(--text-tertiary)] font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {knapsack.items.map((row, i) => (
                            <tr
                              key={`${row.topic}-${i}`}
                              className="border-b border-[var(--border-default)] last:border-0"
                            >
                              <td className="py-2.5 text-[var(--text-primary)] font-medium">
                                {row.topic}
                              </td>
                              <td className="py-2.5 text-[var(--text-secondary)] tabular-nums">
                                {row.hours.toFixed(1)}h
                              </td>
                              <td className="py-2.5 text-success font-medium tabular-nums">
                                +{row.value.toFixed(0)}
                              </td>
                              <td className="py-2.5 text-[var(--text-tertiary)] text-xs max-w-sm truncate">
                                {row.reason}
                              </td>
                              <td className="py-2.5">
                                <Badge variant={row.included ? 'success' : 'default'} size="sm">
                                  {row.included ? 'INCLUDED' : 'EXCLUDED'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[var(--border-default)] flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-success" />
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Predicted gain:{' '}
                        <span className="text-success">
                          +{knapsack.predicted_improvement_percent.toFixed(1)}%
                        </span>{' '}
                        in <span className="text-[var(--text-secondary)]">
                          {knapsack.total_hours}h
                        </span>
                        {' '}({knapsack.items.filter((i) => i.included).length}/
                        {knapsack.items.length} targets selected)
                      </p>
                    </div>
                  </>
                )}
              </Card>
            </motion.div>
          )}

          {/* MST — minimum learning tree */}
          {plan.mst.edges.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Minimum Learning Tree (Prim's MST)</CardTitle>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Total weight: {plan.mst.total_weight.toFixed(1)}h across {plan.mst.nodes.length}{' '}
                    skills
                  </span>
                </CardHeader>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {plan.mst.edges.map((edge, i) => (
                    <div
                      key={`${edge.from_skill}-${edge.to_skill}-${i}`}
                      className="flex items-center gap-2 text-sm p-2 rounded bg-[var(--bg-secondary)]"
                    >
                      <span className="font-medium text-[var(--text-primary)]">
                        {edge.from_skill}
                      </span>
                      <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)]" />
                      <span className="font-medium text-[var(--text-primary)]">
                        {edge.to_skill}
                      </span>
                      <span className="ml-auto text-xs text-[var(--text-tertiary)] tabular-nums">
                        {edge.weight.toFixed(1)}h
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Mastery debug panel (collapsible) */}
          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Your Mastery Snapshot</CardTitle>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Drives the dynamic edge weights
                </span>
              </CardHeader>
              {plan.mastery.per_skill.filter((m) => m.mastery > 0).length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)]">
                  No mastery signal yet. Take quizzes or add skills to your profile to unlock
                  personalized edge rescaling.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {plan.mastery.per_skill
                    .filter((m) => m.mastery > 0)
                    .slice(0, 20)
                    .map((m) => (
                      <Badge
                        key={m.skill}
                        size="sm"
                        variant={m.mastery >= 0.75 ? 'success' : m.mastery >= 0.5 ? 'info' : 'warning'}
                      >
                        {m.skill} · {(m.mastery * 100).toFixed(0)}%
                      </Badge>
                    ))}
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
