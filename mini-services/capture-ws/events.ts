/** Shared socket.io event types for the capture WS mini-service. */

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

export interface QueueItem {
  id: string
  url: string
  category: string
  outputDir: string
  proxy?: string
  headless: boolean
  maxScrollRounds: number
  settleMs: number
  status:
    | 'pending'
    | 'running'
    | 'done'
    | 'failed'
    | 'stopped'
    | 'skipped'
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

export interface ClientToServerEvents {
  'capture:get': () => void
  'queue:get': () => void
  'capture:event': (ev: CaptureEvent) => void
  'capture:end': () => void
  'queue:update': (payload: QueueState) => void
}

export interface ServerToClientEvents {
  'capture:event': (ev: CaptureEvent) => void
  'capture:snapshot': (snap: CaptureSnapshot) => void
  'queue:update': (payload: QueueState) => void
}
