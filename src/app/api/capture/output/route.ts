import { NextResponse } from 'next/server'
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTPUT_ROOT = '/home/z/my-project/output'

/**
 * GET /api/capture/output
 * Lists every category folder under output/ with:
 *   - name (folder slug)
 *   - pngCount
 *   - totalBytes
 *   - manifest summary (total, captured, failed, skipped) if present
 *   - lastModified
 *
 * This powers the "Output Browser" UI so the user can see ALL captured
 * categories at a glance and download them.
 */
export async function GET() {
  if (!existsSync(OUTPUT_ROOT)) {
    return NextResponse.json({ ok: true, categories: [] })
  }

  let entries: string[] = []
  try {
    entries = readdirSync(OUTPUT_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Failed to read output root: ${e?.message ?? e}` },
      { status: 500 }
    )
  }

  const categories = entries
    .map((name) => {
      const dir = path.join(OUTPUT_ROOT, name)
      const manifestPath = path.join(dir, 'manifest.json')
      let pngCount = 0
      let totalBytes = 0
      let lastMtime = 0
      let manifest: any = null
      try {
        const files = readdirSync(dir)
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.png')) continue
          const full = path.join(dir, f)
          const st = statSync(full)
          pngCount++
          totalBytes += st.size
          const m = st.mtimeMs
          if (m > lastMtime) lastMtime = m
        }
      } catch {
        /* ignore */
      }
      try {
        if (existsSync(manifestPath)) {
          manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
          const mm = statSync(manifestPath).mtimeMs
          if (mm > lastMtime) lastMtime = mm
        }
      } catch {
        /* ignore */
      }
      return {
        name,
        pngCount,
        totalBytes,
        lastModified: lastMtime
          ? new Date(lastMtime).toISOString()
          : null,
        manifest: manifest
          ? {
              total: manifest.total ?? 0,
              captured: manifest.captured ?? 0,
              failedCount: manifest.failed_count ?? 0,
              skippedCount: manifest.skipped_count ?? 0,
              sourceUrl: manifest.source_url ?? '',
              startedAt: manifest.started_at ?? null,
              finishedAt: manifest.finished_at ?? null,
            }
          : null,
      }
    })
    .sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''))

  const totalPngs = categories.reduce((n, c) => n + c.pngCount, 0)
  const totalBytesAll = categories.reduce((n, c) => n + c.totalBytes, 0)

  return NextResponse.json({
    ok: true,
    outputRoot: OUTPUT_ROOT,
    totalCategories: categories.length,
    totalPngs,
    totalBytes: totalBytesAll,
    categories,
  })
}
