import { NextRequest, NextResponse } from 'next/server'
import { readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTPUT_ROOT = '/home/z/my-project/output'

/** GET /api/capture/results?category=eggs - list PNGs in the output dir. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = (searchParams.get('category') || '').trim()
  if (!category || /[^A-Za-z0-9_\-]/.test(category)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid category.' },
      { status: 400 }
    )
  }
  const dir = path.join(OUTPUT_ROOT, category)
  if (!existsSync(dir)) {
    return NextResponse.json({ ok: true, files: [], dir })
  }
  try {
    const files = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => {
        const full = path.join(dir, f)
        const st = statSync(full)
        return {
          name: f,
          size: st.size,
          mtime: st.mtime.toISOString(),
        }
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime))
    return NextResponse.json({ ok: true, files, dir })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Failed to list: ${e?.message ?? e}` },
      { status: 500 }
    )
  }
}
