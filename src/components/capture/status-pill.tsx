'use client'

import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface StatusPillProps {
  connected: boolean
}

export function StatusPill({ connected }: StatusPillProps) {
  if (connected) {
    return (
      <Badge className="border-green-300 bg-green-100/70 text-green-800 dark:border-green-800 dark:bg-green-950/60 dark:text-green-200">
        <Loader2 className="mr-1 h-3 w-3 animate-spin [animation-duration:2s]" />
        live
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <WifiOff className="mr-1 h-3 w-3" />
      offline
    </Badge>
  )
}
