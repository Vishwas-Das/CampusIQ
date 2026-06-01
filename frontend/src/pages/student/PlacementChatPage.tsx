import { useEffect, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Info, Loader2, Plus } from 'lucide-react'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import ChatLayout, { type ChatLayoutMessage } from '../../components/chat/ChatLayout'
import { ApiError, authApi, chatApi } from '../../api/client'
import type { ChatMessage, ChatSession, SourceCitation, User } from '../../types'

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const suggestedQuestions = [
  "What's the typical Google interview process?",
  'CGPA cutoff for Amazon?',
  'How to prepare for TCS NQT in 2 weeks?',
  'Best elective for product roles?',
]

function citationLabel(c: SourceCitation): string {
  return `${c.subject_code} · ${c.document_title}`
}

function backendMessageToLayout(m: ChatMessage): ChatLayoutMessage {
  return {
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    sources: m.source_citations?.map(citationLabel),
  }
}

export default function PlacementChatPage() {
  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatLayoutMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const [existingSessions, me] = await Promise.all([
          chatApi.listSessions('placement_chatbot'),
          authApi.me().catch(() => null),
        ])
        if (cancelled) return
        if (me) setProfile(me)

        let s: ChatSession
        if (existingSessions.length > 0) {
          s = existingSessions[0]!
        } else {
          s = await chatApi.createSession({ chat_type: 'placement_chatbot' })
        }
        if (cancelled) return
        setSession(s)

        const full = await chatApi.getSession(s.id)
        if (cancelled) return
        setMessages(full.messages.map(backendMessageToLayout))
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load Placement Chatbot session',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  const handleSend = async (text: string) => {
    if (!session || streaming) return
    setError(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', isStreaming: true },
    ])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      await chatApi.streamMessage({
        sessionId: session.id,
        content: text,
        signal: controller.signal,
        onChunk: (delta) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { ...last, content: last.content + delta }
            }
            return next
          })
        },
      })
      // Refresh to pull the persisted citations
      const refreshed = await chatApi.getSession(session.id)
      setMessages(refreshed.messages.map(backendMessageToLayout))
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to reach Placement Coach',
      )
      setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.isStreaming)))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleNewChat = async () => {
    setMessages([])
    setError(null)
    try {
      const s = await chatApi.createSession({ chat_type: 'placement_chatbot' })
      setSession(s)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not start a new chat',
      )
    }
  }

  const rightPanel = (
    <motion.div
      variants={fadeUp}
      initial="initial"
      animate="animate"
      className="space-y-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>Your Profile</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <div>
            <CardLabel>Name</CardLabel>
            <p className="text-sm text-[var(--text-primary)]">
              {profile?.full_name ?? '—'}
            </p>
          </div>
          {profile?.student_profile?.branch && (
            <div>
              <CardLabel>Branch</CardLabel>
              <p className="text-sm text-[var(--text-primary)]">
                {profile.student_profile.branch}
              </p>
            </div>
          )}
          {profile?.student_profile?.semester != null && (
            <div>
              <CardLabel>Semester</CardLabel>
              <p className="text-sm text-[var(--text-primary)]">
                {profile.student_profile.semester}
              </p>
            </div>
          )}
          {profile?.student_profile?.cgpa != null && (
            <div>
              <CardLabel>CGPA</CardLabel>
              <p className="text-sm text-[var(--text-primary)]">
                {profile.student_profile.cgpa}
              </p>
            </div>
          )}
          {profile?.student_profile?.target_companies &&
            profile.student_profile.target_companies.length > 0 && (
              <div>
                <CardLabel>Target</CardLabel>
                <p className="text-sm text-[var(--text-primary)]">
                  {profile.student_profile.target_companies.join(', ')}
                </p>
              </div>
            )}
          {profile?.student_profile?.skills && profile.student_profile.skills.length > 0 && (
            <div>
              <CardLabel>Skills</CardLabel>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {profile.student_profile.skills.slice(0, 8).map((s: string) => (
                  <Badge key={s} variant="primary" size="sm">
                    {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
      <Button variant="secondary" size="sm" icon={Plus} onClick={() => void handleNewChat()}>
        New chat
      </Button>
    </motion.div>
  )

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <Card className="flex items-center gap-3 py-3 shrink-0">
        <Info className="h-4 w-4 text-info shrink-0" />
        <span className="text-sm text-[var(--text-secondary)]">
          Placement Chatbot pulls from your college's placement records (interview experiences,
          CGPA cutoffs, offer data)
        </span>
      </Card>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger shrink-0">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && messages.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </Card>
      ) : (
        <div className="flex-1 min-h-0">
          <ChatLayout
            messages={messages}
            onSend={handleSend}
            placeholder="Ask about placements, companies, preparation…"
            rightPanel={rightPanel}
            suggestedQuestions={messages.length === 0 ? suggestedQuestions : undefined}
            disabled={!session || streaming || loading}
          />
        </div>
      )}
    </div>
  )
}
