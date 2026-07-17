import { NextRequest, NextResponse } from 'next/server'
import { startCapture, type CaptureConfig } from '@/lib/capture-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/capture/start - start a single (non-queued) capture. */
export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 }
    )
  }

  const cfg: CaptureConfig = {
    url: String(body.url || '').trim(),
    category: String(body.category || '').trim(),
    outputDir: String(body.outputDir || '').trim(),
    proxy: body.proxy?.trim() || undefined,
    headless: body.headless ?? true,
    maxScrollRounds: Number(body.maxScrollRounds ?? 20),
    settleMs: Number(body.settleMs ?? 3000),
    maxPages: Number(body.maxPages ?? 50),
  }

  if (!cfg.url || !cfg.url.startsWith('http')) {
    return NextResponse.json(
      { ok: false, error: 'A valid http(s) url is required.' },
      { status: 400 }
    )
  }
  if (!cfg.category) cfg.category = 'category'
  if (!cfg.outputDir) {
    cfg.outputDir = `/home/z/my-project/output/${cfg.category}`
  }

  const result = startCapture(cfg)
  if (!result.ok) {
    return NextResponse.json(result, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
