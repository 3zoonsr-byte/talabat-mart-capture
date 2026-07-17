'use client'

import { Camera, CheckCircle2, XCircle, SkipForward, Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { CaptureSnapshot } from '@/hooks/use-capture-stream'

interface ProgressCardsProps {
  snapshot: CaptureSnapshot | null
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: string
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-medium ${color}`}>{label}</span>
        <span className={color}>{icon}</span>
      </div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
        {value}
      </div>
    </div>
  )
}

export function ProgressCards({ snapshot }: ProgressCardsProps) {
  const captured = snapshot?.captured ?? 0
  const failed = snapshot?.failed ?? 0
  const skipped = snapshot?.skipped ?? 0
  const total = snapshot?.total ?? 0
  const status = snapshot?.status ?? 'idle'
  const running = status === 'running'
  const startedAt = snapshot?.startedAt
  const finishedAt = snapshot?.finishedAt
  const durationMs =
    startedAt && finishedAt
      ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
      : startedAt && running
        ? Date.now() - new Date(startedAt).getTime()
        : 0
  const durationLabel =
    durationMs > 0
      ? durationMs >= 60000
        ? `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`
        : `${(durationMs / 1000).toFixed(1)}s`
      : '-'

  const pct = total > 0 ? Math.round(((captured + failed + skipped) / total) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Live progress</span>
          <Badge
            variant="outline"
            className={
              running
                ? 'border-orange-300 bg-orange-100/70 text-orange-800 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-200'
                : 'text-muted-foreground'
            }
          >
            {status}
          </Badge>
        </CardTitle>
        <CardDescription className="font-mono text-[10px] truncate">
          {snapshot?.lastMessage || 'waiting for events...'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            icon={<Camera className="h-3.5 w-3.5" />}
            label="Captured"
            value={captured}
            color="text-green-600 dark:text-green-400"
          />
          <StatCard
            icon={<XCircle className="h-3.5 w-3.5" />}
            label="Failed"
            value={failed}
            color="text-red-600 dark:text-red-400"
          />
          <StatCard
            icon={<SkipForward className="h-3.5 w-3.5" />}
            label="Skipped"
            value={skipped}
            color="text-amber-600 dark:text-amber-400"
          />
          <StatCard
            icon={<Package className="h-3.5 w-3.5" />}
            label="Total"
            value={total}
            color="text-muted-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Progress</span>
            <span className="font-mono">
              {pct}% - {durationLabel}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>
        {snapshot?.category && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
            <Badge variant="outline" className="font-mono text-[10px]">
              {snapshot.category}
            </Badge>
            {snapshot.settleMs ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                settle {snapshot.settleMs}ms
              </Badge>
            ) : null}
            {snapshot.maxScrollRounds ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {snapshot.maxScrollRounds} scrolls
              </Badge>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
