import { NextResponse } from 'next/server'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 min — zipping hundreds of PNGs can take a while

const execFileAsync = promisify(execFile)
const OUTPUT_ROOT = '/home/z/my-project/output'

/**
 * GET /api/capture/download-all
 *
 * Streams a single ZIP containing the ENTIRE output/ directory — every
 * category subfolder, every PNG, every manifest.json — back to the browser.
 *
 * Uses the system `zip` binary (Info-ZIP) which is fast and streams nicely.
 * The temp file is read into memory then deleted; for very large archives
 * this is a trade-off, but a category set of ~300 PNGs is typically < 100 MB.
 */
export async function GET() {
  if (!existsSync(OUTPUT_ROOT)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'مجلد output غير موجود. شغّل الـcapture الأول.',
      },
      { status: 404 }
    )
  }

  // Quick sanity check: are there any subfolders at all?
  let subdirs: string[] = []
  try {
    subdirs = readdirSync(OUTPUT_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Failed to read output root: ${e?.message ?? e}` },
      { status: 500 }
    )
  }

  if (subdirs.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'مفيش مجلدات أقسام في output/. شغّل الـcapture الأول.',
      },
      { status: 404 }
    )
  }

  // Build a temp zip file. We zip the CONTENTS of output/ (cwd = OUTPUT_ROOT,
  // recurse '.'), so the archive root contains all category folders.
  const tmpZip = path.join(
    tmpdir(),
    `talabat-mart-all-${new Date().toISOString().slice(0, 10)}-${randomUUID()}.zip`
  )

  try {
    // -r recursive, -q quiet, -1 fast compression (PNGs don't compress much anyway)
    await execFileAsync('zip', ['-r', '-q', '-1', tmpZip, '.'], {
      cwd: OUTPUT_ROOT,
      maxBuffer: 1024 * 1024 * 512, // 512 MB stdout buffer
    })
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

  if (size === 0) {
    return NextResponse.json(
      { ok: false, error: 'الـ ZIP فاضي — مفيش ملفات.' },
      { status: 500 }
    )
  }

  // Read into buffer so we can delete the temp file immediately after.
  const { readFileSync, unlinkSync } = await import('node:fs')
  const buf = readFileSync(tmpZip)
  try {
    unlinkSync(tmpZip)
  } catch {
    /* ignore */
  }

  const filename = `talabat-mart-all-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buf.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Total-Categories': String(subdirs.length),
    },
  })
}
