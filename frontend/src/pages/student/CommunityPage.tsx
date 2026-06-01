import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  ThumbsUp,
} from 'lucide-react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/ui/Modal'
import TextArea from '../../components/ui/TextArea'
import { ApiError, communityApi } from '../../api/client'
import type { DoubtDetailResponse, DoubtResponse } from '../../types'

const stagger: Variants = { animate: { transition: { staggerChildren: 0 } } }
const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

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
  const [doubts, setDoubts] = useState<DoubtResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState<string>('')
  const [activeTag, setActiveTag] = useState<string>('All')

  // Ask modal
  const [askOpen, setAskOpen] = useState(false)
  const [askTitle, setAskTitle] = useState('')
  const [askBody, setAskBody] = useState('')
  const [askTags, setAskTags] = useState('')
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
      const data = await communityApi.list()
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
  }, [])

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
      })
      setAskOpen(false)
      setAskTitle('')
      setAskBody('')
      setAskTags('')
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

  return (
    <div className="space-y-5">
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
            placeholder="Search doubts..."
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </div>
        <Button icon={Plus} onClick={() => setAskOpen(true)}>
          Ask a Doubt
        </Button>
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

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-6 text-[var(--text-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </Card>
      )}

      {!loading && filtered.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--text-tertiary)] text-center py-6">
            No doubts yet. Click "Ask a Doubt" to post the first question. If no human answers
            within 10 minutes, the AI fallback will pitch in.
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
                  <div className="flex gap-1 shrink-0">
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
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      {doubt.upvote_count} upvotes
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelative(doubt.created_at)}
                    </span>
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
          <p className="text-xs text-[var(--text-tertiary)]">
            <Bot className="h-3 w-3 inline mr-1" />
            If no peer answers within 10 minutes, our AI Doubt Assistant will auto-reply.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAskOpen(false)} disabled={posting}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAsk()}
              disabled={posting || !askTitle.trim() || !askBody.trim()}
            >
              {posting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Posting…
                </>
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
                  No answers yet. Be the first to help!
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
                        <span className="font-medium text-[var(--text-primary)]">
                          {ans.answered_by_name ?? 'Anonymous'}
                        </span>
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
                      <button
                        onClick={() => void handleUpvoteAnswer(ans.id)}
                        className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] hover:text-primary transition-colors"
                      >
                        <ThumbsUp className="h-3 w-3" />
                        {ans.upvote_count}
                      </button>
                      {!ans.is_accepted && (
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
                label="Your answer"
                placeholder="Share what you know…"
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
                    'Post answer'
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
