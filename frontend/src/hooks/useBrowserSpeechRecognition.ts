import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Wrapper around the Web Speech API (Chrome's `webkitSpeechRecognition`)
 * for browser-side transcription. When available, this lets us skip the
 * server-side Whisper round-trip (and therefore skip the OpenAI cost)
 * while still getting reasonably accurate text for filler counting,
 * WPM calculation, and Claude-based clarity scoring.
 *
 * Usage:
 *   const { supported, transcript, start, stop, reset } = useBrowserSpeechRecognition()
 *   start() when recording begins, stop() when it ends, then POST the
 *   resulting `transcript` to the backend as `browser_transcript`.
 *
 * NOTE: Firefox and Safari don't expose this API. Call `supported` before
 * wiring any UI that depends on it — the voice interview / confidence
 * coach will fall back to server-side Whisper when supported is false.
 */

// TS doesn't ship types for the non-standard SpeechRecognition interface.
// We declare the bits we touch so the code type-checks without `any`.
interface SpeechRecognitionResult {
  isFinal: boolean
  readonly length: number
  [index: number]: { transcript: string; confidence: number }
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}
interface SpeechRecognitionType extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionType

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface UseBrowserSpeechRecognitionReturn {
  supported: boolean
  listening: boolean
  transcript: string
  interim: string
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
}

export function useBrowserSpeechRecognition(): UseBrowserSpeechRecognitionReturn {
  const [supported] = useState<boolean>(() => getSpeechRecognitionCtor() !== null)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionType | null>(null)
  // Accumulate all final segments across one session.
  const finalBufferRef = useRef<string>('')
  // Set to true when the caller WANTS continuous listening (e.g. during a
  // voice recording). If Chrome auto-stops SR mid-recording, the `onend`
  // handler restarts it without resetting the buffer.
  const wantContinuousRef = useRef<boolean>(false)

  const reset = useCallback(() => {
    setTranscript('')
    setInterim('')
    setError(null)
    finalBufferRef.current = ''
  }, [])

  const launchRecognition = useCallback((preserveBuffer: boolean) => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setError('Browser speech recognition is not supported in this browser')
      return
    }
    if (recognitionRef.current) return  // already running
    if (!preserveBuffer) reset()

    const recog = new Ctor()
    recog.continuous = true
    recog.interimResults = true
    recog.lang = 'en-US'

    recog.onresult = (event) => {
      let interimStr = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result?.[0]?.transcript ?? ''
        if (result?.isFinal) {
          finalBufferRef.current = (finalBufferRef.current + ' ' + text).trim()
        } else {
          interimStr += text
        }
      }
      setTranscript(finalBufferRef.current)
      setInterim(interimStr)
    }

    recog.onerror = (event) => {
      // "no-speech" is benign — user just hasn't started talking yet
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.message || event.error || 'Speech recognition error')
      }
    }

    recog.onend = () => {
      setListening(false)
      recognitionRef.current = null
      // Chrome auto-stops SR after a stretch of silence or competing audio
      // consumers (MediaRecorder). When the caller asked for continuous
      // listening, restart it without dropping the accumulated buffer.
      if (wantContinuousRef.current) {
        // Slight delay so we don't busy-loop if start() also fails.
        window.setTimeout(() => {
          if (wantContinuousRef.current && !recognitionRef.current) {
            launchRecognition(/* preserveBuffer */ true)
          }
        }, 200)
      }
    }

    try {
      recog.start()
      recognitionRef.current = recog
      setListening(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start speech recognition')
      recognitionRef.current = null
    }
  }, [reset])

  const start = useCallback(() => {
    wantContinuousRef.current = true
    launchRecognition(/* preserveBuffer */ false)
  }, [launchRecognition])

  const stop = useCallback(() => {
    // Tell the auto-restart logic to NOT restart this time.
    wantContinuousRef.current = false
    const recog = recognitionRef.current
    if (recog) {
      try {
        recog.stop()
      } catch {
        // already stopped
      }
    }
    setInterim('')
    setListening(false)
  }, [])

  // Release recognition if the component unmounts mid-recording
  useEffect(() => {
    return () => {
      const recog = recognitionRef.current
      if (recog) {
        try {
          recog.abort()
        } catch {
          // ignore
        }
      }
    }
  }, [])

  return { supported, listening, transcript, interim, error, start, stop, reset }
}
