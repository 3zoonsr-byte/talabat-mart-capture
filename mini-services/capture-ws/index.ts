/**
 * WebSocket mini-service for the Talabat Mart capture pipeline.
 *
 * Port: 3003 (bound on all interfaces so Caddy's reverse_proxy can reach it
 * whether the upstream resolves to 127.0.0.1 or ::1).
 *
 * Roles:
 *   - producer  : the Next.js API route (src/lib/capture-store.ts) connects
 *                 here with `auth.role='producer'` and forwards JSON-line
 *                 events from the Python child process.
 *   - consumer  : the browser (use-capture-stream hook) connects with no
 *                 special auth and listens for `capture:event` /
 *                 `capture:snapshot` / `queue:update`.
 *
 * Events:
 *   consumer -> server:
 *     capture:get      { }          ask for the latest snapshot
 *     queue:get        { }          ask for the latest queue state
 *   producer -> server:
 *     capture:event    {type, ...}  forward one Python event
 *     capture:end      { }          the current capture finished
 *     queue:update     {items, current, active, reason, at}
 *   server -> all consumers:
 *     capture:event    {type, ...}
 *     capture:snapshot {...status, events, at}
 *     queue:update     {items, current, active, reason, at}
 *
 * The server keeps a `latestSnapshot` (status + a ring buffer of the last
 * 400 events) and a `latestQueue` so a newly-connected consumer immediately
 * sees the current state.
 */

import { createServer } from 'node:http'
import { Server as IOServer, Socket as IOSocket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from './events'

const PORT = 3003
const MAX_EVENTS = 400

interface Snapshot {
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
  at: string
}

interface QueuePayload {
  items: any[]
  current: any | null
  active: boolean
  reason?: string
  at: string
}

const io = new IOServer<ClientToServerEvents, ServerToClientEvents>(
  createServer(),
  {
    // Default path is '/socket.io/' - matches the client hook config.
    cors: { origin: true, credentials: true },
    transports: ['polling', 'websocket'],
    maxHttpBufferSize: 5 * 1024 * 1024,
  }
)

const latestSnapshot: Snapshot = { status: 'idle', at: new Date().toISOString() }
const events: any[] = []
let latestQueue: QueuePayload | null = null
let producerSocketId: string | null = null

function pushEvent(ev: any): void {
  events.push(ev)
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  // Update snapshot counters based on event type.
  switch (ev?.type) {
    case 'start':
      latestSnapshot.status = 'running'
      latestSnapshot.url = ev.url
      latestSnapshot.category = ev.category
      latestSnapshot.outputDir = ev.output_dir
      latestSnapshot.settleMs = ev.settle_ms
      latestSnapshot.maxScrollRounds = ev.max_scroll_rounds
      latestSnapshot.startedAt = ev.at
      latestSnapshot.finishedAt = undefined
      latestSnapshot.captured = 0
      latestSnapshot.failed = 0
      latestSnapshot.skipped = 0
      latestSnapshot.total = 0
      latestSnapshot.lastError = undefined
      break
    case 'total':
      latestSnapshot.total = ev.count
      break
    case 'screenshot':
      latestSnapshot.captured = (latestSnapshot.captured || 0) + 1
      latestSnapshot.lastMessage = `saved ${ev.filename}`
      break
    case 'error':
      latestSnapshot.failed = (latestSnapshot.failed || 0) + 1
      latestSnapshot.lastError = ev.message
      latestSnapshot.lastMessage = ev.message
      break
    case 'skip':
      latestSnapshot.skipped = (latestSnapshot.skipped || 0) + 1
      break
    case 'done':
      latestSnapshot.status = 'idle'
      latestSnapshot.finishedAt = ev.at
      latestSnapshot.lastMessage = `done: ${ev.captured} captured, ${ev.failed} failed, ${ev.skipped} skipped`
      break
    case 'stopped':
      latestSnapshot.status = 'stopped'
      latestSnapshot.finishedAt = ev.at
      latestSnapshot.lastMessage = 'stopped by user'
      break
    case 'process-exit':
      if (latestSnapshot.status === 'running') {
        latestSnapshot.status = ev.code === 0 ? 'idle' : 'error'
        latestSnapshot.finishedAt = ev.at
      }
      break
    default:
      if (ev?.message) latestSnapshot.lastMessage = ev.message
  }
  latestSnapshot.at = ev?.at || new Date().toISOString()
}

io.on('connection', (socket: IOSocket) => {
  const role = (socket.handshake.auth as any)?.role
  console.log(`[capture-ws] connect ${socket.id} role=${role || 'consumer'}`)

  // Producer handshake: only one producer at a time. A new producer kicks the
  // stale one (this happens during Next.js dev-mode hot reload).
  if (role === 'producer') {
    if (producerSocketId && producerSocketId !== socket.id) {
      const old = io.sockets.sockets.get(producerSocketId)
      if (old) {
        console.log(
          `[capture-ws] kicking stale producer ${producerSocketId} in favor of ${socket.id}`
        )
        try {
          old.disconnect(true)
        } catch {
          /* ignore */
        }
      }
    }
    producerSocketId = socket.id
  }

  // Send the current state to the new consumer.
  socket.emit('capture:snapshot', {
    ...latestSnapshot,
    events: events.slice(-MAX_EVENTS),
  })
  if (latestQueue) socket.emit('queue:update', latestQueue)

  socket.on('capture:get', () => {
    socket.emit('capture:snapshot', {
      ...latestSnapshot,
      events: events.slice(-MAX_EVENTS),
    })
  })

  socket.on('queue:get', () => {
    if (latestQueue) socket.emit('queue:update', latestQueue)
  })

  // Producer -> server -> all consumers
  socket.on('capture:event', (ev: any) => {
    pushEvent(ev)
    socket.broadcast.emit('capture:event', ev)
  })

  socket.on('capture:end', () => {
    // No-op beyond what process-exit already does.
  })

  socket.on('queue:update', (payload: any) => {
    latestQueue = { ...payload, at: new Date().toISOString() }
    socket.broadcast.emit('queue:update', latestQueue)
  })

  socket.on('disconnect', (reason) => {
    console.log(`[capture-ws] disconnect ${socket.id} reason=${reason}`)
    if (producerSocketId === socket.id) producerSocketId = null
  })

  socket.on('error', (err: any) => {
    console.error(`[capture-ws] socket error ${socket.id}:`, err?.message || err)
  })
})

// Bind without a hostname so Bun listens on both IPv4 + IPv6 (Caddy's
// `localhost` may resolve to `::1`).
io.listen(PORT)
console.log(`[capture-ws] listening on :${PORT} (path '/', polling+websocket)`)
