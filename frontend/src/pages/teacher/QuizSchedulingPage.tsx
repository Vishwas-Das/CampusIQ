import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Calendar, Loader2, Network, Sparkles } from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, algorithmsApi } from '../../api/client'
import type { GraphColoringResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const COLOR_CLASSES = [
  'border-primary/50 bg-primary/5',
  'border-success/50 bg-success/5',
  'border-warning/50 bg-warning/5',
  'border-danger/50 bg-danger/5',
  'border-info/50 bg-info/5',
  'border-purple/50 bg-purple/5',
]

export default function QuizSchedulingPage() {
  const [result, setResult] = useState<GraphColoringResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runColoring = async () => {
    setRunning(true)
    setError(null)
    try {
      const data = await algorithmsApi.graphColoringForQuizzes()
      setResult(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Graph coloring failed',
      )
    } finally {
      setRunning(false)
    }
  }

  // Auto-run on mount
  useEffect(() => {
    void runColoring()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Quiz Scheduling</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Greedy graph coloring assigns conflict-free time slots (DMS Unit V)
          </p>
        </div>
        <Button
          icon={running ? undefined : Sparkles}
          onClick={() => void runColoring()}
          disabled={running}
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Coloring…
            </>
          ) : (
            'Re-run Coloring'
          )}
        </Button>
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

      {result && (
        <>
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            <StatCard
              label="QUIZZES"
              value={String(result.quiz_count)}
              icon={Calendar}
            />
            <StatCard
              label="CONFLICT EDGES"
              value={String(result.edge_count)}
              icon={Network}
            />
            <StatCard
              label="MIN TIME SLOTS"
              value={String(result.chromatic_number)}
            />
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card>
              <CardHeader>
                <CardTitle>Time Slot Assignment</CardTitle>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Each color = one parallel time slot. All quizzes in a color can be scheduled
                  simultaneously without student conflicts.
                </span>
              </CardHeader>
              {Object.keys(result.color_groups).length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                  No quizzes to schedule yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(result.color_groups)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([color, titles]) => (
                      <div
                        key={color}
                        className={`rounded-lg border-2 p-3 ${
                          COLOR_CLASSES[Number(color) % COLOR_CLASSES.length]
                        }`}
                      >
                        <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                          Slot {Number(color) + 1}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {titles.map((t) => (
                            <Badge key={t} size="sm">
                              {t}
                            </Badge>
                          ))}
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
                <CardTitle>Conflict Graph</CardTitle>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Two quizzes conflict iff at least one student has attempted both
                </span>
              </CardHeader>
              {result.assignments.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                  No quiz assignments yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {result.assignments.map((a) => (
                    <div
                      key={a.quiz_id}
                      className="flex items-start justify-between p-2 rounded border border-[var(--border-default)]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            {a.quiz_title}
                          </span>
                          {a.subject_code && <Badge size="sm">{a.subject_code}</Badge>}
                        </div>
                        {a.conflict_quiz_titles.length > 0 ? (
                          <p className="text-xs text-[var(--text-tertiary)] mt-1">
                            Conflicts with: {a.conflict_quiz_titles.join(', ')}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--text-tertiary)] mt-1 italic">
                            No conflicts
                          </p>
                        )}
                      </div>
                      <Badge
                        size="sm"
                        className={COLOR_CLASSES[a.color % COLOR_CLASSES.length]}
                      >
                        Slot {a.color + 1}
                      </Badge>
                    </div>
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
