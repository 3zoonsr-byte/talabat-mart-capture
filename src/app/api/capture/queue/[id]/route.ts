import { NextRequest, NextResponse } from 'next/server'
import { removeQueueItem } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE /api/capture/queue/[id] - remove one pending item. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = removeQueueItem(id)
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
