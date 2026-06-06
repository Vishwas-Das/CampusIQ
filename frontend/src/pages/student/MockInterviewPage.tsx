import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Send,
  Square,
  User,
  Volume2,
} from 'lucide-react'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import { ApiError, API_BASE_URL, interviewsApi } from '../../api/client'
import { useMediaRecorder } from '../../hooks/useMediaRecorder'
import { useBrowserSpeechRecognition } from '../../hooks/useBrowserSpeechRecognition'
import { useBrowserSpeechSynthesis } from '../../hooks/useBrowserSpeechSynthesis'
import type {
  HireVerdict,
  InterviewPersona,
  InterviewSessionResponse,
  VoiceCapabilitiesResponse,
} from '../../types'

// The static-files mount lives at /audio on the backend root, NOT under
// /api/v1. Strip the API prefix so we can build a playable URL from a path
// like "/audio/abc123.mp3".
const AUDIO_HOST = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '')

function buildAudioUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${AUDIO_HOST}${path}`
}

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

interface CompanyChoice {
  name: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  variant: BadgeVariant
}

const companies: CompanyChoice[] = [
  { name: 'Google', difficulty: 'Hard', variant: 'danger' },
  { name: 'Amazon', difficulty: 'Hard', variant: 'danger' },
  { name: 'Microsoft', difficulty: 'Hard', variant: 'danger' },
  { name: 'Flipkart', difficulty: 'Medium', variant: 'warning' },
  { name: 'TCS', difficulty: 'Easy', variant: 'success' },
  { name: 'Startup', difficulty: 'Medium', variant: 'warning' },
]

interface PersonaChoice {
  value: InterviewPersona
  emoji: string
  name: string
  desc: string
}

const personas: PersonaChoice[] = [
  { value: 'friendly', emoji: '😊', name: 'Friendly', desc: 'Supportive and encouraging, guides you gently' },
  { value: 'tough', emoji: '😤', name: 'Tough', desc: 'Pushes hard, expects precise answers' },
  { value: 'rapid_fire', emoji: '⚡', name: 'Rapid Fire', desc: 'Quick questions, tests speed and recall' },
  { value: 'unpredictable', emoji: '🎲', name: 'Unpredictable', desc: 'Random question styles, keeps you on edge' },
]

const rounds = [
  { label: 'HR', num: 1 },
  { label: 'Technical', num: 2 },
  { label: 'Sys Design', num: 3 },
  { label: 'Managerial', num: 4 },
  { label: 'Negotiation', num: 5 },
]

type View = 'setup' | 'interview' | 'debrief'

function verdictBadgeVariant(v: HireVerdict): BadgeVariant {
  if (v === 'strong_hire') return 'success'
  if (v === 'hire') return 'success'
  if (v === 'leaning_no') return 'warning'
  return 'danger'
}

function verdictLabel(v: HireVerdict): string {
  return {
    strong_hire: 'STRONG HIRE',
    hire: 'LIKELY HIRED',
    leaning_no: 'LEANING NO',
    no_hire: 'NO HIRE',
  }[v]
}

export default function MockInterviewPage() {
  const [view, setView] = useState<View>('setup')
  const [selectedCompany, setSelectedCompany] = useState<string>('Google')
  const [selectedRole, setSelectedRole] = useState<string>('SWE')
  const [selectedPersona, setSelectedPersona] = useState<InterviewPersona>('tough')
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [input, setInput] = useState<string>('')

  const [session, setSession] = useState<InterviewSessionResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Voice mode state (Phase 20)
  const recorder = useMediaRecorder({ video: false })
  const speech = useBrowserSpeechRecognition()
  const synth = useBrowserSpeechSynthesis()
  const [capabilities, setCapabilities] = useState<VoiceCapabilitiesResponse | null>(null)
  const [lastAssistantAudio, setLastAssistantAudio] = useState<string | null>(null)
  const [lastAssistantText, setLastAssistantText] = useState<string | null>(null)
  const [lastTranscribedText, setLastTranscribedText] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the transcript to the bottom whenever it updates
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [session?.transcript?.length, view])

  // Fetch the backend's voice capabilities once on mount so we know whether
  // server-side Whisper / TTS are reachable. We always fall back gracefully:
  // if the browser supports webkitSpeechRecognition we can do voice mode even
  // when the server has no OpenAI key (the transcript is sent as a hint).
  useEffect(() => {
    let cancelled = false
    interviewsApi
      .voiceCapabilities()
      .then((data) => {
        if (!cancelled) setCapabilities(data)
      })
      .catch(() => {
        // Capabilities endpoint may be unreachable; fall back to browser-only voice support.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // True if some form of voice can work — either browser ASR or server Whisper.
  const voiceSupported = speech.supported || (capabilities?.asr_available ?? false)

  // True when we'll fall back to the browser's built-in TTS because
  // ElevenLabs isn't reachable. Used to label the UI honestly.
  const usingBrowserTts = !capabilities?.tts_available && synth.supported

  // Auto-play the assistant's last reply when a new audio URL arrives.
  // If ElevenLabs returned no audio (capabilities.tts_available === false)
  // we fall back to the browser's free speechSynthesis API so the demo
  // always has *some* AI voice instead of awkward silence.
  useEffect(() => {
    if (lastAssistantAudio) {
      const node = audioRef.current
      if (node) {
        node.src = lastAssistantAudio
        node.play().catch(() => {
          /* autoplay blocked — user can click the replay button */
        })
      }
    } else if (lastAssistantText && synth.supported) {
      synth.speak(lastAssistantText, { rate: 1.0, pitch: 1.0 })
    }
  }, [lastAssistantAudio, lastAssistantText, synth])

  // ── Actions ──

  const handleStart = async () => {
    setStarting(true)
    setError(null)
    try {
      const data = await interviewsApi.start({
        company_target: selectedCompany,
        role_target: selectedRole,
        interviewer_persona: selectedPersona,
        mode,
      })
      setSession(data)
      setView('interview')
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not start the interview',
      )
    } finally {
      setStarting(false)
    }
  }

  const handleSend = async () => {
    if (!session || !input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setSending(true)
    setError(null)
    try {
      const result = await interviewsApi.sendMessage(session.id, { content })
      setSession(result.session)
      if (result.interview_completed) {
        setView('debrief')
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to submit your answer',
      )
    } finally {
      setSending(false)
    }
  }

  // ── Voice mode (Phase 20) ──
  const handleVoiceStart = useCallback(async () => {
    if (!session || sending) return
    setError(null)
    setLastTranscribedText(null)
    // Stop any AI voice still playing from the previous turn
    synth.cancel()
    if (audioRef.current) {
      audioRef.current.pause()
    }
    // Start SpeechRecognition FIRST so it claims a slot on the mic stream.
    // If MediaRecorder grabs first, Chrome sometimes leaves SR with silence
    // — that's the "voice not capturing words" bug.
    speech.reset()
    if (speech.supported) speech.start()
    await recorder.start()
  }, [recorder, sending, session, speech, synth])

  const handleVoiceStop = useCallback(async () => {
    if (!session) return
    // Stop SpeechRecognition FIRST so it flushes its final buffer into the
    // transcript before we read it below. The recorder stop is async too.
    if (speech.supported) speech.stop()
    const result = await recorder.stop()
    if (!result) return

    const transcript = (speech.transcript || '').trim()

    // If browser SR is supported but came back empty, the user either didn't
    // speak loud enough, or Chrome's audio router didn't share the mic with
    // SR. Either way, we can't help — server-side ASR keys are empty too.
    // Surface a clear message instead of silently submitting nothing.
    if (speech.supported && !transcript) {
      setError(
        "We didn't catch any words. Speak a bit louder, check your mic, " +
        "or try the Text mode while the voice path is being debugged.",
      )
      return
    }

    setSending(true)
    setError(null)
    try {
      const response = await interviewsApi.sendVoice({
        sessionId: session.id,
        audioBlob: result.blob,
        browserTranscript: transcript || null,
      })
      setSession(response.session)
      setLastTranscribedText(response.transcribed_text || transcript || null)

      // Pluck the freshest assistant message off the transcript so the
      // browser-TTS fallback knows what to speak when ElevenLabs is off.
      const lastAssistant = [...response.session.transcript]
        .reverse()
        .find((m) => m.role === 'assistant')
      setLastAssistantText(lastAssistant?.content ?? null)

      const audioUrl = buildAudioUrl(response.assistant_audio_url)
      setLastAssistantAudio(audioUrl)
      if (response.interview_completed) {
        setView('debrief')
      }
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : err instanceof Error
            ? err.message
            : 'Failed to submit your voice answer',
      )
    } finally {
      setSending(false)
    }
  }, [recorder, session, speech])

  const handleEnd = async () => {
    if (!session) return
    if (!window.confirm('End this interview now? We\'ll generate your debrief with whatever we have so far.')) return
    setSending(true)
    synth.cancel()
    try {
      const updated = await interviewsApi.end(session.id)
      setSession(updated)
      setView('debrief')
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Failed to end the interview',
      )
    } finally {
      setSending(false)
    }
  }

  const handleTryAgain = () => {
    setSession(null)
    setInput('')
    setError(null)
    setLastAssistantAudio(null)
    setLastAssistantText(null)
    setLastTranscribedText(null)
    synth.cancel()
    setView('setup')
  }

  // ── Derived state ──

  const currentRoundIdx = session ? session.current_round - 1 : 0
  const transcript = session?.transcript ?? []
  const report = session?.feedback_report ?? null

  const roundBanner = useMemo(() => {
    if (!session) return 'Round 1: HR / Behavioural'
    const summary = session.round_summaries.find((r) => r.status === 'active')
    if (summary) return `Round ${summary.round_number}: ${summary.name}`
    const last = session.round_summaries[session.round_summaries.length - 1]
    return last ? `Round ${last.round_number}: ${last.name}` : 'Interview'
  }, [session])

  // ══════════════════════════════════════════════════════════════
  // SETUP VIEW
  // ══════════════════════════════════════════════════════════════
  if (view === 'setup') {
    return (
      <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
        {error && (
          <motion.div
            variants={fadeUp}
            className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <CardLabel className="mb-3">Select Company</CardLabel>
          <div className="grid grid-cols-3 gap-3">
            {companies.map((c) => {
              const isSelected = selectedCompany === c.name
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setSelectedCompany(c.name)}
                  aria-pressed={isSelected}
                  className={clsx(
                    'p-4 rounded-card border text-left transition-colors flex items-center justify-between cursor-pointer',
                    isSelected
                      ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
                      : 'border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-tertiary)]',
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {isSelected && (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    )}
                    <span className="font-medium text-[var(--text-primary)] truncate">
                      {c.name}
                    </span>
                  </span>
                  <Badge variant={c.variant} size="sm">{c.difficulty}</Badge>
                </button>
              )
            })}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <CardLabel className="mb-3">Role</CardLabel>
          <div className="flex gap-2">
            {['SWE', 'SDE', 'Backend Engineer', 'ML Engineer', 'Full-Stack Intern'].map((r) => (
              <Button
                key={r}
                variant={selectedRole === r ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelectedRole(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <CardLabel className="mb-3">Select Persona</CardLabel>
          <div className="grid grid-cols-2 gap-3">
            {personas.map((p) => {
              const isSelected = selectedPersona === p.value
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSelectedPersona(p.value)}
                  aria-pressed={isSelected}
                  className={clsx(
                    'p-4 rounded-card border text-left transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
                      : 'border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-tertiary)]',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{p.emoji}</span>
                    <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                    {isSelected && (
                      <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">{p.desc}</p>
                </button>
              )
            })}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <CardLabel className="mb-3">Interview Mode</CardLabel>
          <div className="flex gap-2 items-center flex-wrap">
            <Button
              variant={mode === 'text' ? 'primary' : 'secondary'}
              icon={MessageSquare}
              onClick={() => setMode('text')}
            >
              Text
            </Button>
            <Button
              variant={mode === 'voice' ? 'primary' : 'secondary'}
              icon={voiceSupported ? Mic : MicOff}
              onClick={() => voiceSupported && setMode('voice')}
              disabled={!voiceSupported}
              title={
                voiceSupported
                  ? 'Speak your answer — the AI will reply in voice if ElevenLabs is enabled.'
                  : 'Voice needs Chrome (webkitSpeechRecognition) or a server-side OpenAI key.'
              }
            >
              Voice
            </Button>
            {capabilities && (
              <span className="text-xs text-[var(--text-tertiary)] ml-1">
                {speech.supported
                  ? 'Browser ASR ready'
                  : capabilities.asr_available
                    ? 'Server Whisper ready'
                    : 'No transcription available'}
                {capabilities.tts_available
                  ? ' · ElevenLabs voices on'
                  : synth.supported
                    ? ' · Browser voice fallback'
                    : ' · TTS off (text replies only)'}
              </span>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Button
            size="lg"
            icon={starting ? undefined : Play}
            onClick={() => void handleStart()}
            disabled={starting}
          >
            {starting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin inline" />
                Starting…
              </>
            ) : (
              'Start Interview'
            )}
          </Button>
        </motion.div>
      </motion.div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // INTERVIEW VIEW
  // ══════════════════════════════════════════════════════════════
  if (view === 'interview') {
    return (
      <motion.div className="space-y-4" variants={stagger} initial="initial" animate="animate">
        {error && (
          <motion.div
            variants={fadeUp}
            className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-center gap-0">
            {rounds.map((r, i) => {
              const roundSummary = session?.round_summaries[i]
              const status = roundSummary?.status ?? 'locked'
              return (
                <div key={r.label} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={clsx(
                        'w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors',
                        status === 'completed'
                          ? 'bg-success border-success text-white'
                          : status === 'active'
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-[var(--border-default)] text-[var(--text-tertiary)] bg-[var(--bg-secondary)]',
                      )}
                    >
                      {status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </div>
                    <span
                      className={clsx(
                        'text-[10px] mt-1 font-medium',
                        status === 'active'
                          ? 'text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)]',
                      )}
                    >
                      {r.label}
                    </span>
                  </div>
                  {i < rounds.length - 1 && (
                    <div
                      className={clsx(
                        'w-12 h-0.5 mx-1 mt-[-12px]',
                        i < currentRoundIdx ? 'bg-success' : 'bg-[var(--border-default)]',
                      )}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Card className="text-center py-2">
            <span className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
              {roundBanner}
            </span>
          </Card>
        </motion.div>

        <motion.div
          variants={fadeUp}
          className="card flex flex-col"
          style={{ height: 'calc(100vh - 22rem)' }}
        >
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {transcript.map((msg, i) => (
              <div key={i}>
                <div className={clsx('flex gap-2', msg.role === 'user' && 'justify-end')}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-line',
                      msg.role === 'assistant'
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {msg.content}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                      <User className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    </div>
                  )}
                </div>
                {msg.role === 'user' && msg.score !== null && msg.score !== undefined && (
                  <div className="flex justify-end mt-1.5 mr-9">
                    <div className="bg-success/5 border border-success/20 rounded-md px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                      <span
                        className={clsx(
                          'font-semibold',
                          msg.score >= 7.5
                            ? 'text-success'
                            : msg.score >= 5
                              ? 'text-warning'
                              : 'text-danger',
                        )}
                      >
                        Score: {msg.score.toFixed(1)}/10
                      </span>
                      {msg.score_reason && <span> — {msg.score_reason}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-[var(--bg-tertiary)] rounded-lg px-3 py-2 text-sm text-[var(--text-tertiary)] animate-pulse">
                  Thinking…
                </div>
              </div>
            )}
          </div>
          {mode === 'text' ? (
            <div className="p-3 border-t border-[var(--border-default)] flex gap-2">
              <input
                value={input}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) =>
                  e.key === 'Enter' && void handleSend()
                }
                placeholder="Type your answer…"
                className="input-base flex-1"
                disabled={sending}
              />
              <Button
                size="sm"
                icon={sending ? undefined : Send}
                onClick={() => void handleSend()}
                disabled={sending || !input.trim()}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
              </Button>
            </div>
          ) : (
            <div className="p-3 border-t border-[var(--border-default)] space-y-2">
              {speech.transcript || speech.interim || lastTranscribedText ? (
                <div className="text-xs text-[var(--text-secondary)] p-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-default)]">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    {recorder.state === 'recording' ? 'Live transcript' : 'You said'}
                  </span>
                  <p className="mt-1 text-[var(--text-primary)]">
                    {speech.transcript || lastTranscribedText}
                    {speech.interim && (
                      <span className="text-[var(--text-tertiary)] italic"> {speech.interim}</span>
                    )}
                  </p>
                </div>
              ) : null}

              <div className="flex items-center gap-3">
                {recorder.state === 'recording' ? (
                  <Button variant="danger" icon={Square} onClick={() => void handleVoiceStop()} loading={sending}>
                    Stop & Send ({Math.floor(recorder.elapsed / 60)}:{(recorder.elapsed % 60).toString().padStart(2, '0')})
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon={Mic}
                    onClick={() => void handleVoiceStart()}
                    loading={recorder.state === 'preparing' || sending}
                    disabled={recorder.state === 'preparing' || sending}
                  >
                    {sending ? 'Sending…' : 'Tap to speak'}
                  </Button>
                )}

                {(lastAssistantAudio || (lastAssistantText && synth.supported)) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (lastAssistantAudio) {
                        audioRef.current?.play().catch(() => undefined)
                      } else if (lastAssistantText) {
                        synth.speak(lastAssistantText, { rate: 1.0, pitch: 1.0 })
                      }
                    }}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    {synth.speaking ? 'Speaking…' : 'Replay AI voice'}
                  </button>
                )}

                <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
                  {speech.supported ? 'Browser transcribing' : 'Server transcribing'}
                  {capabilities?.tts_available
                    ? ' · ElevenLabs voice'
                    : usingBrowserTts
                      ? ' · Browser voice'
                      : ''}
                </span>
              </div>

              {/* Hidden audio element used to play back assistant TTS */}
              <audio ref={audioRef} className="hidden" controls />
            </div>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="flex gap-3">
          <Button variant="secondary" icon={Square} onClick={() => void handleEnd()} disabled={sending}>
            End Interview
          </Button>
          <span className="text-xs text-[var(--text-tertiary)] self-center">
            Persona: {session?.interviewer_persona} · Company: {session?.company_target}
          </span>
        </motion.div>
      </motion.div>
    )
  }

  // ══════════════════════════════════════════════════════════════
  // DEBRIEF VIEW
  // ══════════════════════════════════════════════════════════════
  const overallScore = session?.overall_score ?? 0
  const verdict: HireVerdict = report?.hire_verdict ?? 'leaning_no'

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      <motion.div variants={fadeUp}>
        <Card className="text-center py-6">
          <span className="stat-value text-5xl">{overallScore.toFixed(0)}/100</span>
          <div className="mt-3">
            <Badge variant={verdictBadgeVariant(verdict)} size="lg">
              {verdictLabel(verdict)}
            </Badge>
          </div>
          <p className="text-sm text-[var(--text-tertiary)] mt-2">
            {session?.company_target} — {session?.interviewer_persona} persona
          </p>
          {report?.headline && (
            <p className="text-sm text-[var(--text-secondary)] mt-3 italic max-w-xl mx-auto">
              "{report.headline}"
            </p>
          )}
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Round Breakdown</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            {session?.round_summaries.map((r) => {
              const score = r.avg_score ?? 0
              return (
                <div key={r.round_number} className="flex items-center gap-4">
                  <span className="w-32 text-sm font-medium text-[var(--text-primary)]">
                    {r.name}
                  </span>
                  <div className="flex-1">
                    <ProgressBar
                      value={score}
                      max={10}
                      size="md"
                      color={score >= 7.5 ? 'success' : score >= 5 ? 'warning' : 'danger'}
                    />
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)] w-16 text-right tabular-nums">
                    {r.avg_score !== null ? `${r.avg_score.toFixed(1)}/10` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      </motion.div>

      {report && (
        <>
          {report.strengths.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Strengths</CardTitle>
                </CardHeader>
                <ul className="space-y-2">
                  {report.strengths.map((s, i) => (
                    <li key={i} className="flex gap-3 text-sm text-[var(--text-secondary)]">
                      <span className="w-5 h-5 rounded-full bg-success/10 flex items-center justify-center text-[10px] font-bold text-success shrink-0">
                        ✓
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.div>
          )}

          {report.improvements.length > 0 && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Top Improvements</CardTitle>
                </CardHeader>
                <ol className="space-y-3">
                  {report.improvements.map((item, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {i + 1}
                      </span>
                      <p className="text-sm text-[var(--text-secondary)]">{item}</p>
                    </li>
                  ))}
                </ol>
              </Card>
            </motion.div>
          )}

          {(report.standout_answer || report.biggest_gap) && (
            <motion.div variants={fadeUp}>
              <Card>
                <CardHeader>
                  <CardTitle>Highlights</CardTitle>
                </CardHeader>
                <div className="space-y-3 text-sm">
                  {report.standout_answer && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-success mb-1">
                        Standout Answer
                      </p>
                      <p className="text-[var(--text-secondary)]">{report.standout_answer}</p>
                    </div>
                  )}
                  {report.biggest_gap && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-danger mb-1">
                        Biggest Gap
                      </p>
                      <p className="text-[var(--text-secondary)]">{report.biggest_gap}</p>
                    </div>
                  )}
                </div>
              </Card>
            </motion.div>
          )}
        </>
      )}

      <motion.div variants={fadeUp} className="flex gap-3">
        <Button icon={Download} onClick={() => window.print()}>
          Download Report
        </Button>
        <Button variant="secondary" icon={RotateCcw} onClick={handleTryAgain}>
          Try Again
        </Button>
      </motion.div>
    </motion.div>
  )
}
