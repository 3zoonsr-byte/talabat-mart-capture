/**
 * In-memory store for the running capture process + the capture queue.
 *
 * Only one capture can run at a time. The store keeps:
 *   - the spawned ChildProcess
 *   - the socket.io-client connection used to forward events to the WS mini-service
 *   - basic state for /api/capture/status
 *   - a queue of pending captures that run one after another
 *
 * The actual event stream is forwarded to the WS mini-service on port 3003,
 * so the frontend never has to talk to this process directly - it just
 * listens on the WS.
 *
 * IMPORTANT: state lives on `globalThis` (see S()) so it survives
 * Next.js dev-mode module recompilation. Without this, every API route
 * would see its own empty copy of the state and the queue would break.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { io as ioc, type Socket } from 'socket.io-client'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const PYTHON = '/home/z/.venv/bin/python3'
const CAPTURE_SCRIPT = path.join(
  process.cwd(),
  'mini-services/capture-service/capture.py'
)
const WS_URL = 'http://localhost:3003' // internal - only used by this server

export interface CaptureConfig {
  url: string
  category: string
  outputDir: string
  proxy?: string
  headless: boolean
  maxScrollRounds: number
  settleMs: number
  maxPages: number
}

export type QueueItemStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'skipped'

export interface CaptureQueueItem extends CaptureConfig {
  id: string
  status: QueueItemStatus
  addedAt: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface CaptureStatus {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  pid: number | null
  config: CaptureConfig | null
  lastExitCode: number | null
  lastError: string | null
  queue: CaptureQueueItem[]
  queueActive: boolean
}

// ---------------------------------------------------------------------------
// State - stored on `globalThis` so it survives Next.js dev-mode module
// recompilation. Each route would otherwise get its own module instance with
// its own (empty) state, which breaks the queue.
// ---------------------------------------------------------------------------
interface CaptureStoreState {
  currentProcess: ChildProcess | null
  currentSocket: Socket | null
  currentConfig: CaptureConfig | null
  startedAt: string | null
  finishedAt: string | null
  lastExitCode: number | null
  lastError: string | null
  queue: CaptureQueueItem[]
  currentItem: CaptureQueueItem | null
  queueActive: boolean
  skipping: boolean
}

const GLOBAL_KEY = '__captureStore__'

function S(): CaptureStoreState {
  const g = globalThis as any
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      currentProcess: null,
      currentSocket: null,
      currentConfig: null,
      startedAt: null,
      finishedAt: null,
      lastExitCode: null,
      lastError: null,
      queue: [],
      currentItem: null,
      queueActive: false,
      skipping: false,
    } as CaptureStoreState
  }
  return g[GLOBAL_KEY] as CaptureStoreState
}

export function getStatus(): CaptureStatus {
  const s = S()
  return {
    running: s.currentProcess !== null && !s.currentProcess.killed,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    pid: s.currentProcess?.pid ?? null,
    config: s.currentConfig,
    lastExitCode: s.lastExitCode,
    lastError: s.lastError,
    queue: s.queue.map((q) => ({ ...q })),
    queueActive: s.queueActive,
  }
}

function ensureSocket(): Socket {
  const s = S()
  if (s.currentSocket && s.currentSocket.connected) return s.currentSocket
  if (s.currentSocket) {
    try {
      s.currentSocket.disconnect()
    } catch {
      /* ignore */
    }
    s.currentSocket = null
  }
  s.currentSocket = ioc(WS_URL, {
    // Default path '/socket.io/' matches the WS server config.
    auth: { role: 'producer' },
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 500,
  })
  s.currentSocket.on('connect_error', (err: Error) => {
    console.error('[capture-store] WS connect_error:', err.message)
  })
  return s.currentSocket
}

/** Broadcast the current queue so every connected frontend can re-render. */
function broadcastQueue(reason?: string): void {
  const s = S()
  const sock = s.currentSocket ?? ensureSocket()
  const payload = {
    items: s.queue.map((q) => ({ ...q })),
    current: s.currentItem ? { ...s.currentItem } : null,
    active: s.queueActive,
    reason: reason ?? 'update',
    at: new Date().toISOString(),
  }
  const emit = () => sock.emit('queue:update', payload)
  if (sock.connected) emit()
  else sock.once('connect', emit)
}

/**
 * Kill a child process gracefully: SIGTERM first, then SIGKILL after a short
 * grace period. The Python script translates SIGTERM -> KeyboardInterrupt so
 * it can emit a 'stopped' event, but Playwright can hang on cleanup, so we
 * fall back to SIGKILL to guarantee the queue can advance.
 */
function killProcess(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return
  try {
    proc.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  const pid = proc.pid
  setTimeout(() => {
    try {
      if (pid) process.kill(pid, 0) // throws if not running
      // Still alive - force kill.
      try {
        proc.kill('SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* already exited */
    }
  }, 1500)
}

/**
 * Spawn the Python child for one capture config and wire up stdout/stderr
 * forwarding to the WS mini-service. `onExit` is called exactly once when the
 * child exits (code, signal).
 */
function spawnCapture(
  cfg: CaptureConfig,
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void
): { ok: boolean; error?: string } {
  const s = S()
  if (s.currentProcess && !s.currentProcess.killed) {
    return { ok: false, error: 'A capture is already running.' }
  }
  if (!existsSync(CAPTURE_SCRIPT)) {
    return { ok: false, error: `Capture script not found: ${CAPTURE_SCRIPT}` }
  }
  mkdirSync(cfg.outputDir, { recursive: true })

  const args = [
    CAPTURE_SCRIPT,
    '--url', cfg.url,
    '--category', cfg.category,
    '--output-dir', cfg.outputDir,
    '--headless', cfg.headless ? 'true' : 'false',
    '--max-scroll-rounds', String(cfg.maxScrollRounds),
    '--settle-ms', String(cfg.settleMs ?? 3000),
    '--max-pages', String(cfg.maxPages ?? 50),
  ]
  if (cfg.proxy) args.push('--proxy', cfg.proxy)

  const sock = ensureSocket()

  const child = spawn(PYTHON, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  s.currentProcess = child
  s.currentConfig = cfg
  s.startedAt = new Date().toISOString()
  s.finishedAt = null
  s.lastExitCode = null
  s.lastError = null

  const stdout = createInterface({ input: child.stdout! })
  stdout.on('line', (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const ev = JSON.parse(trimmed)
      if (sock.connected) sock.emit('capture:event', ev)
      else sock.once('connect', () => sock.emit('capture:event', ev))
    } catch {
      if (sock.connected) {
        sock.emit('capture:event', {
          type: 'log',
          message: trimmed,
          at: new Date().toISOString(),
        })
      }
    }
  })

  const stderr = createInterface({ input: child.stderr! })
  stderr.on('line', (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (sock.connected) {
      sock.emit('capture:event', {
        type: 'log',
        level: 'stderr',
        message: trimmed,
        at: new Date().toISOString(),
      })
    }
    console.error('[capture.py:stderr]', trimmed)
  })

  child.on('error', (err: Error) => {
    S().lastError = `spawn error: ${err.message}`
    console.error('[capture-store] child error:', err)
  })

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    const st = S()
    st.lastExitCode = code
    st.finishedAt = new Date().toISOString()
    if (sock.connected) {
      sock.emit('capture:event', {
        type: 'process-exit',
        code,
        signal,
        at: st.finishedAt,
      })
      sock.emit('capture:end')
    }
    st.currentProcess = null
    console.log(
      `[capture-store] child exited code=${code} signal=${signal}`
    )
    onExit(code, signal)
  })

  return { ok: true }
}

/** Start a single (non-queued) capture. Refused if one is already running. */
export function startCapture(cfg: CaptureConfig): { ok: boolean; error?: string } {
  const s = S()
  if (s.currentProcess && !s.currentProcess.killed) {
    return { ok: false, error: 'A capture is already running.' }
  }
  s.queueActive = false
  s.skipping = false
  const res = spawnCapture(cfg, () => {
    // standalone run - nothing else to do
  })
  if (res.ok) broadcastQueue('standalone-start')
  return res
}

export function stopCapture(): { ok: boolean; error?: string } {
  const s = S()
  if (!s.currentProcess || s.currentProcess.killed) {
    return { ok: false, error: 'No capture is currently running.' }
  }
  try {
    s.queueActive = false
    s.skipping = false
    killProcess(s.currentProcess)
    const sock = s.currentSocket
    if (sock?.connected) {
      sock.emit('capture:event', {
        type: 'stopped',
        at: new Date().toISOString(),
      })
    }
    broadcastQueue('stop')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: `Failed to stop: ${e?.message ?? e}` }
  }
}

// ---------------------------------------------------------------------------
// Queue API
// ---------------------------------------------------------------------------

/**
 * Smart folder name from a Talabat URL.
 * Talabat URLs: https://www.talabat.com/ar/egypt/talabat-mart/<parent>/<sub>
 * We use `parent__sub` to avoid collisions (e.g. `ready-meals` exists under
 * both `frozen-food` and `ready-to-eat`).
 */
export function smartFolderFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const tmIdx = parts.findIndex((p) => p === 'talabat-mart')
    if (tmIdx >= 0 && tmIdx + 2 < parts.length) {
      const parent = parts[tmIdx + 1]
      const sub = parts[tmIdx + 2]
      return `${parent}__${sub}`
    }
    return parts[parts.length - 1] || 'category'
  } catch {
    return 'category'
  }
}

function leafCategoryFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || 'category'
  } catch {
    return 'category'
  }
}

function buildCfgFromPartial(
  p: Partial<CaptureConfig>,
  fallbackCategory?: string
): CaptureConfig {
  const url = (p.url || '').trim()
  const category = (p.category || fallbackCategory || smartFolderFromUrl(url)).trim()
  return {
    url,
    category,
    outputDir:
      (p.outputDir && p.outputDir.trim()) ||
      path.join(process.cwd(), 'output', category),
    proxy: p.proxy?.trim() || undefined,
    headless: p.headless ?? true,
    maxScrollRounds: p.maxScrollRounds ?? 20,
    settleMs: p.settleMs ?? 3000,
    maxPages: p.maxPages ?? 50,
  }
}

/**
 * Add one or more items to the queue. If nothing is currently running and the
 * queue is active, the first item is started immediately.
 */
export function enqueueCapture(
  items: Partial<CaptureConfig>[]
): { ok: boolean; added: CaptureQueueItem[]; error?: string } {
  const s = S()
  const added: CaptureQueueItem[] = []
  for (const p of items) {
    if (!p.url || !p.url.startsWith('http')) continue
    const cfg = buildCfgFromPartial(p)
    const item: CaptureQueueItem = {
      id: randomUUID(),
      ...cfg,
      status: 'pending',
      addedAt: new Date().toISOString(),
    }
    s.queue.push(item)
    added.push(item)
  }
  if (added.length === 0) {
    return { ok: false, added: [], error: 'No valid URLs provided.' }
  }
  s.queueActive = true
  s.skipping = false
  broadcastQueue('enqueue')
  if (!s.currentProcess) {
    processNextQueueItem()
  }
  return { ok: true, added }
}

/** Remove a pending item from the queue (cannot remove the running one). */
export function removeQueueItem(
  id: string
): { ok: boolean; error?: string } {
  const s = S()
  const idx = s.queue.findIndex((q) => q.id === id && q.status === 'pending')
  if (idx === -1) {
    return { ok: false, error: 'Item not found or not removable.' }
  }
  s.queue.splice(idx, 1)
  broadcastQueue('remove')
  return { ok: true }
}

/**
 * Clear finished/pending items. By default keeps the currently-running item.
 * If `includePending` is false, only done/failed/stopped/skipped are removed.
 */
export function clearQueue(
  includePending = true
): { ok: boolean; removed: number } {
  const s = S()
  const before = s.queue.length
  s.queue = s.queue.filter((q) => {
    if (q.status === 'running') return true // never drop the running one
    if (q.status === 'pending' && !includePending) return true
    return false
  })
  const removed = before - s.queue.length
  broadcastQueue('clear')
  return { ok: true, removed }
}

/** Re-activate the queue and, if idle, start the next pending item. */
export function resumeQueue(): { ok: boolean; error?: string } {
  const s = S()
  s.queueActive = true
  s.skipping = false
  broadcastQueue('resume')
  if (!s.currentProcess) processNextQueueItem()
  return { ok: true }
}

/** Stop the current item but immediately start the next pending one. */
export function skipCurrent(): { ok: boolean; error?: string } {
  const s = S()
  if (!s.currentProcess || s.currentProcess.killed) {
    s.queueActive = true
    if (!s.currentProcess) processNextQueueItem()
    return { ok: true }
  }
  try {
    s.skipping = true
    s.queueActive = true
    killProcess(s.currentProcess)
    broadcastQueue('skip')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: `Failed to skip: ${e?.message ?? e}` }
  }
}

/**
 * Mark the current item's final status, then start the next pending item if
 * the queue is active.
 */
function processNextQueueItem(): void {
  const s = S()
  if (s.currentProcess) return // safety: never spawn two

  if (!s.queueActive) {
    broadcastQueue('idle')
    return
  }
  const next = s.queue.find((q) => q.status === 'pending')
  if (!next) {
    s.currentItem = null
    broadcastQueue('drained')
    return
  }

  next.status = 'running'
  next.startedAt = new Date().toISOString()
  s.currentItem = next
  broadcastQueue('start-item')

  const cfg: CaptureConfig = {
    url: next.url,
    category: next.category,
    outputDir: next.outputDir,
    proxy: next.proxy,
    headless: next.headless,
    maxScrollRounds: next.maxScrollRounds,
    settleMs: next.settleMs,
    maxPages: next.maxPages,
  }

  const res = spawnCapture(cfg, (code, _signal) => {
    const st = S()
    if (st.currentItem) {
      st.currentItem.finishedAt = new Date().toISOString()
      if (st.skipping) {
        st.currentItem.status = 'skipped'
      } else if (!st.queueActive) {
        st.currentItem.status = 'stopped'
      } else if (code === 0) {
        st.currentItem.status = 'done'
      } else {
        st.currentItem.status = 'failed'
        st.currentItem.error = `exit code ${code}`
      }
    }
    st.skipping = false
    st.currentItem = null
    broadcastQueue('item-finished')
    if (st.queueActive) {
      setTimeout(() => processNextQueueItem(), 500)
    }
  })

  if (!res.ok) {
    const st = S()
    if (st.currentItem) {
      st.currentItem.status = 'failed'
      st.currentItem.error = res.error || 'spawn failed'
      st.currentItem.finishedAt = new Date().toISOString()
      st.currentItem = null
    }
    broadcastQueue('spawn-failed')
    setTimeout(() => processNextQueueItem(), 200)
  }
}
