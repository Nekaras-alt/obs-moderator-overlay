// Disk cache for SoundPad CDN audio (MyInstants / UwUpad) — offline replay.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { UPLOADS_DIR, DATA_DIR, ensureDirs } from './config/paths.js'

const CACHE_DIR = path.join(UPLOADS_DIR, 'sounds')
const INDEX_FILE = path.join(DATA_DIR, 'sound-cache-index.json')
const MAX_BYTES = 256 * 1024 * 1024
const MAX_FILES = 500
const ALLOWED = new Set(['cdn.uwupad.me', 'www.myinstants.com', 'myinstants.com'])

let indexMap = null

function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
}

export function isAllowedSoundUrl(urlStr) {
  try {
    const u = new URL(urlStr)
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED.has(u.hostname)
  } catch (_) {
    return false
  }
}

function ensure() {
  ensureDirs()
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function loadIndex() {
  if (indexMap) return indexMap
  indexMap = new Map()
  ensure()
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
      for (const e of (raw.entries || [])) {
        if (e?.url && e?.src) indexMap.set(e.url, e)
      }
    }
  } catch (_) { indexMap = new Map() }
  return indexMap
}

function saveIndex() {
  ensure()
  const tmp = INDEX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: [...loadIndex().values()] }, null, 2))
  fs.renameSync(tmp, INDEX_FILE)
}

function findByHash(hash) {
  ensure()
  try {
    return fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(hash + '.')) || null
  } catch (_) { return null }
}

function evict() {
  ensure()
  const files = []
  let total = 0
  for (const name of fs.readdirSync(CACHE_DIR)) {
    try {
      const st = fs.statSync(path.join(CACHE_DIR, name))
      if (!st.isFile()) continue
      files.push({ name, size: st.size, mtimeMs: st.mtimeMs })
      total += st.size
    } catch (_) { /* ignore */ }
  }
  if (files.length <= MAX_FILES && total <= MAX_BYTES) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  const map = loadIndex()
  const bySrc = new Map([...map.entries()].map(([u, e]) => [e.src, u]))
  for (const f of files) {
    if (files.length <= MAX_FILES && total <= MAX_BYTES) break
    try {
      fs.unlinkSync(path.join(CACHE_DIR, f.name))
      total -= f.size
      const url = bySrc.get(`/uploads/sounds/${f.name}`)
      if (url) map.delete(url)
    } catch (_) { /* ignore */ }
  }
  saveIndex()
}

export async function ensureSoundCached(urlStr, meta = {}) {
  if (!urlStr) throw new Error('url required')
  if (urlStr.startsWith('/uploads/sounds/')) return urlStr
  if (!isAllowedSoundUrl(urlStr)) throw new Error('host not allowed')
  ensure()
  const hash = hashUrl(urlStr)
  const hit = findByHash(hash)
  if (hit) {
    const src = `/uploads/sounds/${hit}`
    const abs = path.join(CACHE_DIR, hit)
    try { fs.utimesSync(abs, new Date(), new Date()) } catch (_) { /* ignore */ }
    loadIndex().set(urlStr, {
      url: urlStr, src, name: meta.name || '', size: fs.statSync(abs).size, cachedAt: Date.now()
    })
    saveIndex()
    return src
  }
  const upstream = await fetch(urlStr, {
    headers: {
      Referer: 'https://uwupad.me/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    signal: AbortSignal.timeout(30000)
  })
  if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`)
  const buf = Buffer.from(await upstream.arrayBuffer())
  const filename = `${hash}.mp3`
  fs.writeFileSync(path.join(CACHE_DIR, filename), buf)
  const src = `/uploads/sounds/${filename}`
  loadIndex().set(urlStr, {
    url: urlStr, src, name: meta.name || '', size: buf.length, cachedAt: Date.now()
  })
  saveIndex()
  evict()
  return src
}

export function mountSoundCacheRoutes(app, requireModerator) {
  app.post('/api/sounds/cache', async (req, res) => {
    if (!requireModerator(req, res)) return
    const url = String(req.body?.url || '')
    if (!url) return res.status(400).json({ ok: false, error: 'url required' })
    try {
      const src = await ensureSoundCached(url, { name: req.body?.name })
      res.json({ ok: true, src })
    } catch (err) {
      const hash = hashUrl(url)
      const hit = findByHash(hash)
      if (hit) return res.json({ ok: true, src: `/uploads/sounds/${hit}`, offline: true })
      res.status(502).json({ ok: false, error: err.message })
    }
  })
}
