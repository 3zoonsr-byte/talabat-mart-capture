import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTPUT_ROOT = '/home/z/my-project/output'

/** GET /api/capture/file?name=foo.png&category=eggs - stream a single PNG. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const name = (searchParams.get('name') || '').trim()
  const category = (searchParams.get('category') || '').trim()

  if (!name || !category) {
    return NextResponse.json(
      { ok: false, error: 'name and category are required.' },
      { status: 400 }
    )
  }
  // Path-traversal guard: only allow safe characters in the filename.
  if (/[^A-Za-z0-9_\-.\u0600-\u06FF]/.test(name) || name.includes('..')) {
    return NextResponse.json(
      { ok: false, error: 'Invalid filename.' },
      { status: 400 }
    )
  }
  if (/[^A-Za-z0-9_\-]/.test(category) || category.includes('..')) {
    return NextResponse.json(
      { ok: false, error: 'Invalid category.' },
      { status: 400 }
    )
  }
  const full = path.join(OUTPUT_ROOT, category, name)
  // Re-resolve and confirm it's still under OUTPUT_ROOT.
  const resolved = path.resolve(full)
  if (!resolved.startsWith(path.resolve(OUTPUT_ROOT) + path.sep)) {
    return NextResponse.json(
      { ok: false, error: 'Path traversal denied.' },
      { status: 400 }
    )
  }
  if (!existsSync(resolved)) {
    return NextResponse.json(
      { ok: false, error: 'File not found.' },
      { status: 404 }
    )
  }
  const st = statSync(resolved)
  const stream = createReadStream(resolved)
  const headers = new Headers({
    'Content-Type': 'image/png',
    'Content-Length': String(st.size),
    'Cache-Control': 'public, max-age=60',
  })
  return new NextResponse(stream as any, { headers })
}
