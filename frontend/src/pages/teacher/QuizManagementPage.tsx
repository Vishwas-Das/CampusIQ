import { useEffect, useMemo, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  BarChart3,
  Clock,
  FileEdit,
  Loader2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Select from '../../components/ui/Select'
import Input from '../../components/ui/Input'
import { ApiError, documentsApi, quizzesApi, subjectsApi } from '../../api/client'
import { useNotificationStore } from '../../store/notificationStore'
import {
  useQuizGenerationStore,
  type PendingQuizGen,
} from '../../store/quizGenerationStore'
import type {
  Difficulty,
  DocumentWithSubject,
  QuizForTeacher,
  QuizSummary,
  Subject,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

type QuizTab = 'Pending Review' | 'Published' | 'Drafts'
const tabs: QuizTab[] = ['Pending Review', 'Published', 'Drafts']

const difficultyOptions = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function QuizManagementPage() {
  const [activeTab, setActiveTab] = useState<QuizTab>('Pending Review')
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Generate modal state
  const [generateOpen, setGenerateOpen] = useState(false)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [documents, setDocuments] = useState<DocumentWithSubject[]>([])
  const [genSubjectId, setGenSubjectId] = useState('')
  const [genDocumentId, setGenDocumentId] = useState('')
  const [genDifficulty, setGenDifficulty] = useState<Difficulty>('medium')
  const [genNumQuestions, setGenNumQuestions] = useState(5)
  const [genTopic, setGenTopic] = useState('')

  // Background jobs — each Generate click fires a request and pushes a
  // job into the global store. The modal closes immediately so the
  // teacher can navigate anywhere; the chip overlay (mounted in
  // AppLayout) renders the running jobs and survives route changes.
  const addPendingGen = useQuizGenerationStore((s) => s.add)
  const removePendingGen = useQuizGenerationStore((s) => s.remove)
  const pushToast = useNotificationStore((s) => s.push)

  // Review modal
  const [reviewQuiz, setReviewQuiz] = useState<QuizForTeacher | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await quizzesApi.list()
      setQuizzes(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load quizzes',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    void subjectsApi.list().then(setSubjects).catch(() => {})
    void documentsApi.list().then(setDocuments).catch(() => {})
  }, [])

  const subjectOptions = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    [subjects],
  )
  const documentOptions = useMemo(
    () => [
      { value: '', label: 'All documents in subject' },
      ...documents
        .filter((d) => !genSubjectId || d.subject_id === genSubjectId)
        .filter((d) => d.processing_status === 'ready')
        .map((d) => ({ value: d.id, label: d.title })),
    ],
    [documents, genSubjectId],
  )

  const pending = quizzes.filter((q) => !q.is_published && q.is_ai_generated)
  const published = quizzes.filter((q) => q.is_published)
  const drafts = quizzes.filter((q) => !q.is_published && !q.is_ai_generated)

  const submitGenerate = () => {
    if (!genSubjectId) {
      setError('Pick a subject to generate from')
      return
    }
    const subject = subjects.find((s) => s.id === genSubjectId)
    if (!subject) {
      setError('Subject not found')
      return
    }

    const job: PendingQuizGen = {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      subjectCode: subject.code,
      subjectName: subject.name,
      difficulty: genDifficulty,
      numQuestions: genNumQuestions,
      topic: genTopic.trim() || null,
    }

    const payload = {
      subject_id: genSubjectId,
      document_id: genDocumentId || null,
      difficulty: genDifficulty,
      num_questions: genNumQuestions,
      topic_hint: job.topic,
    }

    // Optimistic UI: shut the modal immediately, drop the chip in the
    // global store, free the teacher to do anything else while the AI
    // cooks.
    addPendingGen(job)
    setGenerateOpen(false)
    setGenTopic('')
    setError(null)

    void (async () => {
      try {
        await quizzesApi.generate(payload)
        await refresh()
        setActiveTab('Pending Review')
        pushToast({
          id: `quiz-gen-ok-${job.id}`,
          type: 'quiz_result',
          title: 'Quiz ready for review',
          content: `${job.subjectCode} · ${job.difficulty} · ${job.numQuestions} questions`,
        })
      } catch (err) {
        const detail =
          err instanceof ApiError && typeof err.detail === 'string'
            ? err.detail
            : 'Quiz generation failed. Try again or pick a different document.'
        pushToast({
          id: `quiz-gen-fail-${job.id}`,
          type: 'system',
          title: `Couldn't generate ${job.subjectCode} quiz`,
          content: detail,
        })
      } finally {
        removePendingGen(job.id)
      }
    })()
  }

  const openReview = async (id: string) => {
    setReviewLoading(true)
    setError(null)
    try {
      const quiz = await quizzesApi.getAsTeacher(id)
      setReviewQuiz(quiz)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load quiz',
      )
    } finally {
      setReviewLoading(false)
    }
  }

  const handlePublishToggle = async (id: string, current: boolean) => {
    try {
      await quizzesApi.publish(id, !current)
      await refresh()
      if (reviewQuiz?.id === id) {
        const refreshed = await quizzesApi.getAsTeacher(id)
        setReviewQuiz(refreshed)
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Publish failed',
      )
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this quiz? This cannot be undone.')) return
    try {
      await quizzesApi.delete(id)
      setQuizzes((prev) => prev.filter((q) => q.id !== id))
      if (reviewQuiz?.id === id) setReviewQuiz(null)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Delete failed',
      )
    }
  }

  const renderQuizRow = (quiz: QuizSummary) => (
    <Card hover key={quiz.id}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">{quiz.title}</h3>
            {quiz.is_ai_generated && (
              <Badge variant="info" size="sm">
                <Sparkles className="h-3 w-3 mr-0.5" />
                AI Generated
              </Badge>
            )}
            <Badge
              variant={
                quiz.difficulty === 'easy'
                  ? 'success'
                  : quiz.difficulty === 'hard'
                    ? 'danger'
                    : 'warning'
              }
              size="sm"
            >
              {quiz.difficulty}
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            {quiz.subject_code} — {quiz.subject_name}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
            <span>{quiz.question_count} questions</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelative(quiz.created_at)}
            </span>
            {quiz.attempt_count > 0 && (
              <>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {quiz.attempt_count} attempts
                </span>
                <span className="inline-flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  Avg {quiz.avg_score?.toFixed(0) ?? '—'}%
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" icon={FileEdit} onClick={() => void openReview(quiz.id)}>
            Review
          </Button>
          <Badge variant={quiz.is_published ? 'success' : 'default'} size="sm" dot>
            {quiz.is_published ? 'Published' : 'Draft'}
          </Badge>
          <button
            onClick={() => void handlePublishToggle(quiz.id, quiz.is_published)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title={quiz.is_published ? 'Unpublish' : 'Publish'}
          >
            {quiz.is_published ? (
              <ToggleRight className="h-5 w-5 text-success" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={() => void handleDelete(quiz.id)}
            className="text-[var(--text-tertiary)] hover:text-danger transition-colors"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Card>
  )

  const visible = activeTab === 'Pending Review' ? pending : activeTab === 'Published' ? published : drafts

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Quiz Management</h2>
          <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
            Generate, review, and publish AI quizzes for your students
          </p>
        </div>
        <Button icon={Sparkles} onClick={() => setGenerateOpen(true)}>
          Generate Quiz
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

      {/* Tabs */}
      <motion.div variants={fadeUp} className="flex gap-1 border-b border-[var(--border-default)]">
        {tabs.map((tab) => {
          const count =
            tab === 'Pending Review'
              ? pending.length
              : tab === 'Published'
                ? published.length
                : drafts.length
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab} {count > 0 && <span className="text-[var(--text-tertiary)]">({count})</span>}
              {activeTab === tab && (
                <motion.div
                  layoutId="quiz-tab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                />
              )}
            </button>
          )
        })}
      </motion.div>

      {loading && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading quizzes…
          </div>
        </Card>
      )}

      {!loading && visible.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
            {activeTab === 'Pending Review'
              ? 'No AI-generated quizzes waiting for review. Click "Generate Quiz" above to create one.'
              : activeTab === 'Published'
                ? 'No published quizzes yet. Review and publish a draft to make it available to students.'
                : 'No manual draft quizzes yet.'}
          </p>
        </Card>
      )}

      {!loading && visible.length > 0 && (
        <motion.div className="grid gap-4" variants={stagger} initial="initial" animate="animate">
          {visible.map((q) => (
            <motion.div key={q.id} variants={fadeUp}>
              {renderQuizRow(q)}
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Generate modal */}
      <Modal
        isOpen={generateOpen}
        onClose={() => setGenerateOpen(false)}
        title="Generate AI Quiz"
        size="md"
      >
        <div className="space-y-4">
          <Select
            label="Subject"
            options={[{ value: '', label: 'Select a subject…' }, ...subjectOptions]}
            value={genSubjectId}
            onChange={(e) => {
              setGenSubjectId(e.target.value)
              setGenDocumentId('')
            }}
          />
          <Select
            label="Document (optional — defaults to all subject docs)"
            options={documentOptions}
            value={genDocumentId}
            onChange={(e) => setGenDocumentId(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Difficulty"
              options={difficultyOptions}
              value={genDifficulty}
              onChange={(e) => setGenDifficulty(e.target.value as Difficulty)}
            />
            <Input
              label="Number of questions"
              type="number"
              min={3}
              max={20}
              value={genNumQuestions}
              onChange={(e) => setGenNumQuestions(parseInt(e.target.value || '5', 10))}
            />
          </div>
          <Input
            label="Topic focus (optional)"
            placeholder="e.g. Huffman trees, attendance rules…"
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
          />

          <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
            The AI keeps cooking in the background — close this and keep working;
            you'll get a toast the moment it lands in Pending Review.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitGenerate} disabled={!genSubjectId} icon={Sparkles}>
              Generate
            </Button>
          </div>
        </div>
      </Modal>

      {/* Review modal */}
      <Modal
        isOpen={!!reviewQuiz}
        onClose={() => setReviewQuiz(null)}
        title={reviewQuiz?.title ?? 'Quiz preview'}
        size="xl"
        footer={
          reviewQuiz && !reviewLoading ? (
            <div className="flex justify-between gap-2">
              <Button
                variant="secondary"
                onClick={() => void handleDelete(reviewQuiz.id)}
                icon={Trash2}
              >
                Delete
              </Button>
              <Button
                onClick={() => void handlePublishToggle(reviewQuiz.id, reviewQuiz.is_published)}
              >
                {reviewQuiz.is_published ? 'Unpublish' : 'Publish to students'}
              </Button>
            </div>
          ) : null
        }
      >
        {reviewLoading || !reviewQuiz ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
              <Badge variant="info" size="sm">{reviewQuiz.difficulty}</Badge>
              <span>{reviewQuiz.question_count} questions</span>
              <span>·</span>
              <span>{reviewQuiz.subject_code} — {reviewQuiz.subject_name}</span>
            </div>
            {reviewQuiz.questions.map((q, i) => (
              <Card key={q.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm text-[var(--text-primary)]">
                    {i + 1}. {q.question_text}
                  </p>
                  <Badge size="sm">{q.topic ?? '—'}</Badge>
                </div>
                <ul className="space-y-1 text-sm">
                  {q.options?.map((opt) => (
                    <li
                      key={opt}
                      className={`px-3 py-1.5 rounded border ${
                        opt === q.correct_answer
                          ? 'border-success/40 bg-success/5 text-success'
                          : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {opt === q.correct_answer && '✓ '}
                      {opt}
                    </li>
                  ))}
                </ul>
                {q.explanation && (
                  <p className="text-xs text-[var(--text-tertiary)] italic">
                    Explanation: {q.explanation}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </Modal>
    </motion.div>
  )
}
