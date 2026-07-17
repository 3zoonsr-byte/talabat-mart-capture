import { NextResponse } from 'next/server'
import { resumeQueue } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/capture/queue/resume - re-activate the queue + start next pending. */
export async function POST() {
  const result = resumeQueue()
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
