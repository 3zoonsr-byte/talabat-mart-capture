'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface QaCheck {
  id: string
  label: string
  passed: boolean
  detail?: string
}

interface QaChecklistProps {
  category: string
  refreshKey: number
  running: boolean
}

export function QaChecklist({ category, refreshKey, running }: QaChecklistProps) {
  const [checks, setChecks] = useState<QaCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(
          `/api/capture/qa?category=${encodeURIComponent(category)}`,
          { cache: 'no-store' }
        )
        const j = await r.json()
        if (cancelled) return
        if (!r.ok || !j.ok) {
          setError(j.error || `HTTP ${r.status}`)
          setChecks([])
        } else {
          setChecks(j.checks || [])
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
    if (running) {
      const id = setInterval(load, 4000)
      return () => {
        cancelled = true
        clearInterval(id)
      }
    }
    return () => {
      cancelled = true
    }
  }, [category, refreshKey, running])

  const passed = checks.filter((c) => c.passed).length
  const failed = checks.length - passed

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-orange-600" />
            QA checklist
          </span>
          {!loading && !error && checks.length > 0 && (
            <Badge
              className={
                failed === 0
                  ? 'border-green-300 bg-green-100/70 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200'
                  : 'border-amber-300 bg-amber-100/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
              }
            >
              {passed}/{checks.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="font-mono text-[10px]">
          spec QA checks against {category}/
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            loading...
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            {error}
          </div>
        ) : checks.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            No output yet for this category.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2 rounded-md border border-border/40 bg-card/40 p-2"
              >
                {c.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{c.label}</div>
                  {c.detail && (
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {c.detail}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
