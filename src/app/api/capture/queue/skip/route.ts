import { NextResponse } from 'next/server'
import { skipCurrent } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/capture/queue/skip - kill the current item and start the next. */
export async function POST() {
  const result = skipCurrent()
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
