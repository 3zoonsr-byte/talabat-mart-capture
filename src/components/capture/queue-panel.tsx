'use client'

import { useRef, useState } from 'react'
import {
  ListOrdered,
  Plus,
  Trash2,
  Play,
  SkipForward,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  PauseCircle,
  RotateCcw,
  Folder,
  FileJson,
  Eraser,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'
import type {
  QueueState,
  QueueItem,
  QueueItemStatus,
} from '@/hooks/use-capture-stream'

interface QueuePanelProps {
  queue: QueueState | null
  running: boolean
  onEnqueue: (items: Array<{
    url: string
    category: string
    outputDir: string
    headless: boolean
    maxScrollRounds: number
    settleMs: number
    maxPages: number
  }>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClear: (includePending: boolean) => Promise<void>
  onSkip: () => Promise<void>
  onResume: () => Promise<void>
}

const STATUS_META: Record<
  QueueItemStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  pending: {
    label: 'Pending',
    icon: <Clock className="h-3.5 w-3.5" />,
    className:
      'border-border/60 bg-muted/40 text-muted-foreground',
  },
  running: {
    label: 'Running',
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    className:
      'border-orange-300 bg-orange-100/70 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200',
  },
  done: {
    label: 'Done',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className:
      'border-green-300 bg-green-100/70 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200',
  },
  failed: {
    label: 'Failed',
    icon: <XCircle className="h-3.5 w-3.5" />,
    className:
      'border-red-300 bg-red-100/70 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200',
  },
  stopped: {
    label: 'Stopped',
    icon: <PauseCircle className="h-3.5 w-3.5" />,
    className:
      'border-amber-300 bg-amber-100/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  },
  skipped: {
    label: 'Skipped',
    icon: <SkipForward className="h-3.5 w-3.5" />,
    className:
      'border-zinc-300 bg-zinc-100/70 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300',
  },
}

/**
 * Smart folder name from a Talabat URL.
 * Talabat URLs: .../talabat-mart/<parent>/<sub>
 * We use `parent__sub` to avoid collisions (e.g. `ready-meals` exists under
 * both `frozen-food` and `ready-to-eat`).
 */
function smartFolderFromUrl(url: string): string {
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

/**
 * Parse a JSON or plain-text file into a list of {url, category?}.
 * Supports:
 *  1. `{ "Category": [{ "name", "url" }] }` (categories.txt format)
 *  2. `[{ "url" }, ...]`
 *  3. `[{ "url", "category" }, ...]`
 *  4. Plain text, one URL per line
 */
function parseFileContent(
  content: string
): Array<{ url: string; category?: string }> {
  try {
    const data = JSON.parse(content)
    const out: Array<{ url: string; category?: string }> = []
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && typeof item.url === 'string') {
          out.push({ url: item.url, category: item.category })
        }
      }
    } else if (data && typeof data === 'object') {
      for (const items of Object.values(data as Record<string, unknown>)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            if (
              item &&
              typeof item === 'object' &&
              typeof (item as any).url === 'string'
            ) {
              out.push({
                url: (item as any).url,
                category: (item as any).category,
              })
            }
          }
        }
      }
    }
    if (out.length > 0) return out
  } catch {
    // not JSON - fall through
  }
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http'))
  return lines.map((url) => ({ url }))
}

export function QueuePanel({
  queue,
  running,
  onEnqueue,
  onRemove,
  onClear,
  onSkip,
  onResume,
}: QueuePanelProps) {
  const [rows, setRows] = useState<
    Array<{ key: string; url: string; category: string }>
  >([
    {
      key: Math.random().toString(36).slice(2),
      url: '',
      category: '',
    },
  ])
  const [headless, setHeadless] = useState(true)
  const [maxScrollRounds, setMaxScrollRounds] = useState(20)
  const [settleMs, setSettleMs] = useState(3000)
  const [maxPages, setMaxPages] = useState(50)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const items = queue?.items ?? []
  const active = queue?.active ?? false
  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1
      return acc
    },
    {} as Record<QueueItemStatus, number>
  )

  const updateRow = (key: string, field: 'url' | 'category', val: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        const next = { ...r, [field]: val }
        if (field === 'url' && !r.category) {
          next.category = smartFolderFromUrl(val)
        }
        return next
      })
    )
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { key: Math.random().toString(36).slice(2), url: '', category: '' },
    ])
  }

  const removeRow = (key: string) => {
    setRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)
    )
  }

  const clearRows = () => {
    setRows([
      { key: Math.random().toString(36).slice(2), url: '', category: '' },
    ])
  }

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseFileContent(text)
      if (parsed.length === 0) {
        toast.error('No URLs found in the file')
        return
      }
      const newRows = parsed.map((p) => ({
        key: Math.random().toString(36).slice(2),
        url: p.url,
        category: (p.category || smartFolderFromUrl(p.url)).trim(),
      }))
      setRows((prev) => {
        const nonEmpty = prev.filter((r) => r.url.trim() !== '')
        return [...nonEmpty, ...newRows]
      })
      toast.success(
        `Loaded ${newRows.length} URL(s) from ${file.name} - review and click "Add to queue"`
      )
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to read file')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleEnqueue = async () => {
    const valid = rows.filter((r) => r.url.trim().startsWith('http'))
    if (valid.length === 0) {
      toast.error('Add at least one URL starting with http(s)://')
      return
    }
    setBusy(true)
    try {
      const payload = valid.map((r) => ({
        url: r.url.trim(),
        category: (r.category || smartFolderFromUrl(r.url)).trim(),
        outputDir: `/home/z/my-project/output/${
          (r.category || smartFolderFromUrl(r.url)).trim()
        }`,
        headless,
        maxScrollRounds,
        settleMs,
        maxPages,
      }))
      await onEnqueue(payload)
      toast.success(`Added ${payload.length} item(s) to the queue`)
      setRows([
        { key: Math.random().toString(36).slice(2), url: '', category: '' },
      ])
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to enqueue')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await onRemove(id)
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to remove')
    }
  }

  const handleClearFinished = async () => {
    setBusy(true)
    try {
      await onClear(false)
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to clear')
    } finally {
      setBusy(false)
    }
  }

  const handleClearAll = async () => {
    setBusy(true)
    try {
      await onClear(true)
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to clear')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-orange-200/60 dark:border-orange-900/40">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-orange-600" />
            Capture Queue
          </span>
          {active ? (
            <Badge className="border-orange-300 bg-orange-100/70 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              processing
            </Badge>
          ) : items.length > 0 ? (
            <Badge variant="outline" className="text-muted-foreground">
              paused
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Add multiple category URLs - each saves into its own folder. The
          queue runs them one after another automatically. Folder names use
          `parent__sub` so subcategories that share a name never collide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ---- Composer ---- */}
        <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-medium">
              Add links to the queue
              {rows.some((r) => r.url.trim()) && (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  ({rows.filter((r) => r.url.trim().startsWith('http')).length} ready)
                </span>
              )}
            </Label>
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.txt,application/json,text/plain"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileJson className="h-3.5 w-3.5" />
                Load JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={clearRows}
                disabled={!rows.some((r) => r.url.trim())}
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear rows
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={addRow}
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </Button>
            </div>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={r.key} className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-right text-[11px] font-mono text-muted-foreground">
                  {i + 1}.
                </span>
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
                  <Input
                    value={r.url}
                    onChange={(e) => updateRow(r.key, 'url', e.target.value)}
                    placeholder="https://www.talabat.com/egypt/talabat-mart/.../eggs"
                    className="font-mono text-xs"
                  />
                  <div className="relative">
                    <Folder className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={r.category}
                      onChange={(e) =>
                        updateRow(r.key, 'category', e.target.value)
                      }
                      placeholder="folder name"
                      className="pl-7 font-mono text-xs"
                    />
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(r.key)}
                  disabled={rows.length <= 1}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Shared options */}
          <div className="grid grid-cols-1 gap-2 border-t border-border/60 pt-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Scroll rounds
              </Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={maxScrollRounds}
                onChange={(e) =>
                  setMaxScrollRounds(parseInt(e.target.value || '20', 10))
                }
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Settle (ms)
              </Label>
              <Input
                type="number"
                min={0}
                max={30000}
                step={500}
                value={settleMs}
                onChange={(e) =>
                  setSettleMs(parseInt(e.target.value || '3000', 10))
                }
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Max pages
              </Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={(e) =>
                  setMaxPages(parseInt(e.target.value || '50', 10))
                }
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <label className="flex h-8 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Headless
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={handleEnqueue}
              disabled={busy || running}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add to queue
            </Button>
            {items.length > 0 && !active && (
              <Button variant="outline" onClick={onResume} disabled={busy}>
                <Play className="h-4 w-4" />
                {running ? 'Resume next' : 'Start queue'}
              </Button>
            )}
          </div>
        </div>

        {/* ---- Queue list ---- */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge variant="outline" className="gap-1 text-[11px]">
                {items.length} total
              </Badge>
              {counts.running ? (
                <Badge className="gap-1 border-orange-300 bg-orange-100/70 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200">
                  {counts.running} running
                </Badge>
              ) : null}
              {counts.pending ? (
                <Badge variant="outline" className="gap-1 text-[11px]">
                  {counts.pending} pending
                </Badge>
              ) : null}
              {counts.done ? (
                <Badge className="gap-1 border-green-300 bg-green-100/70 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200">
                  {counts.done} done
                </Badge>
              ) : null}
              {counts.failed ? (
                <Badge className="gap-1 border-red-300 bg-red-100/70 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200">
                  {counts.failed} failed
                </Badge>
              ) : null}
              {counts.skipped ? (
                <Badge variant="outline" className="gap-1 text-[11px]">
                  {counts.skipped} skipped
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {running && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={onSkip}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Skip current
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={handleClearFinished}
                disabled={busy || items.length === 0}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear finished
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={handleClearAll}
                disabled={busy || items.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear all
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              The queue is empty. Add one or more links above to begin, or load
              a JSON file.
            </div>
          ) : (
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {items.map((it) => (
                <QueueRow
                  key={it.id}
                  item={it}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function QueueRow({
  item,
  onRemove,
}: {
  item: QueueItem
  onRemove: (id: string) => Promise<void>
}) {
  const meta = STATUS_META[item.status]
  const removable = item.status === 'pending'
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-card/60 p-2.5">
      <Badge
        variant="outline"
        className={`shrink-0 gap-1 px-1.5 py-0.5 text-[10px] ${meta.className}`}
      >
        {meta.icon}
        {meta.label}
      </Badge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-mono text-[11px] leading-tight text-foreground">
          {item.url}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Folder className="h-3 w-3" />
            <span className="font-mono">{item.category}</span>
          </span>
          <span className="font-mono">→ {item.outputDir}</span>
          {item.settleMs ? (
            <span className="font-mono">settle {item.settleMs}ms</span>
          ) : null}
          {item.startedAt ? (
            <span>
              started {new Date(item.startedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {item.error ? (
            <span className="text-destructive">{item.error}</span>
          ) : null}
        </div>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(item.id)}
        disabled={!removable}
        aria-label="Remove from queue"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
