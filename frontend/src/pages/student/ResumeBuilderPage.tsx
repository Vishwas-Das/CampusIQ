import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  AlertCircle,
  BarChart3,
  Bot,
  Code,
  Download,
  ExternalLink,
  ImagePlus,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Send,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react'
import Card, { CardLabel } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'
import TextArea from '../../components/ui/TextArea'
import { ApiError, resumeApi } from '../../api/client'
import type {
  ATSScoreResponse,
  ResumeChatHistoryItem,
  ResumeContent,
  ResumeLanguage,
  ResumeResponse,
} from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

interface UIChatMsg {
  role: 'assistant' | 'user'
  text: string
  isPending?: boolean
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

function atsBadgeVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 75) return 'success'
  if (score >= 55) return 'warning'
  return 'danger'
}

/** Tick a wall-clock seconds counter while `active` is true; reset to 0 when
 *  it flips back. Useful for "Importing… (3s)" style affordances on calls
 *  that can take 5-10s (Claude + GitHub fetches). */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => window.clearInterval(id)
  }, [active])
  return elapsed
}

const PHOTO_MAX_EDGE = 400
const PHOTO_QUALITY = 0.85
const PHOTO_MAX_INPUT_BYTES = 10 * 1024 * 1024 // refuse >10MB at the input layer

async function resizeImageToDataUrl(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = objectUrl
    })
    const longestEdge = Math.max(img.width, img.height)
    const scale = Math.min(1, maxEdge / longestEdge)
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export default function ResumeBuilderPage() {
  const [resume, setResume] = useState<ResumeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<UIChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  // ATS modal
  const [atsOpen, setAtsOpen] = useState(false)
  const [atsJD, setAtsJD] = useState('')
  const [atsScoring, setAtsScoring] = useState(false)
  const [atsResult, setAtsResult] = useState<ATSScoreResponse | null>(null)
  const atsElapsed = useElapsedSeconds(atsScoring)

  // GitHub import modal
  const [ghOpen, setGhOpen] = useState(false)
  const [ghUsername, setGhUsername] = useState('')
  const [ghImporting, setGhImporting] = useState(false)
  const ghElapsed = useElapsedSeconds(ghImporting)
  const [ghResult, setGhResult] = useState<{
    count: number
    names: string[]
  } | null>(null)

  const chatScrollRef = useRef<HTMLDivElement>(null)

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [r, h] = await Promise.all([resumeApi.me(), resumeApi.history()])
        if (cancelled) return
        setResume(r)
        const initial: UIChatMsg[] = h.messages.map((m: ResumeChatHistoryItem) => ({
          role: m.role,
          text: m.content,
        }))
        if (initial.length === 0) {
          initial.push({
            role: 'assistant',
            text: "Hey! I'm your CampusIQ Resume Coach. Let's build your resume one section at a time. What's your full name and the email you want recruiters to use?",
          })
        }
        setMessages(initial)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && typeof err.detail === 'string'
              ? err.detail
              : 'Could not load your resume',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    const message = input.trim()
    if (!message || sending) return
    setError(null)
    setInput('')
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: message },
      { role: 'assistant', text: '…', isPending: true },
    ])
    setSending(true)

    try {
      const result = await resumeApi.chat({ message })
      setMessages((prev) => {
        const next = prev.filter((m) => !m.isPending)
        next.push({ role: 'assistant', text: result.ai_message })
        return next
      })
      // Refresh resume — quickest way to keep ats_score / last_updated in sync
      setResume((prev) =>
        prev
          ? { ...prev, content: result.content, last_updated: new Date().toISOString() }
          : prev,
      )
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Resume Coach call failed',
      )
      setMessages((prev) => prev.filter((m) => !m.isPending))
    } finally {
      setSending(false)
    }
  }

  const handleAtsScore = async () => {
    if (!atsJD.trim()) return
    setAtsScoring(true)
    setError(null)
    try {
      const result = await resumeApi.scoreAts({ job_description: atsJD })
      setAtsResult(result)
      // Bump the displayed score
      setResume((prev) => (prev ? { ...prev, ats_score: result.score } : prev))
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'ATS scoring failed',
      )
    } finally {
      setAtsScoring(false)
    }
  }

  const handleGithubImport = async () => {
    if (!ghUsername.trim()) return
    setGhImporting(true)
    setError(null)
    try {
      const result = await resumeApi.importGithub({ username: ghUsername.trim(), top_n: 5 })
      setResume((prev) =>
        prev ? { ...prev, content: result.content, last_updated: new Date().toISOString() } : prev,
      )
      setGhResult({
        count: result.imported_count,
        names: result.projects.map((p) => p.name),
      })
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'GitHub import failed',
      )
    } finally {
      setGhImporting(false)
    }
  }

  // ── Optional profile photo ──
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoDragOver, setPhotoDragOver] = useState(false)
  // Drag-leave fires for every child element a drag passes over, so a single
  // boolean flickers. Track the entry counter and only clear when it returns
  // to zero, matching how Slack / GitHub / Notion implement drop targets.
  const photoDragDepthRef = useRef(0)

  const processPhotoFile = useCallback(
    async (file: File): Promise<void> => {
      if (!resume?.content) return
      if (!file.type.startsWith('image/')) {
        setError('Please drop an image file (PNG, JPG, etc.)')
        return
      }
      if (file.size > PHOTO_MAX_INPUT_BYTES) {
        setError('Photo must be under 10 MB')
        return
      }
      setPhotoBusy(true)
      setError(null)
      try {
        const dataUrl = await resizeImageToDataUrl(file, PHOTO_MAX_EDGE, PHOTO_QUALITY)
        const next: ResumeContent = {
          ...resume.content,
          personal: { ...resume.content.personal, photo_url: dataUrl },
        }
        const updated = await resumeApi.update({ content: next })
        setResume(updated)
      } catch (err) {
        setError(
          err instanceof ApiError && typeof err.detail === 'string'
            ? err.detail
            : err instanceof Error
              ? err.message
              : 'Could not upload photo',
        )
      } finally {
        setPhotoBusy(false)
      }
    },
    [resume?.content],
  )

  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Always reset the input so the same file can be picked again later.
    if (e.target) e.target.value = ''
    if (file) await processPhotoFile(file)
  }

  const handlePhotoDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
    e.preventDefault()
    photoDragDepthRef.current += 1
    setPhotoDragOver(true)
  }

  const handlePhotoDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
    // Both preventDefault on dragenter AND dragover are required to mark this
    // as a valid drop target — otherwise the browser shows a "no-entry" cursor.
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const handlePhotoDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
    photoDragDepthRef.current = Math.max(0, photoDragDepthRef.current - 1)
    if (photoDragDepthRef.current === 0) setPhotoDragOver(false)
  }

  const handlePhotoDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    photoDragDepthRef.current = 0
    setPhotoDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) await processPhotoFile(file)
  }

  // Document-level paste handler — ⌘V / Ctrl+V anywhere on the page
  // pastes a copied image into the photo slot. Only kicks in when the user
  // isn't typing in a text input or contenteditable, and when the clipboard
  // actually contains an image (not just text).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!resume?.content) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return
      }
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            void processPhotoFile(file)
          }
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [resume?.content, processPhotoFile])

  const handlePhotoRemove = async () => {
    if (!resume?.content) return
    setPhotoBusy(true)
    setError(null)
    try {
      const next: ResumeContent = {
        ...resume.content,
        personal: { ...resume.content.personal, photo_url: '' },
      }
      const updated = await resumeApi.update({ content: next })
      setResume(updated)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not remove photo',
      )
    } finally {
      setPhotoBusy(false)
    }
  }

  const handlePrint = () => {
    // Open the dedicated print-only route in a new tab. That page renders
    // the resume in the Professional Resume Template layout (no sidebar /
    // chat) and auto-fires window.print() once the data is loaded, so the
    // user lands directly in the browser's "Save as PDF" dialog. The
    // `?print=1` query keeps auto-print scoped to this entry point —
    // direct visits to /student/resume/print stay as a preview.
    window.open('/student/resume/print?print=1', '_blank')
  }

  // ── Languages inline editor ──
  const [newLangName, setNewLangName] = useState('')
  const [newLangProf, setNewLangProf] = useState('Fluent')
  const [langBusy, setLangBusy] = useState(false)

  const persistLanguages = async (next: ResumeLanguage[]) => {
    if (!resume?.content) return
    setLangBusy(true)
    setError(null)
    try {
      const updated = await resumeApi.update({
        content: { ...resume.content, languages: next },
      })
      setResume(updated)
    } catch (err) {
      setError(
        err instanceof ApiError && typeof err.detail === 'string'
          ? err.detail
          : 'Could not save languages',
      )
    } finally {
      setLangBusy(false)
    }
  }

  const handleAddLanguage = async () => {
    const name = newLangName.trim()
    if (!name || !resume?.content) return
    const next: ResumeLanguage[] = [
      ...resume.content.languages,
      { name, proficiency: newLangProf.trim() || 'Fluent' },
    ]
    setNewLangName('')
    setNewLangProf('Fluent')
    await persistLanguages(next)
  }

  const handleRemoveLanguage = async (index: number) => {
    if (!resume?.content) return
    const next = resume.content.languages.filter((_, i) => i !== index)
    await persistLanguages(next)
  }

  const content: ResumeContent | null = resume?.content ?? null
  const atsScore = resume?.ats_score ?? null

  const personal = content?.personal
  const hasAnyData = useMemo(() => {
    if (!content) return false
    return (
      Boolean(personal?.name) ||
      content.education.length > 0 ||
      content.projects.length > 0 ||
      content.skills.length > 0
    )
  }, [content, personal])

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-10 text-[var(--text-tertiary)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading your resume…
      </Card>
    )
  }

  return (
    <motion.div className="space-y-4" variants={stagger} initial="initial" animate="animate">
      {error && (
        <motion.div
          variants={fadeUp}
          className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20 text-sm text-danger no-print"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Top bar: name + ATS score */}
      <motion.div variants={fadeUp} className="flex items-center justify-between no-print">
        <div className="text-sm text-[var(--text-tertiary)]">
          {hasAnyData ? (
            <>
              <span className="text-[var(--text-secondary)]">Last updated </span>
              {formatRelative(resume?.last_updated ?? new Date().toISOString())}
            </>
          ) : (
            'Empty resume — start chatting to fill it in'
          )}
        </div>
        <div className="flex items-center gap-2">
          {atsScore !== null && atsScore > 0 ? (
            <Badge variant={atsBadgeVariant(atsScore)} size="lg">
              ATS Score: {atsScore.toFixed(0)}/100
            </Badge>
          ) : (
            <Badge size="lg">ATS not scored yet</Badge>
          )}
        </div>
      </motion.div>

      {/* Split layout */}
      <motion.div
        variants={fadeUp}
        className="flex gap-4 no-print"
        style={{ height: 'calc(100vh - 14rem)' }}
      >
        {/* Left: AI Chat */}
        <div className="w-1/2 flex flex-col card overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)] leading-tight">
                  AI Resume Coach
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {messages.length} message{messages.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              online
            </span>
          </div>

          {/* Messages */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user'
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex items-end gap-2',
                    isUser ? 'flex-row-reverse' : 'flex-row',
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={clsx(
                      'h-7 w-7 rounded-full flex items-center justify-center shrink-0 shadow-sm',
                      isUser
                        ? 'bg-primary/15 text-primary'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-default)]',
                    )}
                  >
                    {isUser ? (
                      <UserIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={clsx(
                      'max-w-[78%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line shadow-sm',
                      isUser
                        ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)] rounded-2xl rounded-bl-sm',
                      msg.isPending && 'animate-pulse',
                    )}
                  >
                    {msg.text}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Composer */}
          <div className="px-3 py-3 border-t border-[var(--border-default)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--input-bg)] px-3 py-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-shadow">
              <input
                value={input}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) =>
                  e.key === 'Enter' && void handleSend()
                }
                placeholder="Tell the coach about yourself…"
                className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] py-1.5"
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
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5 px-1">
              Press Enter to send · the coach updates the resume on the right as you go
            </p>
          </div>
        </div>

        {/* Right: Resume Preview */}
        <div className="w-1/2 overflow-y-auto" id="resume-preview-wrapper">
          <Card className="h-full">
            {!hasAnyData ? (
              <p className="text-sm text-[var(--text-tertiary)] text-center py-12">
                Your resume preview will appear here as you chat with the coach. Start by sending
                your name and email on the left.
              </p>
            ) : (
              <div className="space-y-5 print-resume">
                {/* Optional profile photo — sits above the name in the preview
                    so the user can see immediately what the printed resume
                    will show. The whole row is a drop target so the user can
                    drag a photo onto it; it also doubles as a click target
                    that opens the native file picker. */}
                <div
                  className={clsx(
                    'flex items-center gap-3 pb-3 border-b transition-colors rounded-md p-2 -m-2',
                    photoDragOver
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/40 ring-offset-1 ring-offset-[var(--bg-secondary)]'
                      : 'border-[var(--border-default)]',
                  )}
                  onDragEnter={handlePhotoDragEnter}
                  onDragOver={handlePhotoDragOver}
                  onDragLeave={handlePhotoDragLeave}
                  onDrop={(e) => void handlePhotoDrop(e)}
                  onClick={() => {
                    if (!photoBusy) photoInputRef.current?.click()
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !photoBusy) {
                      e.preventDefault()
                      photoInputRef.current?.click()
                    }
                  }}
                  aria-label="Upload profile photo (or drag and drop)"
                  style={{ cursor: photoBusy ? 'progress' : 'pointer' }}
                >
                  <div
                    className={clsx(
                      'h-14 w-14 rounded-full border bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden shrink-0 transition-colors',
                      photoDragOver
                        ? 'border-primary border-2'
                        : 'border-dashed border-[var(--border-strong)]',
                    )}
                    aria-hidden="true"
                  >
                    {personal?.photo_url ? (
                      <img
                        src={personal.photo_url}
                        alt="Profile"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-[var(--text-tertiary)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardLabel>PHOTO (OPTIONAL)</CardLabel>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {photoDragOver
                        ? 'Drop the image to upload it.'
                        : personal?.photo_url
                          ? 'Click or drop a new image to replace.'
                          : 'Drag an image here, or click to choose. Skip and the circle stays blank.'}
                    </p>
                  </div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => void handlePhotoChange(e)}
                    style={{ display: 'none' }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      photoInputRef.current?.click()
                    }}
                    disabled={photoBusy}
                  >
                    {photoBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : personal?.photo_url ? (
                      'Change'
                    ) : (
                      'Upload'
                    )}
                  </Button>
                  {personal?.photo_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handlePhotoRemove()
                      }}
                      disabled={photoBusy}
                      aria-label="Remove photo"
                    />
                  )}
                </div>

                <div className="border-b border-[var(--border-default)] pb-4">
                  <h2 className="text-2xl font-bold text-[var(--text-primary)]">
                    {personal?.name || 'Your Name'}
                  </h2>
                  {content?.summary && (
                    <p className="text-sm text-[var(--text-secondary)] mt-1">
                      {content.summary}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                    {personal?.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {personal.email}
                      </span>
                    )}
                    {personal?.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {personal.phone}
                      </span>
                    )}
                    {personal?.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {personal.location}
                      </span>
                    )}
                    {personal?.github && (
                      <span className="flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        {personal.github.replace(/^https?:\/\//, '')}
                      </span>
                    )}
                  </div>
                </div>

                {content && content.education.length > 0 && (
                  <Section title="Education">
                    {content.education.map((edu, i) => (
                      <div key={i} className="space-y-0.5">
                        <p className="font-medium text-[var(--text-primary)]">
                          {edu.institution}
                        </p>
                        <p className="text-sm text-[var(--text-secondary)]">
                          {edu.degree}
                          {edu.branch && ` · ${edu.branch}`}
                          {edu.start_year && ` · ${edu.start_year}–${edu.end_year || 'present'}`}
                        </p>
                        {edu.cgpa && (
                          <p className="text-xs text-[var(--text-tertiary)]">CGPA: {edu.cgpa}</p>
                        )}
                        {edu.highlights.length > 0 && (
                          <ul className="list-disc list-inside text-xs text-[var(--text-secondary)] mt-1">
                            {edu.highlights.map((h, j) => (
                              <li key={j}>{h}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </Section>
                )}

                {content && content.experience.length > 0 && (
                  <Section title="Experience">
                    {content.experience.map((exp, i) => (
                      <div key={i} className="space-y-0.5">
                        <p className="font-medium text-[var(--text-primary)]">
                          {exp.role}
                          {exp.company && <span className="text-[var(--text-secondary)]"> · {exp.company}</span>}
                        </p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {exp.start_date}
                          {exp.end_date && ` – ${exp.end_date}`}
                          {exp.location && ` · ${exp.location}`}
                        </p>
                        {exp.bullets.length > 0 && (
                          <ul className="list-disc list-inside text-xs text-[var(--text-secondary)] mt-1 space-y-0.5">
                            {exp.bullets.map((b, j) => (
                              <li key={j}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </Section>
                )}

                {content && content.projects.length > 0 && (
                  <Section title="Projects">
                    {content.projects.map((p, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {p.name}
                        </p>
                        {p.description && (
                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            {p.description}
                          </p>
                        )}
                        {p.tech.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap mt-1.5">
                            {p.tech.map((t) => (
                              <Badge key={t} size="sm">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-[var(--text-tertiary)] hover:text-primary"
                          >
                            {p.url.replace(/^https?:\/\//, '')}
                          </a>
                        )}
                      </div>
                    ))}
                  </Section>
                )}

                {content && content.skills.length > 0 && (
                  <Section title="Skills">
                    <div className="flex flex-wrap gap-1.5">
                      {content.skills.map((s) => (
                        <Badge key={s} variant="primary" size="sm">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Languages — inline editor with chip + proficiency. */}
                <Section title="Languages">
                  {content && content.languages.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {content.languages.map((lang, i) => (
                        <span
                          key={lang.name + i}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs"
                        >
                          <span className="font-medium text-[var(--text-primary)]">
                            {lang.name}
                          </span>
                          {lang.proficiency && (
                            <span className="text-[var(--text-tertiary)]">
                              · {lang.proficiency}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleRemoveLanguage(i)}
                            disabled={langBusy}
                            className="text-[var(--text-tertiary)] hover:text-danger"
                            aria-label={`Remove ${lang.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)] mb-2">
                      Add languages you speak to round out the sidebar.
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Input
                      placeholder="Language (e.g. Hindi)"
                      value={newLangName}
                      onChange={(e) => setNewLangName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleAddLanguage()
                        }
                      }}
                      disabled={langBusy}
                      className="flex-1"
                    />
                    <select
                      value={newLangProf}
                      onChange={(e) => setNewLangProf(e.target.value)}
                      disabled={langBusy}
                      className="input-base w-32 text-sm"
                    >
                      <option value="Native">Native</option>
                      <option value="Fluent">Fluent</option>
                      <option value="Professional">Professional</option>
                      <option value="Conversational">Conversational</option>
                    </select>
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() => void handleAddLanguage()}
                      disabled={langBusy || !newLangName.trim()}
                    >
                      Add
                    </Button>
                  </div>
                </Section>

                {content && content.certifications.length > 0 && (
                  <Section title="Certifications">
                    <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-0.5">
                      {content.certifications.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </Section>
                )}

                {content && content.achievements.length > 0 && (
                  <Section title="Achievements">
                    <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-0.5">
                      {content.achievements.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </Section>
                )}
              </div>
            )}
          </Card>
        </div>
      </motion.div>

      {/* Bottom action bar */}
      <motion.div variants={fadeUp} className="flex gap-3 no-print">
        <Button icon={Download} onClick={handlePrint} disabled={!hasAnyData}>
          Download PDF
        </Button>
        <Button variant="secondary" icon={BarChart3} onClick={() => setAtsOpen(true)}>
          ATS Score
        </Button>
        <Button variant="secondary" icon={Code} onClick={() => setGhOpen(true)}>
          Import from GitHub
        </Button>
      </motion.div>

      {/* ATS Modal */}
      <Modal isOpen={atsOpen} onClose={() => setAtsOpen(false)} title="Score against a job description" size="lg">
        <div className="space-y-4">
          <TextArea
            label="Job Description"
            placeholder="Paste the JD here…"
            rows={8}
            value={atsJD}
            onChange={(e) => setAtsJD(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAtsOpen(false)} disabled={atsScoring}>
              Cancel
            </Button>
            <Button onClick={() => void handleAtsScore()} disabled={atsScoring || atsJD.length < 20}>
              {atsScoring ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Scoring{atsElapsed > 1 ? ` · ${atsElapsed}s` : '…'}
                </>
              ) : (
                'Score My Resume'
              )}
            </Button>
          </div>

          {atsResult && (
            <div className="space-y-3 border-t border-[var(--border-default)] pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">Score</span>
                <Badge variant={atsBadgeVariant(atsResult.score)} size="lg">
                  {atsResult.score.toFixed(0)} / 100
                </Badge>
              </div>
              <div>
                <p className="text-xs uppercase text-[var(--text-tertiary)] mb-1">
                  Matched Keywords
                </p>
                <div className="flex flex-wrap gap-1">
                  {atsResult.matched_keywords.map((k) => (
                    <Badge key={k} variant="success" size="sm">
                      {k}
                    </Badge>
                  ))}
                  {atsResult.matched_keywords.length === 0 && (
                    <span className="text-xs text-[var(--text-tertiary)]">None</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-[var(--text-tertiary)] mb-1">
                  Missing Keywords
                </p>
                <div className="flex flex-wrap gap-1">
                  {atsResult.missing_keywords.map((k) => (
                    <Badge key={k} variant="danger" size="sm">
                      {k}
                    </Badge>
                  ))}
                  {atsResult.missing_keywords.length === 0 && (
                    <span className="text-xs text-[var(--text-tertiary)]">None</span>
                  )}
                </div>
              </div>
              {atsResult.suggestions.length > 0 && (
                <div>
                  <p className="text-xs uppercase text-[var(--text-tertiary)] mb-1">Suggestions</p>
                  <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-0.5">
                    {atsResult.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* GitHub Import Modal */}
      <Modal isOpen={ghOpen} onClose={() => setGhOpen(false)} title="Import projects from GitHub" size="md">
        <div className="space-y-4">
          <Input
            label="GitHub username"
            placeholder="e.g. arunsanjay"
            value={ghUsername}
            onChange={(e) => setGhUsername(e.target.value)}
          />
          <p className="text-xs text-[var(--text-tertiary)]">
            We'll fetch your top public repos sorted by stars and add them to the Projects
            section. Forks and archived repos are skipped.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGhOpen(false)} disabled={ghImporting}>
              Cancel
            </Button>
            <Button onClick={() => void handleGithubImport()} disabled={ghImporting || !ghUsername.trim()}>
              {ghImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Importing{ghElapsed > 1 ? ` · ${ghElapsed}s` : '…'}
                </>
              ) : (
                'Import top 5'
              )}
            </Button>
          </div>

          {ghResult && (
            <div className="border-t border-[var(--border-default)] pt-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Imported {ghResult.count} project{ghResult.count === 1 ? '' : 's'}
              </p>
              {ghResult.names.length > 0 && (
                <ul className="list-disc list-inside text-xs text-[var(--text-secondary)] mt-2 space-y-0.5">
                  {ghResult.names.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </motion.div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
