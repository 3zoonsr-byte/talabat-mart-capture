'use client'

import { useState } from 'react'
import { Play, Square, RotateCcw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

interface ControlPanelProps {
  running: boolean
  defaultUrl: string
  defaultCategory: string
  defaultOutputDir: string
  onStart: (cfg: {
    url: string
    category: string
    outputDir: string
    proxy?: string
    headless: boolean
    maxScrollRounds: number
    settleMs: number
  }) => Promise<void>
  onStop: () => Promise<void>
  onReset: () => void
}

export function ControlPanel({
  running,
  defaultUrl,
  defaultCategory,
  defaultOutputDir,
  onStart,
  onStop,
  onReset,
}: ControlPanelProps) {
  const [url, setUrl] = useState(defaultUrl)
  const [category, setCategory] = useState(defaultCategory)
  const [outputDir, setOutputDir] = useState(defaultOutputDir)
  const [proxy, setProxy] = useState('')
  const [headless, setHeadless] = useState(true)
  const [maxScrollRounds, setMaxScrollRounds] = useState(20)
  const [settleMs, setSettleMs] = useState(3000)
  const [busy, setBusy] = useState(false)

  const handleStart = async () => {
    if (!url.trim().startsWith('http')) {
      toast.error('URL must start with http(s)://')
      return
    }
    setBusy(true)
    try {
      await onStart({
        url: url.trim(),
        category: category.trim(),
        outputDir: outputDir.trim(),
        proxy: proxy.trim() || undefined,
        headless,
        maxScrollRounds,
        settleMs,
      })
      toast.success('Capture started')
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to start')
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    setBusy(true)
    try {
      await onStop()
      toast.info('Stop signal sent')
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to stop')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Single capture</CardTitle>
        <CardDescription>
          Run one capture immediately. For batches, use the queue below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="url" className="text-xs">Category URL</Label>
          <Input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={running || busy}
            placeholder="https://www.talabat.com/egypt/talabat-mart/dairy-eggs/eggs"
            className="font-mono text-xs"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="category" className="text-xs">Leaf category</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={running || busy}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxscroll" className="text-xs">Max scroll rounds</Label>
            <Input
              id="maxscroll"
              type="number"
              min={1}
              max={100}
              value={maxScrollRounds}
              onChange={(e) =>
                setMaxScrollRounds(parseInt(e.target.value || '20', 10))
              }
              disabled={running || busy}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settle" className="text-xs">
            Settle delay before screenshot (ms)
          </Label>
          <Input
            id="settle"
            type="number"
            min={0}
            max={30000}
            step={500}
            value={settleMs}
            onChange={(e) =>
              setSettleMs(parseInt(e.target.value || '3000', 10))
            }
            disabled={running || busy}
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground">
            Waits for the image to fully paint before capturing. Prevents
            white/blank screenshots. 3000ms is the default.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="outputdir" className="text-xs">Output directory</Label>
          <Input
            id="outputdir"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            disabled={running || busy}
            className="font-mono text-xs"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="proxy" className="text-xs">
              Proxy (optional - Egypt residential)
            </Label>
            <Input
              id="proxy"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              disabled={running || busy}
              placeholder="http://user:pass@host:port"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-end">
            <div className="flex items-center gap-2 space-y-0">
              <Switch
                id="headless"
                checked={headless}
                onCheckedChange={setHeadless}
                disabled={running || busy}
              />
              <Label htmlFor="headless" className="text-xs">Headless mode</Label>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {running ? (
            <Button
              onClick={handleStop}
              disabled={busy}
              variant="destructive"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              Stop
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={busy}
              className="bg-orange-600 text-white hover:bg-orange-700"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start capture
            </Button>
          )}
          <Button variant="outline" onClick={onReset} disabled={running}>
            <RotateCcw className="h-4 w-4" />
            Reset view
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
