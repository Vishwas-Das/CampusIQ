import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import ProgressBar from '../../components/ui/ProgressBar'
import Badge from '../../components/ui/Badge'
import { ApiError, gamificationApi } from '../../api/client'
import type { DomainProgressResponse, SkillTreeResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const DOMAIN_LABELS: Record<string, string> = {
  dsa: 'Data Structures & Algorithms',
  web: 'Web Development',
  systems: 'Systems & DevOps',
  db: 'Databases',
  cloud: 'Cloud',
  ml: 'Machine Learning',
  sysdesign: 'System Design',
  mobile: 'Mobile',
  fundamentals: 'CS Fundamentals',
  languages: 'Languages',
  soft: 'Soft Skills',
  misc: 'Misc',
}

export default function SkillTreePage() {
  const [tree, setTree] = useState<SkillTreeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await gamificationApi.mySkillTree()
        if (!cancelled) setTree(result)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load skill tree',
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
      <Card className="flex items-center gap-2 justify-center py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading skill tree…
      </Card>
    )
  }

  if (error || !tree) {
    return (
      <Card className="flex items-start gap-2 text-danger py-4">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="text-sm">{error ?? 'No skill tree data'}</span>
      </Card>
    )
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Overview */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Skill Tree</CardTitle>
            <span className="text-xs text-[var(--text-tertiary)]">
              Mastery ≥ 50% unlocks a skill. DFS-based prerequisite detection (DAA Unit II).
            </span>
          </CardHeader>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <span className="stat-value text-4xl">
                {tree.mastered_count}/{tree.total_count}
              </span>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Skills mastered</p>
            </div>
            <div className="flex-1">
              <ProgressBar
                value={tree.overall_percent}
                max={100}
                label="Overall progress"
                showValue
                color="primary"
                size="lg"
              />
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                {tree.overall_percent.toFixed(1)}% of the full skill graph mastered
              </p>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Domain grid */}
      <motion.div
        variants={stagger}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        {tree.domains.map((domain) => (
          <motion.div key={domain.name} variants={fadeUp}>
            <DomainCard domain={domain} />
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}

function DomainCard({ domain }: { domain: DomainProgressResponse }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-[var(--text-primary)]">
            {DOMAIN_LABELS[domain.name] ?? domain.name}
          </h3>
          <p className="text-xs text-[var(--text-tertiary)]">
            {domain.mastered_count}/{domain.total_skills} mastered ·{' '}
            {domain.unlocked_count} unlocked
          </p>
        </div>
        <Badge size="sm" variant={domain.progress_percent >= 80 ? 'success' : 'default'}>
          {domain.progress_percent.toFixed(0)}%
        </Badge>
      </div>

      <ProgressBar
        value={domain.progress_percent}
        max={100}
        size="sm"
        color={
          domain.progress_percent >= 80
            ? 'success'
            : domain.progress_percent >= 40
              ? 'warning'
              : 'primary'
        }
      />

      <div className="flex flex-wrap gap-1.5 pt-1">
        {domain.skills.map((skill) => {
          const isLocked = skill.state === 'locked'
          const isMastered = skill.state === 'mastered'
          const isUnlocked = skill.state === 'unlocked'
          return (
            <div
              key={skill.name}
              title={`${skill.name} — tier ${skill.difficulty_tier}, mastery ${(skill.mastery * 100).toFixed(0)}%`}
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium',
                isMastered &&
                  'border-success bg-success/10 text-success',
                isUnlocked &&
                  'border-primary/40 bg-primary/5 text-[var(--text-primary)]',
                isLocked &&
                  'border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-tertiary)] opacity-60',
              )}
            >
              {isMastered && <CheckCircle2 className="h-3 w-3" />}
              {isUnlocked && <Sparkles className="h-3 w-3" />}
              {isLocked && <Lock className="h-3 w-3" />}
              {skill.name}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
