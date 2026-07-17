import { NextRequest, NextResponse } from 'next/server'
import {
  getStatus,
  enqueueCapture,
  clearQueue,
} from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/capture/queue - return the current queue + active flag. */
export async function GET() {
  const s = getStatus()
  return NextResponse.json({
    ok: true,
    items: s.queue,
    active: s.queueActive,
    running: s.running,
  })
}

/**
 * POST /api/capture/queue
 * Body: { items: Partial<CaptureConfig>[] }
 *   OR a single Partial<CaptureConfig> (treated as one-item list)
 *   OR { urls: string[] } (quick-add: each URL -> auto-named folder)
 *
 * Adds the items to the queue. If idle + queue active, the first item starts
 * immediately.
 */
export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    // allow empty body
  }

  let items: any[] = []

  if (Array.isArray(body)) {
    items = body
  } else if (Array.isArray(body.items)) {
    items = body.items
  } else if (Array.isArray(body.urls)) {
    // Quick-add mode: a bare list of URLs -> derive folder name from URL.
    items = body.urls.map((u: string) => ({ url: u }))
  } else if (body.url) {
    items = [body]
  } else {
    return NextResponse.json(
      { ok: false, error: 'Send { items: [...] }, { urls: [...] }, or a single config.' },
      { status: 400 }
    )
  }

  const result = enqueueCapture(items)
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 })
  }
  return NextResponse.json({ ok: true, added: result.added, status: getStatus() })
}

/**
 * DELETE /api/capture/queue?pending=true|false
 *   pending=false (default) -> remove finished items only (keep pending + running)
 *   pending=true            -> remove finished + pending (keep only running)
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const includePending = searchParams.get('pending') === 'true'
  const result = clearQueue(includePending)
  return NextResponse.json({ ok: true, removed: result.removed, status: getStatus() })
}
