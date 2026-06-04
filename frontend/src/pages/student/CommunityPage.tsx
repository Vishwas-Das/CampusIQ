import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  GraduationCap,
  Loader2,
  Lock,
  MessageCircle,
  Plus,
  Search,
  ThumbsUp,
  Trash2,
  Users,
} from 'lucide-react'
import { clsx } from 'clsx'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import TextArea from '../../components/ui/TextArea'
import Select from '../../components/ui/Select'
import { ApiError, communityApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import type {
  AccessibleTeacher,
  DoubtDetailResponse,
  DoubtResponse,
  DoubtVisibility,
} from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

type FeedFilter = 'all' | 'public' | 'private'

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function CommunityPage() {
  const user = useAuthStore((s) => s.user)
  const isStudent = user?.role === 'student'
  const isTeacher = user?.role === 'teacher'

  const [doubts, setDoubts] = useState<DoubtResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [activeTag, setActiveTag] = useState<string>('All')
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')

  // Ask modal (students only)
  const [askOpen, setAskOpen] = useState(false)
  const [askTitle, setAskTitle] = useState('')
  const [askBody, setAskBody] = useState('')
  const [askTags, setAskTags] = useState('')
  const [askVisibility, setAskVisibility] = useState<DoubtVisibility>('public')
  const [askTeacherId, setAskTeacherId] = useState<string>('')
  const [teachers, setTeachers] = useState<AccessibleTeacher[]>([])
  const [teachersLoading, setTeachersLoading] = useState(false)
  const [posting, setPosting] = useState(false)

  // Detail modal
  const [selected, setSelected] = useState<DoubtDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [answerText, setAnswerText] = useState('')
  const [answering, setAnswering] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const params =
        feedFilter !== 'all' ? { visibility: feedFilter as 'public' | 'private' } : undefined
      const data = await communityApi.list(params)
      setDoubts(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load doubts',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedFilter])

  // Load accessible teachers when student opens the Ask modal.
  useEffect(() => {
    if (!askOpen || !isStudent) return
    if (teachers.length > 0) return
    let cancelled = false
    setTeachersLoading(true)
    void (async () => {
      try {
        const data = await communityApi.accessibleTeachers()
        if (!cancelled) setTeachers(data)
      } catch {
        // Failure is non-fatal — student just can't pick a teacher then.
      } finally {
        if (!cancelled) setTeachersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [askOpen, isStudent, teachers.length])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    doubts.forEach((d) => d.tags.forEach((t) => set.add(t)))
    return ['All', ...Array.from(set).sort()]
  }, [doubts])

  const filtered = useMemo(() => {
    return doubts.filter((d) => {
      if (activeTag !== 'All' && !d.tags.includes(activeTag)) return false
      if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [doubts, activeTag, search])

  const handleAsk = async () => {
    if (!askTitle.trim() || !askBody.trim()) {
      setError('Title and body are required')
      return
    }
    if (askVisibility === 'private' && !askTeacherId) {
      setError('Pick a teacher to DM.')
      return
    }
    setPosting(true)
    setError(null)
    try {
      const tags = askTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await communityApi.create({
        title: askTitle.trim(),
        body: askBody.trim(),
        tags,
        visibility: askVisibility,
        assigned_teacher_id: askVisibility === 'private' ? askTeacherId : null,
      })
      setAskOpen(false)
      setAskTitle('')
      setAskBody('')
      setAskTags('')
      setAskVisibility('public')
      setAskTeacherId('')
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not post the doubt',
      )
    } finally {
      setPosting(false)
    }
  }

  const openDoubt = async (id: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const data = await communityApi.get(id)
      setSelected(data)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not open the doubt',
      )
    } finally {
      setDetailLoading(false)
    }
  }

  const handleAnswer = async () => {
    if (!selected || !answerText.trim()) return
    setAnswering(true)
    try {
      await communityApi.answer(selected.id, { answer_text: answerText.trim() })
      const refreshed = await communityApi.get(selected.id)
      setSelected(refreshed)
      setAnswerText('')
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not post answer',
      )
    } finally {
      setAnswering(false)
    }
  }

  const handleUpvoteAnswer = async (answerId: string) => {
    if (!selected) return
    try {
      await communityApi.upvoteAnswer(answerId)
      const refreshed = await communityApi.get(selected.id)
      setSelected(refreshed)
    } catch {
      // swallow
    }
  }

  const handleHideForMe = async (
    doubt: Pick<DoubtResponse, 'id' | 'visibility'>,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation()
    const message =
      doubt.visibility === 'private'
        ? 'Delete this DM from your view? The other person will still see it.'
        : 'Hide this post from your feed? Other students will still see it.'
    const ok = window.confirm(message)
    if (!ok) return
    try {
      await communityApi.hideForMe(doubt.id)
      if (selected?.id === doubt.id) {
        setSelected(null)
        setAnswerText('')
      }
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not hide this from your view',
      )
    }
  }

  const handleAcceptAnswer = async (answerId: string) => {
    if (!selected) return
    try {
      await communityApi.acceptAnswer(answerId)
      const refreshed = await communityApi.get(selected.id)
      setSelected(refreshed)
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not accept answer',
      )
    }
  }

  // Page heading
  const heading = isTeacher ? 'Direct Messages' : 'Doubt Community'
  const subheading = isTeacher
    ? "Private DMs from students you've taught. Reply directly here — only the student sees your answer."
    : 'Ask the whole class on the Discord-style feed, or DM a teacher privately.'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{heading}</h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">{subheading}</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Input
            icon={Search}
            placeholder={isTeacher ? 'Search DMs…' : 'Search doubts…'}
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </div>
        {isStudent && (
          <Button icon={Plus} onClick={() => setAskOpen(true)}>
            Ask a Doubt
          </Button>
        )}
        {allTags.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            {allTags.slice(0, 8).map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-all ${
                  activeTag === tag
                    ? 'bg-primary/10 text-[var(--text-primary)] border-primary/20'
                    : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feed filter (students only — teachers only see their DMs) */}
      {isStudent && (
        <div className="flex gap-2">
          {(
            [
              { key: 'all', label: 'Everything', icon: MessageCircle },
              { key: 'public', label: 'Class feed', icon: Users },
              { key: 'private', label: 'My DMs', icon: Lock },
            ] as { key: FeedFilter; label: string; icon: typeof Users }[]
          ).map(({ key, label, icon: Icon }) => {
            const active = feedFilter === key
            return (
              <button
                key={key}
                onClick={() => setFeedFilter(key)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border font-medium transition-all',
                  active
                    ? 'bg-primary/10 text-[var(--text-primary)] border-primary/30'
                    : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      )}

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </Card>
      )}

      {!loading && filtered.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
            {isTeacher
              ? 'No direct messages yet. Students whose subjects you teach will be able to DM you here.'
              : feedFilter === 'private'
                ? "You haven't DM'd a teacher yet. Click \"Ask a Doubt\" and choose \"DM a teacher\"."
                : 'No doubts yet. Click "Ask a Doubt" to post the first question. If no human answers within 10 minutes, the AI fallback will pitch in.'}
          </p>
        </Card>
      )}

      {!loading && filtered.length > 0 && (
        <motion.div className="space-y-3" variants={stagger} initial="initial" animate="animate">
          {filtered.map((doubt) => (
            <motion.div key={doubt.id} variants={fadeUp}>
              <Card hover className="space-y-3 cursor-pointer" onClick={() => void openDoubt(doubt.id)}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-semibold text-[var(--text-primary)] text-sm leading-snug">
                    {doubt.title}
                  </h3>
                  <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {doubt.visibility === 'private' && (
                      <Badge variant="warning" size="sm">
                        <Lock className="h-3 w-3" />
                        DM{doubt.assigned_teacher_name ? ` · ${doubt.assigned_teacher_name}` : ''}
                      </Badge>
                    )}
                    {doubt.has_ai_answer && (
                      <Badge variant="info" size="sm">
                        <Bot className="h-3 w-3" />
                        AI Answered
                      </Badge>
                    )}
                    {doubt.is_resolved && (
                      <Badge variant="success" size="sm">
                        <CheckCircle2 className="h-3 w-3" />
                        Resolved
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                  {doubt.body}
                </p>

                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5 flex-wrap">
                    {doubt.tags.map((tag) => (
                      <Badge key={tag} size="sm">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {doubt.answer_count} answers
                    </span>
                    {doubt.visibility !== 'private' && (
                      <span className="flex items-center gap-1">
                        <ThumbsUp className="h-3 w-3" />
                        {doubt.upvote_count} upvotes
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelative(doubt.created_at)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => void handleHideForMe(doubt, e)}
                      className="flex items-center gap-1 hover:text-danger transition-colors"
                      title={
                        doubt.visibility === 'private'
                          ? 'Delete from my view (the other person still sees it)'
                          : 'Hide from my feed (others still see it)'
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Ask modal */}
      <Modal isOpen={askOpen} onClose={() => setAskOpen(false)} title="Ask a Doubt" size="md">
        <div className="space-y-3">
          {/* Visibility selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-secondary)]">Send to</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAskVisibility('public')}
                className={clsx(
                  'flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors',
                  askVisibility === 'public'
                    ? 'border-primary bg-primary/5'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    Whole class
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  Public feed · anyone can answer · AI helps after 10 min
                </p>
              </button>
              <button
                type="button"
                onClick={() => setAskVisibility('private')}
                className={clsx(
                  'flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors',
                  askVisibility === 'private'
                    ? 'border-primary bg-primary/5'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    DM a teacher
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  Private · only the chosen teacher sees this · no AI fallback
                </p>
              </button>
            </div>
          </div>

          {askVisibility === 'private' && (
            <div className="space-y-1">
              {teachersLoading ? (
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading your teachers…
                </div>
              ) : teachers.length === 0 ? (
                <p className="text-xs text-warning flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  You can DM a teacher only after engaging with their subject (take a quiz they made or post a doubt under that subject first).
                </p>
              ) : (
                <Select
                  label="Pick a teacher"
                  value={askTeacherId}
                  onChange={(e) => setAskTeacherId(e.target.value)}
                  options={[
                    { value: '', label: '— select teacher —' },
                    ...teachers.map((t) => ({
                      value: t.id,
                      label: `${t.full_name}${t.department_name ? ` · ${t.department_name}` : ''} (${t.subject_codes.join(', ')})`,
                    })),
                  ]}
                />
              )}
            </div>
          )}

          <Input
            label="Title"
            placeholder="e.g. Why does Dijkstra fail with negative edge weights?"
            value={askTitle}
            onChange={(e) => setAskTitle(e.target.value)}
          />
          <TextArea
            label="Body"
            placeholder="Describe your doubt in detail. Include what you've tried."
            rows={6}
            value={askBody}
            onChange={(e) => setAskBody(e.target.value)}
          />
          <Input
            label="Tags (comma-separated)"
            placeholder="e.g. DAA, Graph Theory"
            value={askTags}
            onChange={(e) => setAskTags(e.target.value)}
          />

          {askVisibility === 'public' && (
            <p className="text-xs text-[var(--text-tertiary)]">
              <Bot className="h-3 w-3 inline mr-1" />
              If no peer answers within 10 minutes, our AI Doubt Assistant will auto-reply.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAskOpen(false)} disabled={posting}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAsk()}
              disabled={
                posting ||
                !askTitle.trim() ||
                !askBody.trim() ||
                (askVisibility === 'private' && !askTeacherId)
              }
            >
              {posting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Posting…
                </>
              ) : askVisibility === 'private' ? (
                'Send DM'
              ) : (
                'Post doubt'
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        isOpen={!!selected}
        onClose={() => {
          setSelected(null)
          setAnswerText('')
        }}
        title={selected?.title ?? 'Doubt'}
        size="xl"
      >
        {detailLoading || !selected ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            {/* Privacy banner for private doubts */}
            {selected.visibility === 'private' && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/10 border border-warning/30 text-xs text-[var(--text-secondary)]">
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                <span className="flex-1">
                  Private message between{' '}
                  <strong>{selected.student_name ?? 'student'}</strong>
                  {selected.assigned_teacher_name ? (
                    <>
                      {' '}
                      and <strong>{selected.assigned_teacher_name}</strong>
                    </>
                  ) : null}
                  . Only you two can see this thread.
                </span>
                <button
                  type="button"
                  onClick={() => void handleHideForMe(selected)}
                  className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-danger transition-colors shrink-0"
                  title="Delete this DM from your view"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete from my view
                </button>
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mb-2">
                <span>{selected.student_name ?? 'Unknown'}</span>
                <span>·</span>
                <span>{formatRelative(selected.created_at)}</span>
                {selected.is_resolved && (
                  <>
                    <span>·</span>
                    <Badge variant="success" size="sm">
                      Resolved
                    </Badge>
                  </>
                )}
              </div>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-line">
                {selected.body}
              </p>
              {selected.tags.length > 0 && (
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {selected.tags.map((tag) => (
                    <Badge key={tag} size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border-default)] pt-4">
              <p className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] mb-3">
                {selected.answers.length} Answer{selected.answers.length === 1 ? '' : 's'}
              </p>
              {selected.answers.length === 0 && (
                <p className="text-sm text-[var(--text-tertiary)] italic">
                  {selected.visibility === 'private'
                    ? 'No reply yet.'
                    : 'No answers yet. Be the first to help!'}
                </p>
              )}
              <div className="space-y-3">
                {selected.answers.map((ans) => (
                  <Card key={ans.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                      {ans.is_ai_generated ? (
                        <Badge variant="info" size="sm">
                          <Bot className="h-3 w-3 mr-0.5" />
                          AI Doubt Assistant
                        </Badge>
                      ) : (
                        <>
                          <span className="font-medium text-[var(--text-primary)]">
                            {ans.answered_by_name ?? 'Anonymous'}
                          </span>
                          {ans.answered_by_role === 'teacher' && (
                            <Badge variant="info" size="sm">
                              <GraduationCap className="h-3 w-3 mr-0.5" />
                              Teacher
                            </Badge>
                          )}
                        </>
                      )}
                      <span>·</span>
                      <span>{formatRelative(ans.created_at)}</span>
                      {ans.is_accepted && (
                        <Badge variant="success" size="sm">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          Accepted
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-line">
                      {ans.answer_text}
                    </p>
                    <div className="flex items-center gap-3">
                      {selected.visibility !== 'private' && (
                        <button
                          onClick={() => void handleUpvoteAnswer(ans.id)}
                          className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-primary transition-colors"
                        >
                          <ThumbsUp className="h-3 w-3" />
                          {ans.upvote_count}
                        </button>
                      )}
                      {!ans.is_accepted && selected.student_id === user?.id && (
                        <button
                          onClick={() => void handleAcceptAnswer(ans.id)}
                          className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-success transition-colors"
                        >
                          <Check className="h-3 w-3" />
                          Accept
                        </button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--border-default)] pt-4 space-y-2 sticky bottom-0 bg-[var(--bg-elevated)] py-2">
              <TextArea
                label="Your reply"
                placeholder={
                  selected.visibility === 'private'
                    ? isTeacher
                      ? "Write your reply to the student…"
                      : "Add a follow-up message…"
                    : 'Share what you know…'
                }
                rows={3}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => void handleAnswer()}
                  disabled={answering || !answerText.trim()}
                >
                  {answering ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Posting…
                    </>
                  ) : (
                    'Send'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
