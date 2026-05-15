/**
 * Holds an authenticated WebSocket to /api/v1/ws/notifications and pushes
 * inbound payloads into the notification store. Reconnects with exponential
 * backoff if the socket drops while the user is still authed.
 */
import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/authStore'
import {
  useNotificationStore,
  type NotificationKind,
} from '../store/notificationStore'
import { API_BASE_URL } from '../api/client'

interface ServerEvent {
  id?: string
  type?: string
  title?: string
  content?: string
  created_at?: string
  /** Server-side retry count if this is a redelivery; useful for debugging. */
  retry_count?: number
}

const KNOWN_KINDS: Record<string, NotificationKind> = {
  quiz_result: 'quiz_result',
  score_update: 'score_update',
  deadline_reminder: 'deadline_reminder',
  interview_feedback: 'interview_feedback',
  badge_earned: 'badge_earned',
  announcement: 'announcement',
  doubt_answered: 'doubt_answered',
}

function buildWsUrl(token: string): string {
  // API_BASE_URL is "http://host:8000/api/v1"; turn it into "ws[s]://host:8000/api/v1/ws/notifications".
  const u = new URL(API_BASE_URL, window.location.origin)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  // Make sure we land at /api/v1/ws/notifications regardless of trailing slashes.
  u.pathname = u.pathname.replace(/\/?$/, '') + '/ws/notifications'
  u.searchParams.set('token', token)
  return u.toString()
}

export function useNotificationsSocket(): void {
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const push = useNotificationStore((s) => s.push)

  const socketRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<number>(0)
  const reconnectTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!token || !userId) return undefined

    let cancelled = false

    const connect = () => {
      if (cancelled) return
      const ws = new WebSocket(buildWsUrl(token))
      socketRef.current = ws

      ws.onopen = () => {
        retryRef.current = 0
      }

      ws.onmessage = (ev) => {
        let data: ServerEvent | null = null
        try {
          data = JSON.parse(ev.data) as ServerEvent
        } catch {
          return
        }
        if (!data || !data.type) return
        if (data.type === '_connected') return
        const kind = KNOWN_KINDS[data.type] ?? 'system'
        push({
          id: data.id ?? `${kind}-${Date.now()}`,
          type: kind,
          title: data.title ?? 'CampusIQ',
          content: data.content ?? '',
          createdAt: data.created_at,
        })
        // TCP-style ACK back to the server so the delivery row flips from
        // SENT → ACKED and the retry loop stops trying. Only ACK when we
        // have a server-issued id (client-generated fallback ids would
        // never match a row server-side).
        if (data.id && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'ack', id: data.id }))
          } catch {
            // ignore — the retry loop will redeliver on backoff
          }
        }
      }

      ws.onclose = (ev) => {
        socketRef.current = null
        if (cancelled) return
        if (ev.code === 4401 || ev.code === 4403) {
          // auth failure — give up; the auth store change will retry.
          return
        }
        const delay = Math.min(15000, 500 * Math.pow(2, retryRef.current))
        retryRef.current += 1
        reconnectTimerRef.current = window.setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // The close handler will follow; nothing to do here.
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = socketRef.current
      if (ws) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
        socketRef.current = null
      }
    }
  }, [token, userId, push])
}
