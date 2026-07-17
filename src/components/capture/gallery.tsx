'use client'

import { useEffect, useState } from 'react'
import { Image as ImageIcon, Loader2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface FileItem {
  name: string
  size: number
  mtime: string
}

interface GalleryProps {
  category: string
  refreshKey: number
  running: boolean
}

export function Gallery({ category, refreshKey, running }: GalleryProps) {
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(
          `/api/capture/results?category=${encodeURIComponent(category)}`,
          { cache: 'no-store' }
        )
        const j = await r.json()
        if (cancelled) return
        if (!r.ok || !j.ok) {
          setError(j.error || `HTTP ${r.status}`)
          setFiles([])
        } else {
          setFiles(j.files || [])
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
    // Poll while running so new screenshots appear live.
    if (running) {
      const id = setInterval(load, 2500)
      return () => {
        cancelled = true
        clearInterval(id)
      }
    }
    return () => {
      cancelled = true
    }
  }, [category, refreshKey, running])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-orange-600" />
            Gallery
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {files.length} PNGs - {category}
          </Badge>
        </CardTitle>
        <CardDescription className="font-mono text-[10px]">
          Captured screenshots for the current category.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            loading...
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            {error}
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            No screenshots yet for this category.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {files.map((f) => {
              const src = `/api/capture/file?name=${encodeURIComponent(
                f.name
              )}&category=${encodeURIComponent(category)}&t=${f.mtime}`
              return (
                <a
                  key={f.name}
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block overflow-hidden rounded-md border border-border/60 bg-muted/30 transition hover:border-orange-300 hover:shadow-md"
                >
                  <div className="aspect-square w-full overflow-hidden bg-white">
                    <img
                      src={src}
                      alt={f.name.replace(/\.png$/i, '')}
                      loading="lazy"
                      className="h-full w-full object-contain transition group-hover:scale-105"
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[9px] text-white">
                    <span className="truncate font-mono">
                      {f.name.replace(/\.png$/i, '')}
                    </span>
                    <span className="shrink-0 font-mono opacity-80">
                      {(f.size / 1024).toFixed(0)}KB
                    </span>
                  </div>
                  <ExternalLink className="absolute right-1 top-1 h-3 w-3 text-white opacity-0 transition group-hover:opacity-80" />
                </a>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
