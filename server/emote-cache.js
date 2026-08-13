// Disk cache + CDN proxy for emote assets (7TV/BTTV/FFZ) — offline / RF geo-blocks.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, UPLOADS_DIR, ensureDirs } from './config/paths.js'

const CACHE_DIR = path.join(UPLOADS_DIR, 'emotes')
const INDEX_FILE = path.join(DATA_DIR, 'emote-cache-index.json')

const MAX_CACHE_BYTES = 512 * 1024 * 1024 // 512 MB
const MAX_CACHE_FILES = 2000

const ALLOWED_HOSTS = new Set([
  'cdn.7tv.app',
  '7tv.io',
  'cdn.betterttv.net',
  'cdn.frankerfacez.com',
  'static-cdn.jtvnw.net',
  'media.gifs.ru'
])

/** @type {Map<string, object>} url -> index entry */
let indexMap = null

function extFromUrl(url, contentType) {
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i)
    if (m) return m[1].toLowerCase()
  } catch (_) { /* ignore */ }
  if (contentType?.includes('gif')) return 'gif'
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg'
  return 'webp'
}

export function hashUrl(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
}

export function isAllowedEmoteUrl(urlStr) {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return ALLOWED_HOSTS.has(u.hostname) || [...ALLOWED_HOSTS].some((h) => u.hostname.endsWith('.' + h))
  } catch (_) {
    return false
  }
}

export function isRemoteEmoteUrl(src) {
  if (!src || typeof src !== 'string') return false
  if (src.startsWith('/uploads/emotes/')) return false
  return isAllowedEmoteUrl(src)
}

function ensureCacheDir() {
  ensureDirs()
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function loadIndex() {
  if (indexMap) return indexMap
  indexMap = new Map()
  ensureDirs()
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
      const list = Array.isArray(raw?.entries) ? raw.entries : (Array.isArray(raw) ? raw : [])
      for (const e of list) {
        if (e?.url && e?.src) indexMap.set(e.url, e)
      }
    }
  } catch (err) {
    console.warn('[emote-cache] index load failed:', err.message)
    indexMap = new Map()
  }
  return indexMap
}

function saveIndex() {
  ensureDirs()
  const entries = [...loadIndex().values()]
  const tmp = INDEX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8')
  fs.renameSync(tmp, INDEX_FILE)
}

const CACHE_EXTS = ['webp', 'gif', 'png', 'jpg', 'jpeg', 'avif']

function findFileByHash(hash) {
  ensureCacheDir()
  for (const ext of CACHE_EXTS) {
    const name = `${hash}.${ext}`
    if (fs.existsSync(path.join(CACHE_DIR, name))) return name
  }
  return null
}

/** Rewrite catalog items so thumbs/originals already on disk skip the CDN. */
export function attachCachedUrls(items) {
  if (!Array.isArray(items)) return items
  return items.map((e) => {
    if (!e || typeof e !== 'object') return e
    const urlLocal = e.url ? resolveCachedPath(e.url) : null
    const thumbSrc = e.thumb || e.url
    const thumbLocal = thumbSrc ? resolveCachedPath(thumbSrc) : null
    return {
      ...e,
      url: urlLocal || e.url,
      thumb: thumbLocal || e.thumb,
      src: urlLocal || e.src
    }
  })
}

/** Resolve existing cached file for URL (does not download). */
export function resolveCachedPath(urlStr) {
  if (!urlStr) return null
  const map = loadIndex()
  const fromIndex = map.get(urlStr)
  if (fromIndex?.src) {
    const name = path.basename(fromIndex.src)
    const full = path.join(CACHE_DIR, name)
    if (fs.existsSync(full)) return fromIndex.src
  }
  if (!isAllowedEmoteUrl(urlStr) && !urlStr.startsWith('/uploads/emotes/')) return null
  if (urlStr.startsWith('/uploads/emotes/')) {
    const full = path.join(UPLOADS_DIR, urlStr.replace(/^\//, '').replace(/^uploads[\\/]/, ''))
    // urlStr is /uploads/emotes/file
    const file = path.join(CACHE_DIR, path.basename(urlStr))
    return fs.existsSync(file) ? `/uploads/emotes/${path.basename(urlStr)}` : null
  }
  const hash = hashUrl(urlStr)
  const hit = findFileByHash(hash)
  return hit ? `/uploads/emotes/${hit}` : null
}

function touchFile(absPath) {
  try {
    const now = new Date()
    fs.utimesSync(absPath, now, now)
  } catch (_) { /* ignore */ }
}

function upsertIndexEntry(entry) {
  const map = loadIndex()
  const prev = map.get(entry.url) || {}
  map.set(entry.url, { ...prev, ...entry, cachedAt: entry.cachedAt || Date.now() })
  saveIndex()
}

function cacheStats() {
  ensureCacheDir()
  let totalBytes = 0
  const files = []
  for (const name of fs.readdirSync(CACHE_DIR)) {
    try {
      const st = fs.statSync(path.join(CACHE_DIR, name))
      if (!st.isFile()) continue
      files.push({ name, size: st.size, mtimeMs: st.mtimeMs })
      totalBytes += st.size
    } catch (_) { /* ignore */ }
  }
  return { totalBytes, files }
}

function evictIfNeeded() {
  const { totalBytes, files } = cacheStats()
  if (files.length <= MAX_CACHE_FILES && totalBytes <= MAX_CACHE_BYTES) return

  files.sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first
  let bytes = totalBytes
  let count = files.length
  const map = loadIndex()
  const bySrc = new Map([...map.entries()].map(([url, e]) => [e.src, url]))

  for (const f of files) {
    if (count <= MAX_CACHE_FILES && bytes <= MAX_CACHE_BYTES) break
    try {
      fs.unlinkSync(path.join(CACHE_DIR, f.name))
      bytes -= f.size
      count--
      const src = `/uploads/emotes/${f.name}`
      const url = bySrc.get(src)
      if (url) map.delete(url)
    } catch (_) { /* ignore */ }
  }
  saveIndex()
}

/**
 * Ensure emote bytes are on disk. Returns local `/uploads/emotes/...` path.
 * @param {string} urlStr
 * @param {{ provider?: string, emoteId?: string, name?: string, animated?: boolean }} [meta]
 */
export async function ensureEmoteCached(urlStr, meta = {}) {
  if (!urlStr || typeof urlStr !== 'string') throw new Error('url required')
  if (urlStr.startsWith('/uploads/emotes/')) {
    const file = path.join(CACHE_DIR, path.basename(urlStr))
    if (fs.existsSync(file)) {
      touchFile(file)
      return urlStr
    }
    throw new Error('Local emote file missing')
  }
  if (!isAllowedEmoteUrl(urlStr)) throw new Error('URL host not allowed')

  const already = resolveCachedPath(urlStr)
  if (already) {
    const abs = path.join(CACHE_DIR, path.basename(already))
    touchFile(abs)
    return already
  }

  ensureCacheDir()
  const hash = hashUrl(urlStr)
  const existing = findFileByHash(hash)
  if (existing) {
    const src = `/uploads/emotes/${existing}`
    const abs = path.join(CACHE_DIR, existing)
    touchFile(abs)
    let size = 0
    try { size = fs.statSync(abs).size } catch (_) { /* ignore */ }
    upsertIndexEntry({
      url: urlStr,
      src,
      provider: meta.provider || '',
      emoteId: meta.emoteId || '',
      name: meta.name || '',
      animated: !!meta.animated,
      size,
      cachedAt: Date.now()
    })
    return src
  }

  const headers = { 'User-Agent': 'OBS-Moderator-Overlay/0.1' }
  try {
    const host = new URL(urlStr).hostname
    if (host === 'media.gifs.ru' || host.endsWith('.gifs.ru')) {
      headers.Referer = 'https://gifs.ru/'
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  } catch (_) { /* ignore */ }
  const res = await fetch(urlStr, {
    headers,
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`Upstream ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = extFromUrl(urlStr, res.headers.get('content-type'))
  const filename = `${hash}.${ext}`
  const dest = path.join(CACHE_DIR, filename)
  fs.writeFileSync(dest, buf)
  const src = `/uploads/emotes/${filename}`
  upsertIndexEntry({
    url: urlStr,
    src,
    provider: meta.provider || '',
    emoteId: meta.emoteId || '',
    name: meta.name || '',
    animated: !!meta.animated,
    size: buf.length,
    cachedAt: Date.now()
  })
  evictIfNeeded()
  return src
}

/** Alias used by older callers */
export async function cacheEmoteUrl(urlStr, meta) {
  return ensureEmoteCached(urlStr, meta)
}

export function listCachedManifest() {
  const map = loadIndex()
  ensureCacheDir()
  const out = []
  for (const e of map.values()) {
    const file = path.join(CACHE_DIR, path.basename(e.src || ''))
    if (!e.src || !fs.existsSync(file)) continue
    out.push({
      url: e.url,
      src: e.src,
      provider: e.provider || '',
      id: e.emoteId || '',
      name: e.name || e.emoteId || 'Emote',
      animated: !!e.animated,
      size: e.size || 0,
      cachedAt: e.cachedAt || 0
    })
  }
  // Also pick up orphan files not in index (hash-only)
  try {
    const indexed = new Set(out.map((e) => path.basename(e.src)))
    for (const name of fs.readdirSync(CACHE_DIR)) {
      if (indexed.has(name)) continue
      if (!/\.(webp|png|gif|jpg|jpeg)$/i.test(name)) continue
      out.push({
        url: '',
        src: `/uploads/emotes/${name}`,
        provider: '',
        id: name.replace(/\.[^.]+$/, ''),
        name: name,
        animated: /\.gif$/i.test(name),
        size: 0,
        cachedAt: 0
      })
    }
  } catch (_) { /* ignore */ }

  out.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
  return out
}

/**
 * Rewrite remote emote layer.src to local cache. Mutates scene.layers in place.
 * Returns number of layers rewritten.
 */
export async function hydrateSceneEmotes(scene) {
  if (!scene || !Array.isArray(scene.layers)) return 0
  let changed = 0
  for (const layer of scene.layers) {
    if (!layer || layer.type !== 'emote') continue
    const src = layer.src
    if (!isRemoteEmoteUrl(src)) continue
    try {
      const local = await ensureEmoteCached(src, {
        provider: layer.emote?.provider,
        emoteId: layer.emote?.emoteId,
        name: layer.name,
        animated: layer.emote?.animated
      })
      if (local && local !== src) {
        layer.src = local
        changed++
      }
    } catch (err) {
      // Offline hit by hash
      const hit = resolveCachedPath(src)
      if (hit && hit !== src) {
        layer.src = hit
        changed++
      } else {
        console.warn('[emote-cache] hydrate skip', src, err.message)
      }
    }
  }
  return changed
}

export function mountEmoteCacheRoutes(app, requireModerator) {
  // Public proxy + cache (allowlisted hosts only) — <img> needs no Bearer.
  app.get('/api/emotes/asset', async (req, res) => {
    const url = String(req.query.url || '')
    if (!url) return res.status(400).json({ ok: false, error: 'url required' })
    if (!isAllowedEmoteUrl(url)) return res.status(400).json({ ok: false, error: 'host not allowed' })
    try {
      const hit = resolveCachedPath(url)
      const local = hit || await ensureEmoteCached(url)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return res.redirect(local)
    } catch (err) {
      const hit = resolveCachedPath(url)
      if (hit) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return res.redirect(hit)
      }
      return res.status(502).json({ ok: false, error: err.message })
    }
  })

  // Local-only list for Cached tab
  app.get('/api/emotes/cached', (req, res) => {
    if (!requireModerator(req, res)) return
    try {
      const { totalBytes, files } = cacheStats()
      res.json({
        ok: true,
        results: listCachedManifest().map((e) => ({
          id: e.id || e.src,
          name: e.name,
          provider: e.provider || 'cached',
          url: e.src,
          src: e.src,
          animated: e.animated,
          cachedAt: e.cachedAt
        })),
        stats: { files: files.length, bytes: totalBytes, maxBytes: MAX_CACHE_BYTES, maxFiles: MAX_CACHE_FILES }
      })
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message })
    }
  })

  // Resolve to local path JSON (rewrite layer.src on add).
  app.post('/api/emotes/cache', async (req, res) => {
    if (!requireModerator(req, res)) return
    const url = String(req.body?.url || '')
    if (!url) return res.status(400).json({ ok: false, error: 'url required' })
    const meta = {
      provider: req.body?.provider || '',
      emoteId: req.body?.emoteId || req.body?.id || '',
      name: req.body?.name || '',
      animated: !!req.body?.animated
    }
    try {
      const local = await ensureEmoteCached(url, meta)
      res.json({ ok: true, src: local, cached: true })
    } catch (err) {
      const hit = resolveCachedPath(url)
      if (hit) return res.json({ ok: true, src: hit, cached: true, offline: true })
      res.status(502).json({ ok: false, error: err.message })
    }
  })
}
