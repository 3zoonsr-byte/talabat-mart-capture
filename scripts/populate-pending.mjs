#!/usr/bin/env node
/**
 * Populate the capture queue with ONLY categories that haven't been captured yet
 * (i.e., no output/<folder>/ with PNGs exists).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const FILE = '/home/z/my-project/upload/categories.txt'
const API = 'http://localhost:3000/api/capture/queue'

function smartFolderFromUrl(url) {
  try {
    const after = url.split('/talabat-mart/')[1].split('?')[0].trim('/').split('/')
    if (after.length >= 2) return `${after[0]}__${after[1]}`
    return after[after.length - 1] || 'category'
  } catch { return 'category' }
}

function isCaptured(folder) {
  const dir = `/home/z/my-project/output/${folder}`
  if (!existsSync(dir)) return false
  try {
    const pngs = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'))
    return pngs.length > 0
  } catch { return false }
}

const raw = readFileSync(FILE, 'utf8')
const data = JSON.parse(raw)

const items = []
let skipped = 0
for (const [catName, subItems] of Object.entries(data)) {
  for (const sub of subItems) {
    if (!sub.url || !sub.url.startsWith('http')) continue
    const category = smartFolderFromUrl(sub.url)
    if (isCaptured(category)) { skipped++; continue }
    items.push({
      url: sub.url,
      category,
      outputDir: `/home/z/my-project/output/${category}`,
      headless: true,
      maxScrollRounds: 20,
      settleMs: 3000,
      maxPages: 50,
    })
  }
}

console.log(`[populate-pending] ${items.length} pending, ${skipped} already captured (skipped)`)
console.log(`[populate-pending] first 5:`)
for (const s of items.slice(0, 5)) {
  console.log(`  ${s.category.padEnd(50)} <- ${s.url}`)
}

const res = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items }),
})
const j = await res.json()
if (!res.ok || !j.ok) {
  console.error(`[populate-pending] FAILED:`, j)
  process.exit(1)
}
const status = j.status || {}
console.log(`[populate-pending] OK - added ${j.added?.length ?? items.length} items`)
console.log(`[populate-pending] queue active: ${status.queueActive}`)
console.log(`[populate-pending] running: ${status.running}`)
