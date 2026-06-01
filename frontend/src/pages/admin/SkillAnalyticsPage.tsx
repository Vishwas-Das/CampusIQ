import { useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Filter, Loader2, Sparkles, Users } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Badge from '../../components/ui/Badge'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, algorithmsApi } from '../../api/client'
import type { InclusionExclusionResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function SkillAnalyticsPage() {
  const [skill1, setSkill1] = useState('Python')
  const [skill2, setSkill2] = useState('React')
  const [skill3, setSkill3] = useState('SQL')
  const [skill4, setSkill4] = useState('')
  const [result, setResult] = useState<InclusionExclusionResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAnalysis = async () => {
    const skills = [skill1, skill2, skill3, skill4]
      .map((s) => s.trim())
      .filter(Boolean)
    if (skills.length === 0) {
      setError('Provide at least one skill to analyze')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const data = await algorithmsApi.inclusionExclusion({ skills })
      setResult(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Inclusion-exclusion analysis failed',
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Skill Analytics</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Inclusion-exclusion counting over student skill sets (DMS Unit I)
          </p>
        </div>
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

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--text-secondary)]" />
              <CardTitle>Skill Sets (up to 4)</CardTitle>
            </div>
          </CardHeader>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input
              label="Skill 1"
              placeholder="Python"
              value={skill1}
              onChange={(e) => setSkill1(e.target.value)}
            />
            <Input
              label="Skill 2"
              placeholder="React"
              value={skill2}
              onChange={(e) => setSkill2(e.target.value)}
            />
            <Input
              label="Skill 3"
              placeholder="SQL"
              value={skill3}
              onChange={(e) => setSkill3(e.target.value)}
            />
            <Input
              label="Skill 4 (optional)"
              placeholder="Docker"
              value={skill4}
              onChange={(e) => setSkill4(e.target.value)}
            />
          </div>
          <div className="flex justify-end mt-4">
            <Button
              icon={running ? undefined : Sparkles}
              onClick={() => void runAnalysis()}
              disabled={running}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Analyzing…
                </>
              ) : (
                'Run Analysis'
              )}
            </Button>
          </div>
        </Card>
      </motion.div>

      {result && (
        <>
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            <StatCard
              label="MATCHING STUDENTS"
              value={`${result.union_count_actual} / ${result.total_students}`}
              icon={Users}
            />
            <StatCard
              label="NAÏVE SUM Σ|Aᵢ|"
              value={String(result.union_count_naive)}
            />
            <StatCard
              label="OVERLAP CORRECTION"
              value={`-${result.overlap_correction}`}
            />
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Per-Skill Counts</CardTitle>
              </CardHeader>
              <div className="space-y-3">
                {result.per_skill.map((s) => (
                  <div key={s.skill} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="primary" size="sm">
                        {s.skill}
                      </Badge>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {s.count} student{s.count === 1 ? '' : 's'}
                      </span>
                    </div>
                    {s.sample_names.length > 0 && (
                      <span className="text-xs text-[var(--text-tertiary)] truncate max-w-md">
                        e.g. {s.sample_names.slice(0, 3).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {result.intersections.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Intersections</CardTitle>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Every k-way intersection (k ≥ 2)
                  </span>
                </CardHeader>
                <div className="space-y-2">
                  {result.intersections.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded bg-[var(--bg-secondary)]"
                    >
                      <div className="flex items-center gap-2">
                        {it.skills.map((s, idx) => (
                          <span key={`${s}-${idx}`} className="flex items-center gap-2">
                            <Badge size="sm">{s}</Badge>
                            {idx < it.skills.length - 1 && (
                              <span className="text-[var(--text-tertiary)]">∩</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                        {it.count}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}

          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Inclusion-Exclusion Formula</CardTitle>
              </CardHeader>
              <div className="font-mono text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-3 rounded">
                |A₁ ∪ A₂ ∪ … ∪ Aₙ| = Σ|Aᵢ| − Σ|Aᵢ ∩ Aⱼ| + Σ|Aᵢ ∩ Aⱼ ∩ Aₖ| − …
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-3">
                Naïve sum is{' '}
                <span className="font-semibold text-[var(--text-primary)]">
                  {result.union_count_naive}
                </span>{' '}
                (over-counts students with multiple skills). Applying inclusion-exclusion brings it
                down to{' '}
                <span className="font-semibold text-success">
                  {result.union_count_actual}
                </span>{' '}
                — a correction of{' '}
                <span className="font-semibold text-warning">
                  -{result.overlap_correction}
                </span>{' '}
                from the double-counted overlaps.
              </p>
            </Card>
          </motion.div>

          {result.matching_student_names.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Sample Matching Students</CardTitle>
                </CardHeader>
                <div className="flex flex-wrap gap-2">
                  {result.matching_student_names.map((name) => (
                    <Badge key={name} size="sm">
                      {name}
                    </Badge>
                  ))}
                </div>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </motion.div>
  )
}
