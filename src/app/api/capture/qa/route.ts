import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OUTPUT_ROOT = '/home/z/my-project/output'

interface QaCheck {
  id: string
  label: string
  passed: boolean
  detail?: string
}

/** GET /api/capture/qa?category=eggs - run the QA checklist against the output. */
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
    return NextResponse.json({
      ok: true,
      category,
      checks: [] as QaCheck[],
      passed: 0,
      failed: 0,
      total: 0,
    })
  }

  const pngs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'))
  const checks: QaCheck[] = []

  // 1. manifest.json exists
  const manifestPath = path.join(dir, 'manifest.json')
  let manifest: any = null
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      /* ignore */
    }
  }
  checks.push({
    id: 'manifest',
    label: 'manifest.json exists',
    passed: !!manifest,
  })

  // 2. PNG count > 0
  checks.push({
    id: 'pngs',
    label: 'At least one PNG captured',
    passed: pngs.length > 0,
    detail: pngs.length > 0 ? `${pngs.length} PNGs` : undefined,
  })

  // 3. Manifest items match PNG count (within tolerance)
  const manifestItems = Array.isArray(manifest?.items) ? manifest.items : []
  checks.push({
    id: 'manifest-png-match',
    label: 'manifest items == PNG count',
    passed:
      manifestItems.length > 0 && Math.abs(manifestItems.length - pngs.length) <= 1,
    detail: `manifest=${manifestItems.length}, pngs=${pngs.length}`,
  })

  // 4. No empty (0-byte) PNGs
  const empty = pngs.filter((f) => {
    try {
      return statSync(path.join(dir, f)).size === 0
    } catch {
      return true
    }
  })
  checks.push({
    id: 'no-empty',
    label: 'No empty (0-byte) PNGs',
    passed: empty.length === 0,
    detail: empty.length > 0 ? `${empty.length} empty` : undefined,
  })

  // 5. No tiny (<2KB) PNGs (likely white/blank screenshots)
  const tiny = pngs.filter((f) => {
    try {
      return statSync(path.join(dir, f)).size < 2048
    } catch {
      return true
    }
  })
  checks.push({
    id: 'no-tiny',
    label: 'No tiny (<2KB) PNGs (white screenshots)',
    passed: tiny.length === 0,
    detail: tiny.length > 0 ? `${tiny.length} tiny` : undefined,
  })

  // 6. Filenames contain Arabic OR Latin characters (sanitized)
  const badNames = pngs.filter(
    (f) => !/[\u0600-\u06FFa-zA-Z]/.test(f.replace(/\.png$/i, ''))
  )
  checks.push({
    id: 'names',
    label: 'Filenames contain readable text',
    passed: badNames.length === 0,
    detail: badNames.length > 0 ? `${badNames.length} bad names` : undefined,
  })

  // 7. No duplicate bytes (same image saved twice)
  const sizes = new Map<number, string[]>()
  for (const f of pngs) {
    try {
      const sz = statSync(path.join(dir, f)).size
      if (!sizes.has(sz)) sizes.set(sz, [])
      sizes.get(sz)!.push(f)
    } catch {
      /* ignore */
    }
  }
  const dups = Array.from(sizes.values()).filter((a) => a.length > 1)
  checks.push({
    id: 'no-dup-bytes',
    label: 'No duplicate-size images',
    passed: dups.length === 0,
    detail: dups.length > 0 ? `${dups.length} size collisions` : undefined,
  })

  const passed = checks.filter((c) => c.passed).length
  return NextResponse.json({
    ok: true,
    category,
    checks,
    passed,
    failed: checks.length - passed,
    total: checks.length,
  })
}
