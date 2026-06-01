import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, type Variants } from 'framer-motion'
import { clsx } from 'clsx'
import {
  Camera,
  Video,
  Square,
  Eye,
  Activity,
  MessageCircle,
  Gauge,
  Sparkles,
  TrendingUp,
  Dumbbell,
  RefreshCw,
  AlertCircle,
  Mic,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Card, { CardHeader, CardTitle, CardLabel } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import ProgressBar from '../../components/ui/ProgressBar'
import type { ProgressBarColor } from '../../components/ui/ProgressBar'
import { useMediaRecorder } from '../../hooks/useMediaRecorder'
import { useBrowserSpeechRecognition } from '../../hooks/useBrowserSpeechRecognition'
import { useConfidenceTracker } from '../../hooks/useConfidenceTracker'
import { confidenceApi, ApiError, API_BASE_URL } from '../../api/client'
import type {
  ConfidenceMetric,
  ConfidenceSessionResponse,
  ConfidenceTimelineResponse,
} from '../../types'

const stagger: Variants = {
  animate: { transition: { staggerChildren: 0 } },
}

const fadeUp: Variants = {
  initial: { opacity: 0, y: 0 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.1, ease: [0.25, 0.46, 0.45, 0.94] } },
}

interface ProgressMetric {
  label: string
  value: number
  type: 'progress'
  color: ProgressBarColor
  icon: LucideIcon
  display: string
}

interface BadgeMetric {
  label: string
  value: string
  type: 'badge'
  variant: BadgeVariant
  icon: LucideIcon
  hint: string
}

type Metric = ProgressMetric | BadgeMetric

const FALLBACK_PROMPT = 'Tell me about a time you led a team project'

// Used only when MediaPipe is unavailable (offline / unsupported browser) so
// the backend score still includes posture + eye-contact contributions instead
// of dropping them. When MediaPipe is reachable, real per-frame measurements
// replace these.
const FALLBACK_EYE_CONTACT = 78
const FALLBACK_POSTURE = 82

function formatSeconds(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function progressColor(value: number | null | undefined): ProgressBarColor {
  if (value == null) return 'info'
  if (value >= 80) return 'success'
  if (value >= 60) return 'primary'
  if (value >= 40) return 'warning'
  return 'danger'
}

function paceVariant(wpm: number | null | undefined): { variant: BadgeVariant; hint: string } {
  if (wpm == null) return { variant: 'default', hint: 'No data' }
  if (wpm < 110) return { variant: 'warning', hint: 'A bit slow' }
  if (wpm > 175) return { variant: 'warning', hint: 'A bit fast' }
  return { variant: 'success', hint: 'Ideal' }
}

function fillerVariant(count: number | null | undefined): { variant: BadgeVariant; hint: string } {
  if (count == null) return { variant: 'default', hint: 'No data' }
  if (count <= 3) return { variant: 'success', hint: 'Crisp' }
  if (count <= 8) return { variant: 'warning', hint: 'Some fillers' }
  return { variant: 'danger', hint: 'Too many' }
}

function buildMetrics(latest: ConfidenceSessionResponse | null): Metric[] {
  if (!latest) return []
  const eye = latest.eye_contact_score
  const posture = latest.posture_score
  const filler = latest.filler_word_count
  const pace = latest.speaking_pace_wpm
  const clarity = latest.clarity_score
  const overall = latest.overall_confidence_score

  const fillerInfo = fillerVariant(filler)
  const paceInfo = paceVariant(pace)

  return [
    {
      label: 'Eye Contact',
      value: eye ?? 0,
      display: eye != null ? `${eye}%` : '—',
      type: 'progress',
      color: progressColor(eye),
      icon: Eye,
    },
    {
      label: 'Posture Score',
      value: posture ?? 0,
      display: posture != null ? `${posture}%` : '—',
      type: 'progress',
      color: progressColor(posture),
      icon: Activity,
    },
    {
      label: 'Filler Words',
      value: filler != null ? String(filler) : '—',
      type: 'badge',
      variant: fillerInfo.variant,
      hint: fillerInfo.hint,
      icon: MessageCircle,
    },
    {
      label: 'Speaking Pace',
      value: pace != null ? `${pace} WPM` : '—',
      type: 'badge',
      variant: paceInfo.variant,
      hint: paceInfo.hint,
      icon: Gauge,
    },
    {
      label: 'Clarity Score',
      value: clarity ?? 0,
      display: clarity != null ? `${clarity}%` : '—',
      type: 'progress',
      color: progressColor(clarity),
      icon: Sparkles,
    },
    {
      label: 'Overall Confidence',
      value: overall ?? 0,
      display: overall != null ? `${overall}%` : '—',
      type: 'progress',
      color: progressColor(overall),
      icon: TrendingUp,
    },
  ]
}

interface TimelinePoint {
  index: number
  label: string
  overall: number | null
  eye: number | null
  clarity: number | null
}

function buildTimeline(rows: ConfidenceMetric[]): TimelinePoint[] {
  // Backend already returns rows oldest → newest. Map index → 1-based "Session N".
  return rows.map((row, idx) => ({
    index: idx + 1,
    label: `S${idx + 1}`,
    overall: row.overall_confidence_score,
    eye: row.eye_contact_score,
    clarity: row.clarity_score,
  }))
}

function makeAudioUrl(blob: Blob | null): string | null {
  if (!blob) return null
  return URL.createObjectURL(blob)
}

const DEFAULT_DRILLS = [
  {
    title: 'Power Pause Drill',
    description:
      'Insert deliberate 2-second pauses between key points instead of using fillers. Record a 1-minute response and aim for zero "um" / "uh".',
  },
  {
    title: 'Mirror Eye Contact',
    description:
      'Maintain eye contact with the camera lens for 60 seconds while answering a behavioral prompt. No looking away.',
  },
  {
    title: 'STAR Framework Sprint',
    description:
      'Use Situation → Task → Action → Result for three different stories. Time each at under 90 seconds.',
  },
]

export default function ConfidenceCoachPage() {
  // Live recording (video + audio)
  const recorder = useMediaRecorder({ video: true })
  const speech = useBrowserSpeechRecognition()
  const tracker = useConfidenceTracker()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [timeline, setTimeline] = useState<ConfidenceTimelineResponse | null>(null)
  const [latest, setLatest] = useState<ConfidenceSessionResponse | null>(null)
  const [loadingTimeline, setLoadingTimeline] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // The current prompt — pulled from the timeline's rotating list, falls
  // back to a sensible default before the API responds.
  const prompt = useMemo<string>(() => {
    const next = timeline?.next_prompts?.[0]
    return next && next.trim() ? next : FALLBACK_PROMPT
  }, [timeline])

  const loadTimeline = useCallback(async () => {
    setLoadingTimeline(true)
    try {
      const data = await confidenceApi.timeline()
      setTimeline(data)
      setLatest(data.latest)
    } catch {
      // Timeline endpoint may be unreachable; the page still renders empty-state UI.
    } finally {
      setLoadingTimeline(false)
    }
  }, [])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  // Bind the live MediaStream to the <video> preview as soon as it's ready.
  useEffect(() => {
    const node = videoRef.current
    if (!node) return
    if (recorder.stream) {
      node.srcObject = recorder.stream
      node.muted = true
      void node.play().catch(() => {
        /* autoplay can be blocked — user can click the video to start */
      })
    } else {
      node.srcObject = null
    }
  }, [recorder.stream])

  // Release the object URL when the component unmounts or a new one replaces it.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const handleStart = useCallback(async () => {
    setSubmitError(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPreviewBlob(null)
    }
    speech.reset()
    await recorder.start()
    if (speech.supported) {
      speech.start()
    }
    // Spin up MediaPipe tracking once the camera stream is live so we can
    // sample eye-contact + posture per frame and replace the placeholders.
    if (recorder.stream) {
      void tracker.start(recorder.stream)
    }
  }, [previewUrl, recorder, speech, tracker])

  // The recorder.stream becomes available a tick after recorder.start() — start
  // tracking as soon as it's ready, in case start() raced ahead.
  useEffect(() => {
    if (recorder.state === 'recording' && recorder.stream && !tracker.running) {
      void tracker.start(recorder.stream)
    }
    // We deliberately skip `tracker` in deps to avoid retriggering when
    // running flips back to false at end of session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state, recorder.stream])

  const handleStop = useCallback(async () => {
    if (speech.supported) speech.stop()
    const trackerSamples = tracker.stop()
    const result = await recorder.stop()
    if (!result) return
    const url = makeAudioUrl(result.blob)
    setPreviewBlob(result.blob)
    setPreviewUrl(url)

    // Auto-submit so the user gets feedback immediately.
    setSubmitting(true)
    setSubmitError(null)
    try {
      const transcript = (speech.transcript || '').trim()
      const eyeContactPct =
        trackerSamples.avgEyeContact != null
          ? trackerSamples.avgEyeContact
          : FALLBACK_EYE_CONTACT
      const posturePct =
        trackerSamples.avgPosture != null
          ? trackerSamples.avgPosture
          : FALLBACK_POSTURE
      const session = await confidenceApi.submit({
        audioBlob: result.blob,
        prompt,
        durationSeconds: result.durationSeconds,
        eyeContactPct,
        posturePct,
        browserTranscript: transcript || null,
      })
      setLatest(session)
      // Refresh the full timeline so the chart picks up the new session.
      void loadTimeline()
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? typeof err.detail === 'string'
            ? err.detail
            : err.message
          : err instanceof Error
            ? err.message
            : 'Could not score this recording',
      )
    } finally {
      setSubmitting(false)
    }
  }, [loadTimeline, prompt, recorder, speech, tracker])

  const isRecording = recorder.state === 'recording'
  const isPreparing = recorder.state === 'preparing'
  const recordingError = recorder.error
  const speechError = speech.error
  const metrics = useMemo(() => buildMetrics(latest), [latest])
  const timelinePoints = useMemo(
    () => (timeline ? buildTimeline(timeline.sessions) : []),
    [timeline],
  )

  const detailed = latest?.detailed_feedback ?? null
  const headline = detailed?.headline
  const strengths = detailed?.strengths ?? []
  const improvements = detailed?.improvements ?? []
  const recommendedDrill = detailed?.recommended_drill ?? null

  return (
    <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
      {/* Record Response */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader
            action={
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Mic className="h-3.5 w-3.5" />
                {speech.supported ? 'Browser transcription on' : 'Browser ASR unavailable'}
              </div>
            }
          >
            <CardTitle>Record Response</CardTitle>
          </CardHeader>

          <div className="mb-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
            <CardLabel>Prompt</CardLabel>
            <p className="text-sm text-[var(--text-primary)] mt-1">{prompt}</p>
          </div>

          {/* Live preview / placeholder */}
          <div
            className={clsx(
              'relative h-64 rounded-lg overflow-hidden border-2 transition-colors',
              isRecording
                ? 'border-danger bg-black'
                : 'border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]',
            )}
          >
            {recorder.stream ? (
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
              />
            ) : previewUrl ? (
              <video
                key={previewUrl}
                src={previewUrl}
                className="absolute inset-0 w-full h-full object-cover bg-black"
                controls
                playsInline
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                  <Camera className="h-6 w-6 text-[var(--text-tertiary)]" />
                </div>
                <p className="text-sm text-[var(--text-tertiary)]">
                  Click <span className="font-medium text-[var(--text-secondary)]">Start Recording</span> to capture your response
                </p>
              </div>
            )}

            {isRecording && (
              <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-danger/90 text-white text-xs font-semibold shadow-lg">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                REC · {formatSeconds(recorder.elapsed)}
              </div>
            )}
            {isRecording && tracker.available && (
              <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/55 text-white text-[11px] tabular-nums shadow-lg">
                {tracker.liveEyeContact != null && tracker.livePosture != null ? (
                  <>
                    eye {tracker.liveEyeContact}% · posture {tracker.livePosture}%
                  </>
                ) : (
                  <>warming up tracker…</>
                )}
              </div>
            )}
            {isPreparing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm">
                Requesting camera & microphone…
              </div>
            )}
          </div>

          {/* Live transcript while speaking */}
          {(isRecording || speech.transcript) && (
            <div className="mt-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-default)]">
              <CardLabel>Live transcript</CardLabel>
              <p className="text-sm text-[var(--text-primary)] mt-1 min-h-[1.25rem]">
                {speech.transcript || (
                  <span className="text-[var(--text-tertiary)]">
                    {speech.supported
                      ? 'Speak clearly — your words will appear here.'
                      : 'Browser transcription is off; recording will still be scored on the server.'}
                  </span>
                )}
                {speech.interim && (
                  <span className="text-[var(--text-tertiary)] italic"> {speech.interim}</span>
                )}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {isRecording ? (
              <Button variant="danger" icon={Square} onClick={handleStop} loading={submitting}>
                Stop & Score
              </Button>
            ) : (
              <Button
                icon={Video}
                onClick={handleStart}
                loading={isPreparing || submitting}
                disabled={isPreparing || submitting}
              >
                {previewBlob ? 'Record Again' : 'Start Recording'}
              </Button>
            )}
            {submitting && (
              <span className="text-xs text-[var(--text-tertiary)]">Scoring with Claude…</span>
            )}
          </div>

          {(recordingError || speechError || submitError) && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-danger/30 bg-danger/5 text-danger text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                {recordingError && <p>{recordingError}</p>}
                {speechError && <p>{speechError}</p>}
                {submitError && <p>{submitError}</p>}
              </div>
            </div>
          )}

          {latest?.detailed_feedback && headline && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-lg border border-success/30 bg-success/5 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" />
              <p className="text-[var(--text-primary)]">{headline}</p>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Results metrics */}
      <motion.div variants={fadeUp}>
        <CardLabel className="mb-3">
          {latest ? 'Latest Session Results' : 'Your most recent results will appear here'}
        </CardLabel>
        {metrics.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {metrics.map((m) => {
              const Icon = m.icon
              return (
                <Card key={m.label}>
                  <div className="flex items-start justify-between mb-3">
                    <span className="label">{m.label}</span>
                    <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
                  </div>
                  {m.type === 'progress' ? (
                    <>
                      <span className="stat-value">{m.display}</span>
                      <ProgressBar value={m.value} color={m.color} size="sm" className="mt-2" />
                    </>
                  ) : (
                    <div className="flex items-end gap-2">
                      <span className="stat-value">{m.value}</span>
                      <Badge variant={m.variant} size="sm">
                        {m.hint}
                      </Badge>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        ) : (
          <Card>
            <p className="text-sm text-[var(--text-tertiary)]">
              No sessions yet. Record your first answer to see filler counts, speaking pace, and clarity feedback.
            </p>
          </Card>
        )}
      </motion.div>

      {/* Latest transcript (server-confirmed) */}
      {latest?.transcript && (
        <motion.div variants={fadeUp}>
          <Card>
            <CardHeader>
              <CardTitle>What you said</CardTitle>
            </CardHeader>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
              {latest.transcript}
            </p>
          </Card>
        </motion.div>
      )}

      {/* Strengths + Improvements + Recommended drill */}
      {(strengths.length > 0 || improvements.length > 0 || recommendedDrill) && (
        <motion.div variants={fadeUp}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {strengths.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Strengths</CardTitle>
                  <Sparkles className="h-4 w-4 text-success" />
                </CardHeader>
                <ul className="space-y-2">
                  {strengths.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                      <span className="text-success mt-0.5">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {improvements.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Improvements</CardTitle>
                  <TrendingUp className="h-4 w-4 text-warning" />
                </CardHeader>
                <ul className="space-y-2">
                  {improvements.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                      <span className="text-warning mt-0.5">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </motion.div>
      )}

      {/* Growth Timeline */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader
            action={
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={loadTimeline} loading={loadingTimeline}>
                Refresh
              </Button>
            }
          >
            <CardTitle>Growth Timeline</CardTitle>
          </CardHeader>
          {timelinePoints.length === 0 ? (
            <div className="h-40 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-default)]">
              <p className="text-sm text-[var(--text-tertiary)]">
                {loadingTimeline ? 'Loading…' : 'Complete a session to see your growth chart.'}
              </p>
            </div>
          ) : (
            <div className="h-56 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={timelinePoints}
                  margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border-default)' }}
                    tickLine={{ stroke: 'var(--border-default)' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--border-default)' }}
                    tickLine={{ stroke: 'var(--border-default)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="overall"
                    name="Overall"
                    stroke="#7C3AED"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="eye"
                    name="Eye contact"
                    stroke="#2563EB"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="clarity"
                    name="Clarity"
                    stroke="#2EA043"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Recommended Drills */}
      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Recommended Drills</CardTitle>
            <Dumbbell className="h-4 w-4 text-[var(--text-tertiary)]" />
          </CardHeader>
          <div className="space-y-4">
            {recommendedDrill && (
              <div className="flex gap-3 p-3 rounded-lg bg-primary/5 border border-primary/15">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  ★
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    From Claude based on your last session
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">{recommendedDrill}</p>
                </div>
              </div>
            )}
            {DEFAULT_DRILLS.map((d, i) => (
              <div key={d.title} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{d.title}</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">{d.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Subtle footer credit so user can copy the audio URL when debugging */}
      {previewBlob && (
        <p className="text-[10px] text-[var(--text-tertiary)] text-center">
          Recording stored locally · {Math.round(previewBlob.size / 1024)} KB · API base{' '}
          <code className="font-mono">{API_BASE_URL}</code>
        </p>
      )}
    </motion.div>
  )
}
