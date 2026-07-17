'use client'

import { useEffect, useState } from 'react'
import { FileJson, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

interface ManifestViewerProps {
  category: string
  refreshKey: number
}

export function ManifestViewer({ category, refreshKey }: ManifestViewerProps) {
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(
          `/api/capture/manifest?category=${encodeURIComponent(category)}`,
          { cache: 'no-store' }
        )
        const j = await r.json()
        if (cancelled) return
        if (r.status === 404) {
          setManifest(null)
          setError(null)
        } else if (!r.ok || !j.ok) {
          setError(j.error || `HTTP ${r.status}`)
          setManifest(null)
        } else {
          setManifest(j.manifest)
          setError(null)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setLoading(true)
    load()
    return () => {
      cancelled = true
    }
  }, [category, refreshKey])

  const items = Array.isArray(manifest?.items) ? manifest.items : []
  const download = () => {
    if (!manifest) return
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${category}-manifest.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-orange-600" />
            Manifest
          </span>
          {manifest && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={download}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          )}
        </CardTitle>
        <CardDescription className="font-mono text-[10px]">
          {category}/manifest.json
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            loading...
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            {error}
          </div>
        ) : !manifest ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            No manifest yet for this category.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="captured" value={manifest.captured ?? items.length} />
              <Stat label="failed" value={manifest.failed_count ?? manifest.failed?.length ?? 0} />
              <Stat label="skipped" value={manifest.skipped_count ?? manifest.skipped?.length ?? 0} />
              <Stat label="total" value={manifest.total ?? 0} />
            </div>
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs">
                  {open ? 'Hide JSON' : 'Show JSON'}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-[10px] leading-relaxed">
                  {JSON.stringify(manifest, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/60 p-2 text-center">
      <div className="font-mono text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
