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
  // Multi-select: a Set of document IDs the teacher wants to draw chunks from.
  // Empty Set = use ALL docs in the subject (backend default). Lets the teacher
  // pick any subset — e.g. 3 out of 8 unit PDFs — instead of "one or everything".
  const [genDocumentIds, setGenDocumentIds] = useState<Set<string>>(new Set())
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

  // Publish-with-timing modal — opens when the teacher publishes a quiz.
  // We store durations as TOTAL SECONDS for math, then split into h/m/s
  // inputs for display. Defaults: 24h window, 10min per attempt.
  const [publishingQuiz, setPublishingQuiz] = useState<QuizSummary | null>(null)
  const [publishWindowSeconds, setPublishWindowSeconds] = useState<number>(24 * 3600)
  const [publishAttemptSeconds, setPublishAttemptSeconds] = useState<number>(10 * 60)
  const [publishSaving, setPublishSaving] = useState(false)

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

    // Multi-doc: send the Set as an array. Empty array → backend uses all
    // docs in the subject (which is the same as null).
    const payload = {
      subject_id: genSubjectId,
      document_ids: genDocumentIds.size > 0 ? Array.from(genDocumentIds) : null,
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
    // Unpublishing is direct — no timing needed.
    if (current) {
      try {
        await quizzesApi.publish(id, false)
        await refresh()
        if (reviewQuiz?.id === id) {
          const refreshed = await quizzesApi.getAsTeacher(id)
          setReviewQuiz(refreshed)
        }
      } catch (err) {
        setError(
          err instanceof ApiError && typeof err.detail === 'string'
            ? err.detail
            : 'Unpublish failed',
        )
      }
      return
    }

    // Publishing → open the timing modal. The actual PATCH happens in
    // confirmPublish() once the teacher fills in the window + per-attempt time.
    const quiz = quizzes.find((q) => q.id === id) ?? null
    if (!quiz) return
    setPublishingQuiz(quiz)
    // Seed the inputs from the quiz's existing values when available.
    if (quiz.time_limit_seconds) {
      setPublishAttemptSeconds(quiz.time_limit_seconds)
    } else if (quiz.time_limit_minutes) {
      setPublishAttemptSeconds(quiz.time_limit_minutes * 60)
    }
  }

  const confirmPublish = async () => {
    if (!publishingQuiz) return
    if (publishWindowSeconds <= 0) {
      setError('Window duration must be more than 0 seconds')
      return
    }
    if (publishAttemptSeconds <= 0) {
      setError('Per-attempt time must be more than 0 seconds')
      return
    }
    setPublishSaving(true)
    setError(null)
    try {
      // Compute the open / close window. opens_at = NOW, closes_at = now +
      // window. toISOString() always emits UTC ("Z" suffix) so the backend
      // receives unambiguous timestamps regardless of the user's timezone.
      const now = new Date()
      const closes = new Date(now.getTime() + publishWindowSeconds * 1000)
      await quizzesApi.update(publishingQuiz.id, {
        is_published: true,
        opens_at: now.toISOString(),
        closes_at: closes.toISOString(),
        time_limit_seconds: publishAttemptSeconds,
      })
      await refresh()
      if (reviewQuiz?.id === publishingQuiz.id) {
        const refreshed = await quizzesApi.getAsTeacher(publishingQuiz.id)
        setReviewQuiz(refreshed)
      }
      setPublishingQuiz(null)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Publish failed',
      )
    } finally {
      setPublishSaving(false)
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
              // Clear chosen docs when switching subject — old IDs would
              // belong to a different subject's docs.
              setGenDocumentIds(new Set())
            }}
          />

          {/* Multi-select docs. Default state (empty) = all subject docs.
              Teachers can tick any subset — e.g. "Unit 1 + Unit 3 only". */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                Documents to draw from
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    const ready = documents
                      .filter((d) => !genSubjectId || d.subject_id === genSubjectId)
                      .filter((d) => d.processing_status === 'ready')
                      .map((d) => d.id)
                    setGenDocumentIds(new Set(ready))
                  }}
                  disabled={!genSubjectId}
                  className="text-[var(--text-tertiary)] hover:text-primary disabled:opacity-40"
                >
                  Select all
                </button>
                <span className="text-[var(--text-tertiary)]">·</span>
                <button
                  type="button"
                  onClick={() => setGenDocumentIds(new Set())}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--border-default)] divide-y divide-[var(--border-default)] bg-[var(--bg-tertiary)]/40">
              {(() => {
                const subjectDocs = documents
                  .filter((d) => !genSubjectId || d.subject_id === genSubjectId)
                  .filter((d) => d.processing_status === 'ready')
                if (subjectDocs.length === 0) {
                  return (
                    <p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
                      {genSubjectId
                        ? 'No ready documents in this subject yet.'
                        : 'Pick a subject first.'}
                    </p>
                  )
                }
                return subjectDocs.map((d) => {
                  const checked = genDocumentIds.has(d.id)
                  return (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--bg-tertiary)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setGenDocumentIds((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(d.id)
                            else next.delete(d.id)
                            return next
                          })
                        }}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-[var(--text-primary)] truncate flex-1">
                        {d.chapter || d.title || d.file_name}
                      </span>
                    </label>
                  )
                })
              })()}
            </div>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {genDocumentIds.size === 0
                ? 'None ticked → quiz will use ALL ready documents in this subject.'
                : `${genDocumentIds.size} document${genDocumentIds.size === 1 ? '' : 's'} selected.`}
            </p>
          </div>
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

      {/* Publish-quiz modal: window duration + per-attempt time limit.
          Both are h/m/s so a teacher can set anything from "30 second
          pop quiz, open for 5 min" up to "2 hour mock test, open all
          weekend". toISOString() on submit emits UTC for the backend. */}
      <Modal
        isOpen={publishingQuiz !== null}
        onClose={() => !publishSaving && setPublishingQuiz(null)}
        title="Publish quiz"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPublishingQuiz(null)}
              disabled={publishSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void confirmPublish()}
              disabled={
                publishSaving ||
                publishWindowSeconds <= 0 ||
                publishAttemptSeconds <= 0
              }
            >
              {publishSaving ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        }
      >
        {publishingQuiz && (
          <div className="space-y-5">
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="text-[var(--text-primary)] font-medium">
                {publishingQuiz.title}
              </span>
            </p>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                1. Quiz open for the class
              </label>
              <DurationPicker
                seconds={publishWindowSeconds}
                onChange={setPublishWindowSeconds}
              />
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1.5">
                The window during which students can click Start. Begins NOW
                and closes automatically after this duration.
                <br />
                <span className="text-[var(--text-secondary)]">
                  Example: 1 hour → students may start anytime in that hour.
                </span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
                2. Time each student gets once they start
              </label>
              <DurationPicker
                seconds={publishAttemptSeconds}
                onChange={setPublishAttemptSeconds}
              />
              <p className="text-[11px] text-[var(--text-tertiary)] mt-1.5">
                Countdown each student sees on screen. Auto-submits at zero.
                If the class window closes first, the timer caps at whatever
                time is left.
                <br />
                <span className="text-[var(--text-secondary)]">
                  Example: 10 min → every student has 10 minutes from when
                  they click Start.
                </span>
              </p>
              {publishAttemptSeconds <= 0 && (
                <p className="text-[11px] text-warning mt-1.5">
                  Set at least a few seconds — leaving this at 0 would give
                  students unlimited time.
                </p>
              )}
            </div>

            <div className="text-xs text-[var(--text-tertiary)] border-t border-[var(--border-default)] pt-3">
              Each student gets ONE attempt. After submit they can review
              answers but not retake.
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  )
}

/** Three small number inputs for hours / minutes / seconds. Stores total
 *  seconds in the parent; only the display is decomposed. Caps minutes and
 *  seconds at 59 each so the carry-over math stays predictable. */
function DurationPicker({
  seconds,
  onChange,
}: {
  seconds: number
  onChange: (totalSeconds: number) => void
}) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  const update = (nh: number, nm: number, ns: number) => {
    onChange(Math.max(0, nh * 3600 + nm * 60 + ns))
  }

  const cellClass =
    'w-16 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-center text-[var(--text-primary)] focus:outline-none focus:border-primary tabular-nums'

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <input
          type="number"
          min={0}
          max={99}
          value={h}
          onChange={(e) => update(Number(e.target.value) || 0, m, s)}
          className={cellClass}
        />
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider text-center">
          hr
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="number"
          min={0}
          max={59}
          value={m}
          onChange={(e) => update(h, Math.min(59, Number(e.target.value) || 0), s)}
          className={cellClass}
        />
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider text-center">
          min
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <input
          type="number"
          min={0}
          max={59}
          value={s}
          onChange={(e) => update(h, m, Math.min(59, Number(e.target.value) || 0))}
          className={cellClass}
        />
        <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider text-center">
          sec
        </span>
      </div>
    </div>
  )
}
