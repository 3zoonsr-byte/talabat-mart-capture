'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Folder,
  Image as ImageIcon,
  Download,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Loader2,
  HardDrive,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { toast } from 'sonner'

interface OutputCategory {
  name: string
  pngCount: number
  totalBytes: number
  lastModified: string | null
  manifest: {
    total: number
    captured: number
    failedCount: number
    skippedCount: number
    sourceUrl: string
    startedAt: string | null
    finishedAt: string | null
  } | null
}

interface OutputListResponse {
  ok: boolean
  outputRoot: string
  totalCategories: number
  totalPngs: number
  totalBytes: number
  categories: OutputCategory[]
}

interface FileEntry {
  name: string
  size: number
  mtime: string
}

function formatBytes(b: number): string {
  if (b === 0) return '0 B'
  const k = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  return `${(b / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    })
  } catch {
    return iso
  }
}

export function OutputBrowser({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<OutputListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, FileEntry[]>>({})
  const [loadingFiles, setLoadingFiles] = useState<string | null>(null)
  const [zipping, setZipping] = useState<string | null>(null)
  const [zippingAll, setZippingAll] = useState(false)
  const [filter, setFilter] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/capture/output', { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setData(j)
      else toast.error(j.error || 'Failed to load output list')
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load output list')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList, refreshKey])

  // Auto-refresh every 15s while there are captures running (the refreshKey
  // also bumps from the event stream so this is just a safety net).
  useEffect(() => {
    const t = setInterval(fetchList, 15000)
    return () => clearInterval(t)
  }, [fetchList])

  const toggleCategory = async (name: string) => {
    if (expanded === name) {
      setExpanded(null)
      return
    }
    setExpanded(name)
    if (!files[name]) {
      setLoadingFiles(name)
      try {
        const r = await fetch(
          `/api/capture/results?category=${encodeURIComponent(name)}`,
          { cache: 'no-store' }
        )
        const j = await r.json()
        if (j.ok) {
          setFiles((prev) => ({ ...prev, [name]: j.files }))
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingFiles(null)
      }
    }
  }

  const handleDownloadZip = async (cat: OutputCategory) => {
    setZipping(cat.name)
    try {
      const r = await fetch(
        `/api/capture/download-zip?category=${encodeURIComponent(cat.name)}`
      )
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${cat.name}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`تنزيل ${cat.name}.zip بدأ (${formatBytes(blob.size)})`)
    } catch (e: any) {
      toast.error(e?.message ?? 'فشل التنزيل')
    } finally {
      setZipping(null)
    }
  }

  const handleDownloadAll = async () => {
    if (!data || data.totalPngs === 0) {
      toast.error('مفيش صور للتنزيل — شغّل الـcapture الأول')
      return
    }
    setZippingAll(true)
    try {
      const r = await fetch('/api/capture/download-all', { cache: 'no-store' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `talabat-mart-all-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(
        `تنزيل كل الصور بدأ (${data.totalCategories} قسم، ${data.totalPngs} صورة، ${formatBytes(blob.size)})`
      )
    } catch (e: any) {
      toast.error(e?.message ?? 'فشل تنزيل الكل')
    } finally {
      setZippingAll(false)
    }
  }

  const handleOpenImage = (cat: string, name: string) => {
    const url = `/api/capture/file?name=${encodeURIComponent(
      name
    )}&category=${encodeURIComponent(cat)}`
    window.open(url, '_blank')
  }

  const cats = data?.categories ?? []
  const filtered = filter.trim()
    ? cats.filter((c) =>
        c.name.toLowerCase().includes(filter.trim().toLowerCase())
      )
    : cats

  return (
    <Card className="border-orange-200/60 dark:border-orange-900/40">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-orange-600" />
            مستعرض الصور المسحوبة (Output Browser)
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={fetchList}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            تحديث
          </Button>
        </CardTitle>
        <CardDescription>
          كل قسم (category) ليه مجلد خاص بيه بصيغة{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            parent__sub
          </code>
          . اضغط على أي قسم علشان تشوف صوره، أو نزّله كاملًا كـ ZIP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary bar with Download-All */}
        {data && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-300/60 bg-orange-50/60 p-3 text-xs dark:border-orange-800/60 dark:bg-orange-950/20">
            <Badge variant="outline" className="gap-1 border-orange-300 bg-background">
              <Folder className="h-3 w-3 text-orange-600" />
              {data.totalCategories} قسم
            </Badge>
            <Badge variant="outline" className="gap-1 border-orange-300 bg-background">
              <ImageIcon className="h-3 w-3 text-orange-600" />
              {data.totalPngs} صورة
            </Badge>
            <Badge variant="outline" className="gap-1 border-orange-300 bg-background">
              <HardDrive className="h-3 w-3 text-orange-600" />
              {formatBytes(data.totalBytes)}
            </Badge>
            <Button
              size="sm"
              className="ml-auto h-8 gap-1.5 bg-orange-600 text-white hover:bg-orange-700"
              onClick={handleDownloadAll}
              disabled={zippingAll || data.totalPngs === 0}
            >
              {zippingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              نزّل كل الصور (ZIP)
            </Button>
          </div>
        )}

        {/* Empty state when no data */}
        {data && data.totalPngs === 0 && (
          <div className="rounded-lg border border-dashed border-orange-300/60 bg-orange-50/40 p-6 text-center text-sm">
            <ImageIcon className="mx-auto mb-2 h-8 w-8 text-orange-400" />
            <p className="font-medium text-foreground">لسه مفيش صور مسحوبة</p>
            <p className="mt-1 text-xs text-muted-foreground">
              شغّل الـcapture queue من فوق علشان يبدأ تسحب الصور وتظهر هنا.
            </p>
          </div>
        )}

        {/* Filter */}
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="فلتر حسب اسم القسم..."
          className="h-8 text-xs"
        />

        {/* List */}
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ تحميل القائمة...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
            {cats.length === 0
              ? 'لسه مفيش صور مسحوبة. شغّل الـqueue علشان يبدأ.'
              : 'مفيش قسم بيطابق الفلتر.'}
          </div>
        ) : (
          <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {filtered.map((cat) => {
              const isOpen = expanded === cat.name
              const catFiles = files[cat.name]
              const isLoading = loadingFiles === cat.name
              return (
                <Collapsible
                  key={cat.name}
                  open={isOpen}
                  onOpenChange={() => toggleCategory(cat.name)}
                >
                  <div className="rounded-md border border-border/60 bg-card/60">
                    <CollapsibleTrigger asChild>
                      <button
                        className="flex w-full items-center gap-2 p-2.5 text-right hover:bg-muted/30"
                        type="button"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <Folder className="h-4 w-4 shrink-0 text-orange-600" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
                          {cat.name}
                        </span>
                        {cat.manifest ? (
                          <>
                            <Badge
                              variant="outline"
                              className="shrink-0 gap-1 text-[10px]"
                            >
                              <ImageIcon className="h-3 w-3" />
                              {cat.pngCount}
                            </Badge>
                            {cat.manifest.captured === cat.manifest.total &&
                            cat.manifest.total > 0 ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                            ) : cat.manifest.captured > 0 ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 border-amber-300 bg-amber-100/60 text-[10px] text-amber-800"
                              >
                                {cat.manifest.captured}/{cat.manifest.total}
                              </Badge>
                            ) : (
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </>
                        ) : (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 text-[10px]"
                          >
                            {cat.pngCount} صورة
                          </Badge>
                        )}
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {formatBytes(cat.totalBytes)}
                        </span>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="space-y-2 border-t border-border/60 p-2.5">
                        {/* Action bar */}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs bg-orange-600 text-white hover:bg-orange-700"
                            onClick={() => handleDownloadZip(cat)}
                            disabled={zipping === cat.name || cat.pngCount === 0}
                          >
                            {zipping === cat.name ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            نزّل ZIP ({cat.pngCount} صورة)
                          </Button>
                          {cat.manifest?.sourceUrl && (
                            <a
                              href={cat.manifest.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs hover:bg-muted/40"
                            >
                              <ExternalLink className="h-3 w-3" />
                              المصدر
                            </a>
                          )}
                          {cat.manifest && (
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                              آخر تحديث: {formatTime(cat.lastModified)}
                            </span>
                          )}
                        </div>

                        {/* Manifest stats */}
                        {cat.manifest && (
                          <div className="flex flex-wrap gap-1.5 text-[10px]">
                            <Badge variant="outline" className="text-[10px]">
                              المنتجات: {cat.manifest.total}
                            </Badge>
                            <Badge
                              className="border-green-300 bg-green-100/60 text-[10px] text-green-800"
                              variant="outline"
                            >
                              اتسحبت: {cat.manifest.captured}
                            </Badge>
                            {cat.manifest.failedCount > 0 && (
                              <Badge
                                className="border-red-300 bg-red-100/60 text-[10px] text-red-800"
                                variant="outline"
                              >
                                فشلت: {cat.manifest.failedCount}
                              </Badge>
                            )}
                            {cat.manifest.skippedCount > 0 && (
                              <Badge
                                className="border-amber-300 bg-amber-100/60 text-[10px] text-amber-800"
                                variant="outline"
                              >
                                ت تخطت: {cat.manifest.skippedCount}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* File thumbnails / list */}
                        {isLoading ? (
                          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            جارٍ تحميل الصور...
                          </div>
                        ) : cat.pngCount === 0 ? (
                          <div className="py-3 text-center text-[11px] text-muted-foreground">
                            مفيش صور في القسم ده لسه.
                          </div>
                        ) : catFiles && catFiles.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                            {catFiles.slice(0, 60).map((f) => (
                              <button
                                key={f.name}
                                type="button"
                                onClick={() => handleOpenImage(cat.name, f.name)}
                                className="group relative aspect-square overflow-hidden rounded-md border border-border/60 bg-muted/30 hover:border-orange-400 hover:ring-1 hover:ring-orange-400"
                                title={f.name}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/capture/file?name=${encodeURIComponent(
                                    f.name
                                  )}&category=${encodeURIComponent(cat.name)}`}
                                  alt={f.name}
                                  loading="lazy"
                                  className="h-full w-full object-contain p-1 transition-transform group-hover:scale-105"
                                />
                                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                                  {f.name}
                                </span>
                              </button>
                            ))}
                            {catFiles.length > 60 && (
                              <div className="col-span-full flex items-center justify-center py-2 text-[10px] text-muted-foreground">
                                عرض أول 60 صورة من {catFiles.length}. نزّل ZIP
                                علشان تشوف الكل.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
