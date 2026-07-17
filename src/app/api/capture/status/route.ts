import { NextResponse } from 'next/server'
import { getStatus } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/capture/status - return the current capture process state. */
export async function GET() {
  return NextResponse.json({ ok: true, status: getStatus() })
}
