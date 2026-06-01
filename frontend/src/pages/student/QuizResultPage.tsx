import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import Card, { CardHeader, CardTitle } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ProgressBar from '../../components/ui/ProgressBar'
import type { QuizAttemptResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-danger'
}

function scoreBarColor(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}

export default function QuizResultPage() {
  const { quizId, attemptId } = useParams<{ quizId: string; attemptId: string }>()
  const navigate = useNavigate()
  const [result, setResult] = useState<QuizAttemptResponse | null>(null)

  useEffect(() => {
    if (!attemptId) return
    const cached = sessionStorage.getItem(`quiz-result-${attemptId}`)
    if (cached) {
      try {
        setResult(JSON.parse(cached) as QuizAttemptResponse)
      } catch {
        // ignore
      }
    }
  }, [attemptId])

  const groupedByTopic = useMemo(() => {
    if (!result) return new Map<string, { correct: number; total: number }>()
    const map = new Map<string, { correct: number; total: number }>()
    for (const g of result.graded_answers) {
      const topic = g.topic || 'General'
      const cur = map.get(topic) ?? { correct: 0, total: 0 }
      cur.total += 1
      if (g.is_correct) cur.correct += 1
      map.set(topic, cur)
    }
    return map
  }, [result])

  if (!result) {
    return (
      <Card className="space-y-3">
        <p className="text-sm text-[var(--text-tertiary)]">
          We couldn't find this attempt's result. It may have expired — try retaking the quiz.
        </p>
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/student/quizzes')}>
          Back to quizzes
        </Button>
      </Card>
    )
  }

  return (
    <motion.div
      className="space-y-4 max-w-3xl mx-auto"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Score hero card */}
      <motion.div variants={fadeUp}>
        <Card className="space-y-4 text-center">
          <h1 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            Your Score
          </h1>
          <div className="space-y-2">
            <div className={`text-5xl font-bold ${scoreColor(result.score)}`}>
              {result.score.toFixed(0)}%
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {result.correct_count} of {result.total_questions} correct
              {result.time_taken_seconds != null && (
                <>
                  {' · '}
                  {Math.floor(result.time_taken_seconds / 60)}m{' '}
                  {result.time_taken_seconds % 60}s
                </>
              )}
            </p>
          </div>
          <ProgressBar
            value={result.score}
            max={100}
            showValue={false}
            color={scoreBarColor(result.score)}
          />
          {result.next_difficulty_recommendation && (
            <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)]">
              <Sparkles className="h-3.5 w-3.5 text-info" />
              Next recommended difficulty:{' '}
              <Badge size="sm" variant="info">
                {result.next_difficulty_recommendation}
              </Badge>
              <span className="text-[var(--text-tertiary)]">(greedy adaptive selection)</span>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Per-topic breakdown */}
      {groupedByTopic.size > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Topic Breakdown</CardTitle>
            </CardHeader>
            <ul className="space-y-3">
              {Array.from(groupedByTopic.entries()).map(([topic, { correct, total }]) => {
                const pct = (correct / total) * 100
                const weak = pct < 60
                return (
                  <li key={topic} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-primary)] flex items-center gap-2">
                        {weak ? (
                          <TrendingDown className="h-3.5 w-3.5 text-danger" />
                        ) : (
                          <TrendingUp className="h-3.5 w-3.5 text-success" />
                        )}
                        {topic}
                      </span>
                      <span className={`tabular-nums ${weak ? 'text-danger' : 'text-success'}`}>
                        {correct}/{total} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <ProgressBar
                      value={pct}
                      max={100}
                      size="sm"
                      color={pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'danger'}
                    />
                  </li>
                )
              })}
            </ul>
          </Card>
        </motion.div>
      )}

      {/* Question-by-question review */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Question Review</CardTitle>
          </CardHeader>
          <ul className="space-y-4">
            {result.graded_answers.map((g, i) => (
              <li key={g.question_id} className="space-y-2">
                <div className="flex items-start gap-2">
                  {g.is_correct ? (
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {i + 1}. {g.question_text}
                    </p>
                    {g.topic && (
                      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                        {g.topic}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-6 space-y-1 text-xs">
                  <div>
                    <span className="text-[var(--text-tertiary)]">Your answer: </span>
                    <span className={g.is_correct ? 'text-success' : 'text-danger'}>
                      {g.student_answer || <em>(blank)</em>}
                    </span>
                  </div>
                  {!g.is_correct && (
                    <div>
                      <span className="text-[var(--text-tertiary)]">Correct answer: </span>
                      <span className="text-success">{g.correct_answer}</span>
                    </div>
                  )}
                  {g.explanation && (
                    <p className="text-[var(--text-tertiary)] italic mt-1">
                      {g.explanation}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </motion.div>

      {result.weak_topics.length > 0 && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>Weak Areas From This Attempt</CardTitle>
            </CardHeader>
            <ul className="space-y-1 text-sm">
              {result.weak_topics.map((t) => (
                <li key={t} className="flex items-center gap-2 text-danger">
                  <TrendingDown className="h-3.5 w-3.5" />
                  {t}
                </li>
              ))}
            </ul>
          </Card>
        </motion.div>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/student/quizzes')}>
          Back to quizzes
        </Button>
        <Button onClick={() => navigate(`/student/quizzes/${quizId}/take`)}>
          Retake quiz
        </Button>
      </div>
    </motion.div>
  )
}
