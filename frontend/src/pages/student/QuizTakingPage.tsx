import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Send,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, quizzesApi } from '../../api/client'
import type { QuizForStudent } from '../../types'

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

function formatSeconds(s: number): string {
  const mins = Math.floor(s / 60)
  const sec = s % 60
  return `${mins}:${sec.toString().padStart(2, '0')}`
}

export default function QuizTakingPage() {
  const { quizId } = useParams<{ quizId: string }>()
  const navigate = useNavigate()
  const [quiz, setQuiz] = useState<QuizForStudent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!quizId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const data = await quizzesApi.getAsStudent(quizId)
        if (!cancelled) {
          setQuiz(data)
          startedAtRef.current = Date.now()
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load quiz',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quizId])

  useEffect(() => {
    if (!startedAtRef.current) return
    const id = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [quiz])

  const sortedQuestions = useMemo(() => {
    if (!quiz) return []
    return [...quiz.questions].sort((a, b) => a.order_index - b.order_index)
  }, [quiz])

  const currentQuestion = sortedQuestions[currentIdx]
  const answeredCount = Object.values(answers).filter((v) => v && v.length > 0).length

  const handleSelect = (option: string) => {
    if (!currentQuestion) return
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option }))
  }

  const handleSubmit = async () => {
    if (!quiz) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        answers: sortedQuestions.map((q) => ({
          question_id: q.id,
          student_answer: answers[q.id] ?? '',
        })),
        time_taken_seconds: startedAtRef.current
          ? Math.floor((Date.now() - startedAtRef.current) / 1000)
          : null,
      }
      const result = await quizzesApi.submitAttempt(quiz.id, payload)
      // Stash the result in sessionStorage so the result page can render it without
      // a second network call.
      sessionStorage.setItem(`quiz-result-${result.id}`, JSON.stringify(result))
      navigate(`/student/quizzes/${quiz.id}/result/${result.id}`)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Submit failed',
      )
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-2 justify-center py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading quiz…
      </Card>
    )
  }

  if (error || !quiz) {
    return (
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-danger">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error ?? 'Quiz not found'}</span>
        </div>
        <Button variant="secondary" onClick={() => navigate('/student/quizzes')} icon={ArrowLeft}>
          Back to quizzes
        </Button>
      </Card>
    )
  }

  if (!currentQuestion) {
    return (
      <Card>
        <p className="text-sm text-[var(--text-tertiary)]">This quiz has no questions yet.</p>
      </Card>
    )
  }

  const progress = ((currentIdx + 1) / sortedQuestions.length) * 100

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{quiz.title}</h1>
            <p className="text-xs text-[var(--text-tertiary)]">
              {quiz.subject_code} — {quiz.subject_name}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 text-[var(--text-tertiary)]">
              <Clock className="h-3.5 w-3.5" />
              {formatSeconds(elapsed)}
            </span>
            <Badge size="sm">{quiz.difficulty}</Badge>
          </div>
        </div>
        <ProgressBar value={progress} max={100} size="sm" color="primary" />
        <div className="flex justify-between text-xs text-[var(--text-tertiary)]">
          <span>
            Question {currentIdx + 1} of {sortedQuestions.length}
          </span>
          <span>
            {answeredCount} / {sortedQuestions.length} answered
          </span>
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <motion.div key={currentQuestion.id} variants={fadeUp} initial="initial" animate="animate">
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-base font-medium text-[var(--text-primary)] leading-relaxed">
              {currentQuestion.question_text}
            </p>
            <Badge size="sm" variant={
              currentQuestion.difficulty === 'easy'
                ? 'success'
                : currentQuestion.difficulty === 'hard'
                  ? 'danger'
                  : 'warning'
            }>
              {currentQuestion.difficulty}
            </Badge>
          </div>

          <ul className="space-y-2">
            {currentQuestion.options?.map((opt) => {
              const selected = answers[currentQuestion.id] === opt
              return (
                <li key={opt}>
                  <button
                    onClick={() => handleSelect(opt)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3 ${
                      selected
                        ? 'border-primary bg-primary/5 text-[var(--text-primary)]'
                        : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        selected ? 'border-primary' : 'border-[var(--border-strong)]'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </motion.div>

      <div className="flex justify-between items-center">
        <Button
          variant="secondary"
          icon={ArrowLeft}
          disabled={currentIdx === 0}
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
        >
          Previous
        </Button>

        {currentIdx === sortedQuestions.length - 1 ? (
          <Button
            icon={submitting ? undefined : Send}
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                Submit ({answeredCount}/{sortedQuestions.length})
              </>
            )}
          </Button>
        ) : (
          <Button
            icon={ArrowRight}
            onClick={() => setCurrentIdx((i) => Math.min(sortedQuestions.length - 1, i + 1))}
          >
            Next
          </Button>
        )}
      </div>

      {/* Question dots navigator */}
      <div className="flex flex-wrap gap-2 justify-center">
        {sortedQuestions.map((q, i) => {
          const isAnswered = !!answers[q.id]
          const isCurrent = i === currentIdx
          return (
            <button
              key={q.id}
              onClick={() => setCurrentIdx(i)}
              className={`h-7 w-7 rounded text-xs font-medium border transition-all ${
                isCurrent
                  ? 'border-primary bg-primary text-[var(--bg-elevated)]'
                  : isAnswered
                    ? 'border-success/50 bg-success/10 text-success'
                    : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)]'
              }`}
              title={`Question ${i + 1}${isAnswered ? ' (answered)' : ''}`}
            >
              {isAnswered && !isCurrent ? <CheckCircle2 className="h-3.5 w-3.5 mx-auto" /> : i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}
