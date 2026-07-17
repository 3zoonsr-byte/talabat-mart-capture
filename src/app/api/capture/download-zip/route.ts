import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createWriteStream, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const OUTPUT_ROOT = '/home/z/my-project/output'

/**
 * GET /api/capture/download-zip?category=fruit-veg__fresh-fruit
 *
 * Streams a ZIP of the category's PNGs + manifest.json back to the browser.
 * Uses the system `zip` binary (Info-ZIP 3.0 available on the sandbox).
 * The temp file is removed after streaming.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = (searchParams.get('category') || '').trim()

  if (!category || /[^A-Za-z0-9_\-]/.test(category)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid or missing category.' },
      { status: 400 }
    )
  }

  const dir = path.join(OUTPUT_ROOT, category)
  if (!existsSync(dir)) {
    return NextResponse.json(
      { ok: false, error: `Category folder not found: ${category}` },
      { status: 404 }
    )
  }

  // Verify the dir is actually under OUTPUT_ROOT (path traversal guard).
  const resolved = path.resolve(dir)
  const resolvedRoot = path.resolve(OUTPUT_ROOT)
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json(
      { ok: false, error: 'Path traversal not allowed.' },
      { status: 400 }
    )
  }

  // Build a temp zip file. Info-ZIP recurses the folder; we zip the contents
  // (so the archive root is the category folder itself, not output/).
  const tmpZip = path.join(tmpdir(), `capture-${category}-${randomUUID()}.zip`)
  try {
    // `-j` would junk paths; we WANT paths (so files keep their names inside
    // a top-level folder). Use the category folder as the archive root.
    await execFileAsync('zip', ['-r', '-q', tmpZip, '.'], { cwd: dir })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `zip failed: ${e?.message ?? e}` },
      { status: 500 }
    )
  }

  let size = 0
  try {
    size = statSync(tmpZip).size
  } catch {
    /* ignore */
  }

  // Stream the file back with the right headers, then delete it.
  // Note: we can't easily delete AFTER streaming with a plain Response, so
  // we read it into a buffer and delete synchronously. For very large
  // archives this uses memory, but a category is typically < 50 MB.
  const { readFileSync } = await import('node:fs')
  const buf = readFileSync(tmpZip)
  try {
    unlinkSync(tmpZip)
  } catch {
    /* ignore */
  }

  const filename = `${category}.zip`
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buf.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
