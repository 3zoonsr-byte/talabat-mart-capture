#!/usr/bin/env node
/**
 * One-shot script: read /home/z/my-project/upload/categories.txt,
 * derive a smart folder name (parent__sub) for every URL, and POST them
 * to the capture queue API so the queue is populated and ready to run.
 */
import { readFileSync } from 'node:fs'

const FILE = '/home/z/my-project/upload/categories.txt'
const API = 'http://localhost:3000/api/capture/queue'

function smartFolderFromUrl(url) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    const tmIdx = parts.findIndex((p) => p === 'talabat-mart')
    if (tmIdx >= 0 && tmIdx + 2 < parts.length) {
      const parent = parts[tmIdx + 1]
      const sub = parts[tmIdx + 2]
      return `${parent}__${sub}`
    }
    return parts[parts.length - 1] || 'category'
  } catch {
    return 'category'
  }
}

const raw = readFileSync(FILE, 'utf8')
const data = JSON.parse(raw)

const items = []
let cats = 0
for (const [catName, subItems] of Object.entries(data)) {
  cats++
  for (const sub of subItems) {
    if (!sub.url || !sub.url.startsWith('http')) continue
    const category = smartFolderFromUrl(sub.url)
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

console.log(`[populate-queue] ${items.length} URLs across ${cats} top-level categories`)
console.log(`[populate-queue] sample folders:`)
for (const s of items.slice(0, 5)) {
  console.log(`  ${s.category.padEnd(48)} <- ${s.url}`)
}

const res = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items }),
})
const j = await res.json()
if (!res.ok || !j.ok) {
  console.error(`[populate-queue] FAILED:`, j)
  process.exit(1)
}
const status = j.status || {}
const q = status.queue || []
const byStatus = q.reduce((acc, it) => {
  acc[it.status] = (acc[it.status] || 0) + 1
  return acc
}, {})
console.log(`[populate-queue] OK - added ${j.added?.length ?? q.length} items`)
console.log(`[populate-queue] queue active: ${status.queueActive}`)
console.log(`[populate-queue] running: ${status.running}`)
console.log(`[populate-queue] status counts:`, byStatus)
