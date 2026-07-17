'use client'

import { useEffect, useRef } from 'react'
import {
  Terminal,
  Trash2,
  Camera,
  XCircle,
  SkipForward,
  AlertTriangle,
  Navigation,
  Image as ImageIcon,
  Loader2,
  ScrollText,
  CheckCircle2,
  Package,
  Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CaptureEvent } from '@/hooks/use-capture-stream'

interface EventsLogProps {
  events: CaptureEvent[]
  onClear: () => void
}

const ICONS: Partial<Record<string, React.ReactNode>> = {
  start: <Play className="h-3 w-3 text-blue-500" />,
  total: <Package className="h-3 w-3 text-muted-foreground" />,
  'card-found': <Package className="h-3 w-3 text-muted-foreground" />,
  scroll: <ScrollText className="h-3 w-3 text-purple-500" />,
  navigate: <Navigation className="h-3 w-3 text-cyan-500" />,
  'image-found': <ImageIcon className="h-3 w-3 text-indigo-500" />,
  screenshot: <Camera className="h-3 w-3 text-green-500" />,
  log: <Terminal className="h-3 w-3 text-muted-foreground" />,
  warning: <AlertTriangle className="h-3 w-3 text-amber-500" />,
  error: <XCircle className="h-3 w-3 text-red-500" />,
  skip: <SkipForward className="h-3 w-3 text-amber-500" />,
  done: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  stopped: <SkipForward className="h-3 w-3 text-amber-500" />,
  'process-exit': <Terminal className="h-3 w-3 text-muted-foreground" />,
}

function describe(ev: CaptureEvent): string {
  switch (ev.type) {
    case 'start':
      return `started capture - ${ev.url}`
    case 'total':
      return `found ${ev.count} product cards`
    case 'card-found':
      return `card #${ev.index}: ${ev.name || '(no name)'} - ${ev.price || ''}`
    case 'scroll':
      return `scroll round ${ev.round} - height ${ev.height}px`
    case 'navigate':
      return `navigating to detail #${ev.index}`
    case 'image-found':
      return `hero image #${ev.index} - ${ev.naturalWidth}x${ev.naturalHeight}`
    case 'screenshot':
      return `saved ${ev.filename} - ${(ev.bytes / 1024).toFixed(1)} KB`
    case 'log':
      return ev.message
    case 'warning':
      return `warning: ${ev.message}`
    case 'error':
      return `error: ${ev.message}`
    case 'skip':
      return `skipped #${ev.index}: ${ev.reason}`
    case 'done':
      return `done - ${ev.captured} captured, ${ev.failed} failed, ${ev.skipped} skipped`
    case 'stopped':
      return `stopped: ${ev.reason || 'interrupted'}`
    case 'process-exit':
      return `process exited code=${ev.code}`
    default:
      return JSON.stringify(ev)
  }
}

export function EventsLog({ events, onClear }: EventsLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    stick.current = atBottom
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-orange-600" />
          <span className="text-sm font-semibold">Events log</span>
          <Badge variant="outline" className="text-[10px]">
            {events.length}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onClear}
          disabled={events.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {events.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            waiting for events...
          </div>
        ) : (
          <ul className="space-y-0.5">
            {events.map((ev, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded px-1.5 py-0.5 hover:bg-muted/40"
              >
                <span className="mt-0.5 shrink-0">
                  {ICONS[ev.type] ?? (
                    <Terminal className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {ev.at ? new Date(ev.at).toLocaleTimeString() : ''}
                </span>
                <span
                  className={
                    ev.type === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : ev.type === 'warning'
                        ? 'text-amber-600 dark:text-amber-400'
                        : ev.type === 'screenshot'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-foreground/90'
                  }
                >
                  {describe(ev)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
