'use client'

/**
 * Hook: connect to the capture WS mini-service on port 3003 and expose:
 *   - connected  : boolean (socket connected?)
 *   - snapshot   : CaptureSnapshot (latest status + counters)
 *   - events     : CaptureEvent[] (ring buffer of last events)
 *   - queue      : QueueState (current queue items + active flag)
 *   - clear      : () => void (clear the local event log)
 *
 * Caddy gateway: the browser connects to `/socket.io/?XTransformPort=3003`
 * via polling transport (Caddy sometimes drops the WS upgrade headers).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'

export interface CaptureEvent {
  type:
    | 'start'
    | 'total'
    | 'card-found'
    | 'scroll'
    | 'navigate'
    | 'image-found'
    | 'screenshot'
    | 'log'
    | 'warning'
    | 'error'
    | 'skip'
    | 'done'
    | 'stopped'
    | 'process-exit'
  [k: string]: any
  at?: string
}

export interface CaptureSnapshot {
  status: 'idle' | 'running' | 'stopped' | 'error' | 'unknown'
  category?: string
  url?: string
  outputDir?: string
  captured?: number
  failed?: number
  skipped?: number
  total?: number
  startedAt?: string
  finishedAt?: string
  lastMessage?: string
  lastError?: string
  pid?: number
  settleMs?: number
  maxScrollRounds?: number
  events?: CaptureEvent[]
  at: string
}

export type QueueItemStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'skipped'

export interface QueueItem {
  id: string
  url: string
  category: string
  outputDir: string
  proxy?: string
  headless: boolean
  maxScrollRounds: number
  settleMs: number
  status: QueueItemStatus
  addedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface QueueState {
  items: QueueItem[]
  current?: QueueItem | null
  active: boolean
  reason?: string
  at: string
}

const MAX_EVENTS = 400

export function useCaptureStream() {
  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | null>(null)
  const [events, setEvents] = useState<CaptureEvent[]>([])
  const [queue, setQueue] = useState<QueueState | null>(null)
  const sockRef = useRef<Socket | null>(null)

  useEffect(() => {
    // Connect to the WS mini-service via the Caddy gateway.
    // Path '/socket.io/' is socket.io's default; the query ?XTransformPort=3003
    // tells Caddy to reverse-proxy to port 3003.
    const sock = io('/?XTransformPort=3003', {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    })
    sockRef.current = sock

    const onConnect = () => {
      setConnected(true)
      sock.emit('capture:get')
      sock.emit('queue:get')
    }
    const onDisconnect = () => setConnected(false)
    const onSnapshot = (snap: CaptureSnapshot) => {
      setSnapshot(snap)
      if (Array.isArray(snap.events) && snap.events.length > 0) {
        setEvents((prev) => {
          const merged = [...prev, ...snap.events!]
          return merged.length > MAX_EVENTS
            ? merged.slice(merged.length - MAX_EVENTS)
            : merged
        })
      }
    }
    const onEvent = (ev: CaptureEvent) => {
      setEvents((prev) => {
        const next = [...prev, ev]
        return next.length > MAX_EVENTS
          ? next.slice(next.length - MAX_EVENTS)
          : next
      })
      // Update local snapshot counters for instant UI feedback (the server
      // also sends snapshots, but events arrive faster).
      setSnapshot((prev) => {
        if (!prev) return prev
        const next = { ...prev }
        switch (ev.type) {
          case 'start':
            next.status = 'running'
            next.url = ev.url
            next.category = ev.category
            next.outputDir = ev.output_dir
            next.settleMs = ev.settle_ms
            next.maxScrollRounds = ev.max_scroll_rounds
            next.startedAt = ev.at
            next.finishedAt = undefined
            next.captured = 0
            next.failed = 0
            next.skipped = 0
            next.total = 0
            next.lastError = undefined
            break
          case 'total':
            next.total = ev.count
            break
          case 'screenshot':
            next.captured = (next.captured || 0) + 1
            next.lastMessage = `saved ${ev.filename}`
            break
          case 'error':
            next.failed = (next.failed || 0) + 1
            next.lastError = ev.message
            next.lastMessage = ev.message
            break
          case 'skip':
            next.skipped = (next.skipped || 0) + 1
            break
          case 'done':
            next.status = 'idle'
            next.finishedAt = ev.at
            next.lastMessage = `done: ${ev.captured} captured, ${ev.failed} failed, ${ev.skipped} skipped`
            break
          case 'stopped':
            next.status = 'stopped'
            next.finishedAt = ev.at
            next.lastMessage = 'stopped by user'
            break
          case 'process-exit':
            if (next.status === 'running') {
              next.status = ev.code === 0 ? 'idle' : 'error'
              next.finishedAt = ev.at
            }
            break
          default:
            if (ev.message) next.lastMessage = ev.message
        }
        next.at = ev.at || new Date().toISOString()
        return next
      })
    }
    const onQueue = (q: QueueState) => setQueue(q)

    sock.on('connect', onConnect)
    sock.on('disconnect', onDisconnect)
    sock.on('connect_error', () => setConnected(false))
    sock.on('capture:snapshot', onSnapshot)
    sock.on('capture:event', onEvent)
    sock.on('queue:update', onQueue)

    return () => {
      sock.off('connect', onConnect)
      sock.off('disconnect', onDisconnect)
      sock.off('connect_error', () => setConnected(false))
      sock.off('capture:snapshot', onSnapshot)
      sock.off('capture:event', onEvent)
      sock.off('queue:update', onQueue)
      try {
        sock.disconnect()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const clear = useCallback(() => setEvents([]), [])

  return { connected, snapshot, events, queue, clear }
}
