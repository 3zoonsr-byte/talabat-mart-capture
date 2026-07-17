import { NextResponse } from 'next/server'
import { stopCapture } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/capture/stop - SIGTERM the running capture + stop the queue. */
export async function POST() {
  const result = stopCapture()
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
