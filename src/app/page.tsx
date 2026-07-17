'use client'

import { useCallback, useState } from 'react'
import {
  Egg,
  Github,
  ScrollText,
  Sparkles,
  Zap,
  ShieldCheck,
  Camera,
  Globe,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useCaptureStream } from '@/hooks/use-capture-stream'
import { StatusPill } from '@/components/capture/status-pill'
import { ControlPanel } from '@/components/capture/control-panel'
import { QueuePanel } from '@/components/capture/queue-panel'
import { ProgressCards } from '@/components/capture/progress-cards'
import { EventsLog } from '@/components/capture/events-log'
import { Gallery } from '@/components/capture/gallery'
import { ManifestViewer } from '@/components/capture/manifest-viewer'
import { QaChecklist } from '@/components/capture/qa-checklist'
import { OutputBrowser } from '@/components/capture/output-browser'

const DEFAULT_URL =
  'https://www.talabat.com/egypt/talabat-mart/dairy-eggs/eggs'
const DEFAULT_CATEGORY = 'eggs'
const DEFAULT_OUTPUT_DIR = '/home/z/my-project/output/eggs'

export default function Home() {
  const { connected, snapshot, events, queue, clear } = useCaptureStream()
  const [manualBump, setManualBump] = useState(0)

  const running = (snapshot?.status ?? 'idle') === 'running'

  // Derive the gallery/manifest/qa refresh key from the event log so they
  // re-fetch whenever a screenshot/done/error/stopped event lands.
  const interestingEventCount = events.reduce(
    (n, e) =>
      e.type === 'screenshot' ||
      e.type === 'done' ||
      e.type === 'error' ||
      e.type === 'stopped'
        ? n + 1
        : n,
    0
  )
  const galleryRefreshKey = manualBump + interestingEventCount

  const handleStart = useCallback(
    async (cfg: {
      url: string
      category: string
      outputDir: string
      proxy?: string
      headless: boolean
      maxScrollRounds: number
      settleMs: number
      maxPages: number
    }) => {
      const r = await fetch('/api/capture/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setManualBump((k) => k + 1)
    },
    []
  )

  const handleStop = useCallback(async () => {
    const r = await fetch('/api/capture/stop', { method: 'POST' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }, [])

  const handleReset = useCallback(() => {
    clear()
    setManualBump((k) => k + 1)
  }, [clear])

  // ---- Queue handlers ----
  const handleEnqueue = useCallback(
    async (items: Array<{
      url: string
      category: string
      outputDir: string
      headless: boolean
      maxScrollRounds: number
      settleMs: number
      maxPages: number
    }>) => {
      const r = await fetch('/api/capture/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setManualBump((k) => k + 1)
    },
    []
  )

  const handleRemoveQueueItem = useCallback(async (id: string) => {
    const r = await fetch(`/api/capture/queue/${id}`, { method: 'DELETE' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }, [])

  const handleClearQueue = useCallback(async (includePending: boolean) => {
    const r = await fetch(
      `/api/capture/queue?pending=${includePending ? 'true' : 'false'}`,
      { method: 'DELETE' }
    )
    const j = await r.json()
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }, [])

  const handleSkip = useCallback(async () => {
    const r = await fetch('/api/capture/queue/skip', { method: 'POST' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }, [])

  const handleResume = useCallback(async () => {
    const r = await fetch('/api/capture/queue/resume', { method: 'POST' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      throw new Error(j.error || `HTTP ${r.status}`)
    }
  }, [])

  const currentCategory = snapshot?.category || DEFAULT_CATEGORY

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-orange-50/40 via-background to-background dark:from-orange-950/10">
      {/* ---------------- Header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-orange-600 text-white shadow-sm">
              <Egg className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold">
                Talabat Mart Capture
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Product screenshot pipeline
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://www.talabat.com/egypt/talabat-mart/dairy-eggs/eggs"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex"
            >
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5 px-2 py-1 text-[11px]"
              >
                <Globe className="h-3 w-3" />
                talabat.com
              </Badge>
            </a>
            <StatusPill connected={connected} />
          </div>
        </div>
      </header>

      {/* ---------------- Main ---------------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        {/* Hero */}
        <section className="overflow-hidden rounded-xl border border-orange-200/60 bg-gradient-to-br from-orange-50 via-orange-50/40 to-background p-6 dark:border-orange-900/40 dark:from-orange-950/30 dark:via-orange-950/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="gap-1.5 border-orange-300 bg-orange-100/60 px-2 py-0.5 text-[11px] font-medium text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200"
              >
                <Sparkles className="h-3 w-3" />
                Egypt - ar-EG
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Capture every product image, cleanly.
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Walks every page of a Talabat Mart category (pagination-aware),
                collects every product card, then for each one navigates to its
                detail page, waits for the hero image (no{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">+</code>{' '}
                overlay), screenshots the raw{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">&lt;img&gt;</code>,
                and writes one PNG per product named after the on-screen name.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-1 sm:gap-1.5">
              <FeaturePill icon={<Camera className="h-3 w-3" />} label="Hero <img> only" />
              <FeaturePill icon={<Zap className="h-3 w-3" />} label="Live WebSocket events" />
              <FeaturePill icon={<ShieldCheck className="h-3 w-3" />} label="Auto QA checklist" />
            </div>
          </div>
        </section>

        {/* Control + progress */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ControlPanel
            running={running}
            defaultUrl={DEFAULT_URL}
            defaultCategory={DEFAULT_CATEGORY}
            defaultOutputDir={DEFAULT_OUTPUT_DIR}
            onStart={handleStart}
            onStop={handleStop}
            onReset={handleReset}
          />
          <ProgressCards snapshot={snapshot} />
        </section>

        {/* Capture queue */}
        <QueuePanel
          queue={queue}
          running={running}
          onEnqueue={handleEnqueue}
          onRemove={handleRemoveQueueItem}
          onClear={handleClearQueue}
          onSkip={handleSkip}
          onResume={handleResume}
        />

        {/* Output browser — image counts + download all as ZIP */}
        <OutputBrowser refreshKey={galleryRefreshKey} />

        {/* Events log */}
        <EventsLog events={events} onClear={clear} />

        {/* Gallery */}
        <Gallery
          category={currentCategory}
          refreshKey={galleryRefreshKey}
          running={running}
        />

        {/* Manifest + QA */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ManifestViewer
            category={currentCategory}
            refreshKey={galleryRefreshKey}
          />
          <QaChecklist
            category={currentCategory}
            refreshKey={galleryRefreshKey}
            running={running}
          />
        </section>

        {/* Spec reference */}
        <section className="rounded-xl border border-border/60 bg-card p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
              <ScrollText className="h-4 w-4 text-orange-600" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">About this implementation</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The capture engine is a Python script (
                <code className="font-mono">mini-services/capture-service/capture.py</code>)
                using Playwright: bootstrap → launch Chromium (1440×900, DPR 2,
                ar-EG, Africa/Cairo) → navigate → hydrate → scroll to bottom
                → for each card, extract name/price/href → navigate to detail
                page → wait for hero{' '}
                <code className="font-mono">&lt;img&gt;</code>{' '}
                <code className="font-mono">naturalWidth&gt;0</code> → settle
                (paint flush) → screenshot → return to category → re-query
                cards. Events stream as newline-delimited JSON over stdout →
                Next.js API route forwards them over a socket.io mini-service
                (port 3003) → this UI.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                <SpecTag>Python 3 - Playwright</SpecTag>
                <SpecTag>Chromium headless</SpecTag>
                <SpecTag>viewport 1440x900 - DPR 2</SpecTag>
                <SpecTag>locale ar-EG - tz Africa/Cairo</SpecTag>
                <SpecTag>filename sanitization</SpecTag>
                <SpecTag>Cloudflare + login-aware</SpecTag>
                <SpecTag>Queue: parent__sub folders</SpecTag>
                <SpecTag>Pagination: all pages</SpecTag>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---------------- Footer (sticky bottom) ---------------- */}
      <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Talabat Mart Capture</span>
            <span>-</span>
            <span>screenshot pipeline</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono">
              output: /home/z/my-project/output/{currentCategory}/
            </span>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <Github className="h-3 w-3" />
              source
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeaturePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-200/60 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground/80 dark:border-orange-900/40">
      <span className="text-orange-600">{icon}</span>
      {label}
    </div>
  )
}

function SpecTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}
