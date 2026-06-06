import { useEffect, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { AlertCircle, Info, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react'
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
  // ALL past Placement Chat sessions — preserves history when "New chat" fires.
  const [sessions, setSessions] = useState<ChatSession[]>([])
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

        let list = existingSessions
        if (list.length === 0) {
          const fresh = await chatApi.createSession({ chat_type: 'placement_chatbot' })
          list = [fresh]
        }
        if (cancelled) return
        setSessions(list)

        const active = list[0]!
        setSession(active)
        const full = await chatApi.getSession(active.id)
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

  const handleSelectSession = async (target: ChatSession) => {
    if (streaming || loading || target.id === session?.id) return
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(true)
    setMessages([])
    setError(null)
    try {
      const full = await chatApi.getSession(target.id)
      setSession(target)
      setMessages(full.messages.map(backendMessageToLayout))
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load that chat',
      )
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (target: ChatSession) => {
    if (streaming || loading) return
    if (!window.confirm('Delete this chat? Messages will be lost.')) return
    try {
      await chatApi.deleteSession(target.id)
      const remaining = sessions.filter((s) => s.id !== target.id)
      setSessions(remaining)
      if (session?.id === target.id) {
        if (remaining.length > 0) {
          await handleSelectSession(remaining[0]!)
        } else {
          const fresh = await chatApi.createSession({ chat_type: 'placement_chatbot' })
          setSessions([fresh])
          setSession(fresh)
          setMessages([])
        }
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not delete that chat',
      )
    }
  }

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
      // Refresh to pull the persisted citations + backend-auto-generated title.
      const refreshed = await chatApi.getSession(session.id)
      setMessages(refreshed.messages.map(backendMessageToLayout))
      const refreshedSession: ChatSession = {
        id: refreshed.id,
        user_id: refreshed.user_id,
        chat_type: refreshed.chat_type,
        subject_id: refreshed.subject_id,
        title: refreshed.title,
        created_at: refreshed.created_at,
        last_message_at: refreshed.last_message_at,
      }
      setSession(refreshedSession)
      setSessions((prev) =>
        prev.map((s) => (s.id === refreshed.id ? refreshedSession : s)),
      )
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
      // Prepend to the list so old chats remain accessible from the sidebar.
      setSessions((prev) => [s, ...prev])
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

      {/* Past chats — same pattern as Note Assistant / CollegeGPT.
          "New chat" creates a new session without losing the old ones. */}
      <div className="space-y-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          className="w-full justify-start"
          onClick={() => void handleNewChat()}
          disabled={streaming || loading}
        >
          New chat
        </Button>
        {sessions.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 px-2 pt-2">
              <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                Chats
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {sessions.length}
              </span>
            </div>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {sessions.map((s) => {
                const isActive = s.id === session?.id
                const label = s.title?.trim() || (isActive ? 'New chat' : 'Untitled chat')
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-primary/10 text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                    onClick={() => void handleSelectSession(s)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <MessageSquare
                        className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-[var(--text-tertiary)]'}`}
                      />
                      <span className="text-xs truncate" title={label}>
                        {label}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteSession(s)
                      }}
                      className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-danger transition-opacity"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
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
