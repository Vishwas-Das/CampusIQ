import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  FileText,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Select from '../../components/ui/Select'
import StatCard from '../../components/dashboard/StatCard'
import { ApiError, algorithmsApi, quizzesApi } from '../../api/client'
import type {
  HammingPairResponse,
  QuizSummary,
  SimilarityCheckResponse,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

function severityVariant(distance: number): 'danger' | 'warning' | 'default' {
  if (distance === 0) return 'danger'
  if (distance <= 2) return 'warning'
  return 'default'
}

export default function SimilarityCheckerPage() {
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [selectedQuizId, setSelectedQuizId] = useState<string>('')
  const [maxDistance, setMaxDistance] = useState<number>(2)
  const [result, setResult] = useState<SimilarityCheckResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await quizzesApi.list()
        if (cancelled) return
        setQuizzes(list)
        if (list.length > 0) setSelectedQuizId(list[0]!.id)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load quizzes',
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

  const quizOptions = useMemo(
    () => quizzes.map((q) => ({ value: q.id, label: `${q.subject_code ?? ''} — ${q.title}` })),
    [quizzes],
  )

  const distanceOptions = [
    { value: '0', label: 'Distance ≤ 0 (identical)' },
    { value: '1', label: 'Distance ≤ 1 (almost identical)' },
    { value: '2', label: 'Distance ≤ 2 (very similar)' },
    { value: '3', label: 'Distance ≤ 3 (similar)' },
  ]

  const runCheck = async () => {
    if (!selectedQuizId) return
    setRunning(true)
    setError(null)
    try {
      const data = await algorithmsApi.hammingForQuiz(selectedQuizId, maxDistance)
      setResult(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Similarity check failed',
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Similarity Checker</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Pairwise Hamming distance over quiz answer bit vectors (DMS Unit IV)
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

      <motion.div variants={fadeUp} className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <Select
            label="Select Quiz"
            options={[{ value: '', label: 'Pick a quiz…' }, ...quizOptions]}
            value={selectedQuizId}
            onChange={(e) => setSelectedQuizId(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="w-64">
          <Select
            label="Threshold"
            options={distanceOptions}
            value={String(maxDistance)}
            onChange={(e) => setMaxDistance(Number(e.target.value))}
          />
        </div>
        <Button
          icon={running ? undefined : Sparkles}
          onClick={() => void runCheck()}
          disabled={!selectedQuizId || running}
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Running…
            </>
          ) : (
            'Run Similarity Check'
          )}
        </Button>
      </motion.div>

      {result && (
        <>
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            <StatCard
              label="TOTAL ATTEMPTS"
              value={String(result.total_attempts)}
              icon={FileText}
            />
            <StatCard
              label="FLAGGED PAIRS"
              value={String(result.flagged_count)}
              icon={ShieldAlert}
            />
            <StatCard
              label="MEAN SIMILARITY"
              value={`${result.mean_pairwise_similarity.toFixed(0)}%`}
            />
          </motion.div>

          <motion.div variants={fadeUp}>
            <Card padding={false}>
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <CardTitle>Flagged Pairs</CardTitle>
                {result.persisted_count > 0 && (
                  <Badge variant="info" size="sm">
                    {result.persisted_count} new flag{result.persisted_count === 1 ? '' : 's'} saved
                  </Badge>
                )}
              </div>
              {result.flagged_pairs.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
                  No suspicious pairs at this threshold. Either the cohort is honest or the
                  threshold is too tight.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-default)]">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                          Student A
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                          Student B
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                          Hamming Δ
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                          Similarity
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                          Length
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.flagged_pairs.map((pair: HammingPairResponse, i) => (
                        <tr
                          key={i}
                          className="border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--bg-secondary)]"
                        >
                          <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                            {pair.student_a_name}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                            {pair.student_b_name}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <Badge variant={severityVariant(pair.hamming_distance)} size="sm">
                              {pair.hamming_distance}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-danger tabular-nums">
                            {pair.similarity_percent.toFixed(0)}%
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-tertiary)] tabular-nums">
                            {pair.answer_length} Q
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>
        </>
      )}

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[var(--text-secondary)]" />
              <CardTitle>How it works</CardTitle>
            </div>
          </CardHeader>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            Each quiz attempt is encoded as a binary vector (1 = correct, 0 = wrong) on submit.
            We compute pairwise Hamming distance — the number of positions at which two students'
            answer vectors differ. Pairs whose distance is below the threshold are flagged for
            review. <strong>Hamming distance 0</strong> means the two students got every answer
            identically right or wrong, which on a non-trivial quiz is statistically improbable.
          </p>
        </Card>
      </motion.div>
    </motion.div>
  )
}
