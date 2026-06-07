import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Bot, Lightbulb, BookOpen, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import { ApiError, chatApi } from '../../api/client'
import ChatMessage from '../chat/ChatMessage'
import ChatInput from '../chat/ChatInput'
import type { ChatSession, CoachMode, HintLevel } from '../../types'

interface CoachMsg {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

interface HintRung {
  key: HintLevel
  label: string
  dots: number
  blurb: string
}

// The ladder. Starts at "Nudge" (subtlest — you still think) and climbs toward
// "Spell it out" (basically the answer for where you're stuck). It auto-advances
// one rung each time the student asks for another hint; they can override.
const HINT_RUNGS: HintRung[] = [
  { key: 'nudge', label: 'Nudge', dots: 1, blurb: 'A gentle push — you keep doing the thinking.' },
  { key: 'guide', label: 'Guide', dots: 2, blurb: 'Names the pattern + key idea. You write the code.' },
  { key: 'spell_it_out', label: 'Spell it out', dots: 3, blurb: 'Walks the algorithm step by step, short of the code.' },
]

function nextRung(level: HintLevel): HintLevel {
  const i = HINT_RUNGS.findIndex((r) => r.key === level)
  return HINT_RUNGS[Math.min(i + 1, HINT_RUNGS.length - 1)].key
}

const HINT_SUGGESTIONS = ['How should I start?', 'Give me a hint', "Here's my idea — does it work?"]
const SOLUTION_SUGGESTIONS = ['Walk me through the optimal solution', 'What pattern does this use?']

export interface CoachChatProps {
  problemId: string
  problemTitle: string
}

/**
 * A Socratic DSA coach bound to one problem. Two modes: Hint (with an
 * auto-escalating intensity ladder) and Solution (full walkthrough). Reuses the
 * shared `chat_type='dsa_coach'` session infra and streams from the same client.
 */
export default function CoachChat({ problemId, problemTitle }: CoachChatProps) {
  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<CoachMsg[]>([])
  const [booting, setBooting] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coachMode, setCoachMode] = useState<CoachMode>('hint')
  const [hintLevel, setHintLevel] = useState<HintLevel>('nudge')

  const scrollRef = useRef<HTMLDivElement>(null)

  // Find the coach session bound to this problem and load its history. We do
  // NOT create a session here — creation is deferred to the first message
  // (see `send`). That keeps drive-by visits from leaving empty sessions and
  // sidesteps the StrictMode double-mount creating duplicates.
  useEffect(() => {
    let cancelled = false
    setBooting(true)
    setError(null)
    setMessages([])
    setSession(null)
    setCoachMode('hint')
    setHintLevel('nudge')
    void (async () => {
      try {
        const existing = await chatApi.listSessions('dsa_coach', undefined, problemId)
        const s: ChatSession | null = existing[0] ?? null
        if (cancelled) return
        setSession(s)
        if (s) {
          const full = await chatApi.getSession(s.id)
          if (cancelled) return
          setMessages(
            full.messages.map((m) => ({
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.content,
            })),
          )
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not start the coach.',
          )
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [problemId, problemTitle])

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(
    async (text: string, override?: { coachMode?: CoachMode; hintLevel?: HintLevel }) => {
      const trimmed = text.trim()
      if (streaming || !trimmed) return
      const useMode = override?.coachMode ?? coachMode
      const useLevel = override?.hintLevel ?? hintLevel

      setError(null)
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: '', isStreaming: true },
      ])
      setStreaming(true)

      let acc = ''
      try {
        // Lazily create the bound session on the first message.
        let active = session
        if (!active) {
          active = await chatApi.createSession({
            chat_type: 'dsa_coach',
            coding_problem_id: problemId,
            title: `Coach — ${problemTitle}`,
          })
          setSession(active)
        }
        await chatApi.streamMessage({
          sessionId: active.id,
          content: trimmed,
          coachMode: useMode,
          hintLevel: useMode === 'hint' ? useLevel : undefined,
          onChunk: (delta) => {
            acc += delta
            setMessages((prev) => {
              const copy = prev.slice()
              const last = copy[copy.length - 1]
              if (last && last.role === 'assistant') {
                copy[copy.length - 1] = { ...last, content: acc }
              }
              return copy
            })
          },
        })
        setMessages((prev) => {
          const copy = prev.slice()
          const last = copy[copy.length - 1]
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { ...last, content: acc || '…', isStreaming: false }
          }
          return copy
        })
        // Climb the ladder for the NEXT hint ask (hint mode only).
        if (useMode === 'hint') setHintLevel((cur) => nextRung(cur))
      } catch (err) {
        const detail =
          err instanceof ApiError && typeof err.detail === 'string'
            ? err.detail
            : 'The coach hit an error — try again.'
        setMessages((prev) => {
          const copy = prev.slice()
          const last = copy[copy.length - 1]
          if (last && last.role === 'assistant') {
            copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${detail}`, isStreaming: false }
          }
          return copy
        })
      } finally {
        setStreaming(false)
      }
    },
    [session, streaming, coachMode, hintLevel, problemId, problemTitle],
  )

  const suggestions = coachMode === 'hint' ? HINT_SUGGESTIONS : SOLUTION_SUGGESTIONS
  const inputDisabled = booting || streaming
  const activeRung = HINT_RUNGS.find((r) => r.key === hintLevel) ?? HINT_RUNGS[0]

  return (
    <div className="flex flex-col h-full min-h-[420px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] overflow-hidden">
      {/* Header: identity + mode toggle */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--text-primary)] leading-tight">DSA Coach</div>
            <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">
              {coachMode === 'hint' ? 'Guides you — never just the answer' : 'Full walkthrough on demand'}
            </div>
          </div>
        </div>
        <ModeToggle value={coachMode} onChange={setCoachMode} disabled={streaming} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {booting ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Waking the coach…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState mode={coachMode} suggestions={suggestions} onPick={(q) => void send(q)} disabled={inputDisabled} />
        ) : (
          messages.map((m, i) => (
            <ChatMessage key={i} role={m.role} content={m.content} isStreaming={m.isStreaming} />
          ))
        )}
        <div ref={scrollRef} />
      </div>

      {/* Accessory + input */}
      <div className="border-t border-[var(--border-default)] px-3 py-2.5">
        {coachMode === 'hint' ? (
          <HintLadder level={hintLevel} blurb={activeRung.blurb} onChange={setHintLevel} disabled={streaming} />
        ) : (
          <div className="flex items-center gap-1.5 mb-2 text-[11px] text-[var(--text-tertiary)]">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            Solution mode reveals the full approach + code. Best after you've wrestled with it.
          </div>
        )}
        <ChatInput
          onSend={(t) => void send(t)}
          disabled={inputDisabled}
          placeholder={
            coachMode === 'hint'
              ? 'Tell the coach your idea, or ask for a hint…'
              : 'Ask for the full solution or a follow-up…'
          }
        />
      </div>
    </div>
  )
}

// ── Mode toggle: Hint | Solution ────────────────────────────────────────────
function ModeToggle({
  value,
  onChange,
  disabled,
}: {
  value: CoachMode
  onChange: (m: CoachMode) => void
  disabled?: boolean
}) {
  const opts: { key: CoachMode; label: string; Icon: typeof Lightbulb }[] = [
    { key: 'hint', label: 'Hint', Icon: Lightbulb },
    { key: 'solution', label: 'Solution', Icon: BookOpen },
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Coach mode"
      className="inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] shrink-0"
    >
      {opts.map(({ key, label, Icon }) => {
        const active = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              active
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

// ── Hint intensity ladder ────────────────────────────────────────────────────
function HintLadder({
  level,
  blurb,
  onChange,
  disabled,
}: {
  level: HintLevel
  blurb: string
  onChange: (l: HintLevel) => void
  disabled?: boolean
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Hint intensity
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" /> climbs as you ask
        </span>
      </div>
      <div className="flex items-center gap-1">
        {HINT_RUNGS.map((r) => {
          const active = r.key === level
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(r.key)}
              title={r.blurb}
              className={clsx(
                'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
                active
                  ? 'border-[var(--border-strong)] bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Dots filled={r.dots} active={active} />
              {r.label}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-1 leading-snug">{blurb}</p>
    </div>
  )
}

function Dots({ filled, active }: { filled: number; active: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            n <= filled
              ? active
                ? 'bg-primary'
                : 'bg-[var(--text-secondary)]'
              : 'bg-[var(--border-default)]',
          )}
        />
      ))}
    </span>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({
  mode,
  suggestions,
  onPick,
  disabled,
}: {
  mode: CoachMode
  suggestions: string[]
  onPick: (q: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-2">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
        {mode === 'hint' ? (
          <Lightbulb className="h-5 w-5 text-primary" />
        ) : (
          <BookOpen className="h-5 w-5 text-primary" />
        )}
      </div>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs leading-relaxed">
        {mode === 'hint'
          ? 'Stuck? Tell me your idea — even a brute-force one — and I’ll nudge you toward the insight. I won’t just hand over the answer.'
          : 'Want the full picture? I’ll walk you through the optimal approach, why it works, the complexity, and the code.'}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-full border border-[var(--border-default)] text-[var(--text-secondary)]',
              'hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
