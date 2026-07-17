import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTPUT_ROOT = '/home/z/my-project/output'

/** GET /api/capture/manifest?category=eggs - return manifest.json or 404. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = (searchParams.get('category') || '').trim()
  if (!category || /[^A-Za-z0-9_\-]/.test(category)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid category.' },
      { status: 400 }
    )
  }
  const file = path.join(OUTPUT_ROOT, category, 'manifest.json')
  if (!existsSync(file)) {
    return NextResponse.json(
      { ok: false, error: 'manifest.json not found for this category.' },
      { status: 404 }
    )
  }
  try {
    const raw = readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    return NextResponse.json({ ok: true, manifest: data })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Failed to read manifest: ${e?.message ?? e}` },
      { status: 500 }
    )
  }
}
