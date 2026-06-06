import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2, MessageSquare, Plus, Trash2 } from 'lucide-react'
import ChatLayout, { type ChatLayoutMessage } from '../../components/chat/ChatLayout'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { ApiError, chatApi } from '../../api/client'
import type { ChatMessage, ChatSession, SourceCitation } from '../../types'

const suggestedQuestions = [
  'What is the attendance rule for labs?',
  'Hostel rules for first years?',
  "What's the average package at major recruiters?",
  'Which elective is best for product roles?',
]

function citationLabel(c: SourceCitation): string {
  return `${c.subject_code} · ${c.document_title} · chunk ${c.chunk_index + 1}`
}

function backendMessageToLayout(m: ChatMessage): ChatLayoutMessage {
  return {
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
    sources: m.source_citations?.map(citationLabel),
  }
}

export default function CollegeGPTPage() {
  const [session, setSession] = useState<ChatSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [messages, setMessages] = useState<ChatLayoutMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  // ALL past CollegeGPT sessions — shown in the sidebar so the student can
  // switch back to old conversations instead of losing them on "New chat".
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // ── On mount: load ALL CollegeGPT sessions for this user ──
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setSessionLoading(true)
      setChatError(null)
      try {
        let existing = await chatApi.listSessions('college_gpt')
        if (existing.length === 0) {
          // First-time user — seed an empty session
          const fresh = await chatApi.createSession({ chat_type: 'college_gpt' })
          existing = [fresh]
        }
        if (cancelled) return
        setSessions(existing)

        const active = existing[0]!
        setSession(active)
        const fullSession = await chatApi.getSession(active.id)
        if (cancelled) return
        setMessages(fullSession.messages.map(backendMessageToLayout))
      } catch (err) {
        if (!cancelled) {
          setChatError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load CollegeGPT session',
          )
        }
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    })()
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  // Switch active session to one clicked in the sidebar.
  const handleSelectSession = async (target: ChatSession) => {
    if (streaming || sessionLoading || target.id === session?.id) return
    abortRef.current?.abort()
    abortRef.current = null
    setSessionLoading(true)
    setMessages([])
    setChatError(null)
    try {
      const full = await chatApi.getSession(target.id)
      setSession(target)
      setMessages(full.messages.map(backendMessageToLayout))
    } catch (err) {
      setChatError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not load that chat',
      )
    } finally {
      setSessionLoading(false)
    }
  }

  const handleDeleteSession = async (target: ChatSession) => {
    if (streaming || sessionLoading) return
    if (!window.confirm('Delete this chat? Messages will be lost.')) return
    try {
      await chatApi.deleteSession(target.id)
      const remaining = sessions.filter((s) => s.id !== target.id)
      setSessions(remaining)
      if (session?.id === target.id) {
        if (remaining.length > 0) {
          await handleSelectSession(remaining[0]!)
        } else {
          const fresh = await chatApi.createSession({ chat_type: 'college_gpt' })
          setSessions([fresh])
          setSession(fresh)
          setMessages([])
        }
      }
    } catch (err) {
      setChatError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not delete that chat',
      )
    }
  }

  const handleSend = async (text: string) => {
    if (!session || streaming) return
    setChatError(null)

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

      // Refresh from server to pick up persisted citations AND the
      // backend-auto-generated title (surfaces in the Chats sidebar).
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
      setChatError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to send message',
      )
      setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.isStreaming)))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleNewChat = async () => {
    if (sessionLoading) return
    setSessionLoading(true)
    setMessages([])
    setChatError(null)
    try {
      const s = await chatApi.createSession({ chat_type: 'college_gpt' })
      // Prepend so it shows at the top of the Chats sidebar — old chats stay.
      setSessions((prev) => [s, ...prev])
      setSession(s)
    } catch (err) {
      setChatError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not start a new chat',
      )
    } finally {
      setSessionLoading(false)
    }
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left rail — past chats, like Claude.ai projects.
          "New chat" creates a new session without losing the old ones. */}
      <aside className="w-60 shrink-0 flex flex-col gap-2 overflow-hidden">
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className="w-full justify-start"
          onClick={() => void handleNewChat()}
          disabled={streaming || sessionLoading}
        >
          New chat
        </Button>
        <div className="flex items-center justify-between gap-2 px-2 pt-2">
          <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            Chats
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {sessions.length}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
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
      </aside>

      {/* Main column — info bar + chat */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <Card className="flex items-center gap-3 py-3 shrink-0">
          <Info className="h-4 w-4 text-info shrink-0" />
          <span className="text-sm text-[var(--text-secondary)] truncate">
            CollegeGPT answers from your college's official documents (handbooks, timetables,
            placement records, hostel rules, faculty lists)
          </span>
        </Card>

        {chatError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger shrink-0">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{chatError}</span>
          </div>
        )}

        {sessionLoading && messages.length === 0 ? (
          <Card className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
          </Card>
        ) : (
          <div className="flex-1 min-h-0">
            <ChatLayout
              messages={messages}
              onSend={handleSend}
              placeholder="Ask about college rules, placements, faculty..."
              suggestedQuestions={messages.length === 0 ? suggestedQuestions : undefined}
              disabled={!session || streaming || sessionLoading}
              className="!h-full"
            />
          </div>
        )}
      </div>
    </div>
  )
}
