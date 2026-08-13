// server/sounds.js
// Sound search proxy for the SoundPad panel.
//
// Two providers, both no-API-key:
//   myinstants — Django REST endpoint at /api/v1/instants/?search=<q>&page=<n>
//   uwupad     — JSON API at /api/search?v3=true&query=<q>&limit=<n>&offset=<n>
//
// Normalized result shape (every adapter returns this):
//   { id, name, provider, url }
// `url` is a direct audio URL the <audio> element can play.

import { mountSoundCacheRoutes } from './sound-cache.js'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map()

function cached(key, compute) {
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value)
  return Promise.resolve(compute()).then((value) => {
    cache.set(key, { at: now, value })
    if (cache.size > 256) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }
    return value
  })
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
    cache: 'no-store',
    signal: opts.signal
  })
  if (!r.ok) throw new Error('upstream ' + r.status + ' from ' + url)
  return r.json()
}

// --- MyInstants adapter -----------------------------------------------------
// The official API endpoint (/api/v1/instants/?search=<q>) is broken — it
// ignores the search parameter and always returns the same trending list.
// Instead we scrape the HTML search page at /en/search/?name=<q>&page=<n>,
// which works correctly. Each result has a play() onclick with the sound path
// and slug, plus the button title as the name.
function myinstantsNorm(name, soundPath, slug) {
  const soundUrl = 'https://www.myinstants.com' + soundPath
  const ext = soundPath.split('.').pop() || 'mp3'
  return {
    id: 'mi:' + slug,
    name: name || '',
    provider: 'myinstants',
    url: `/api/sounds/proxy.${ext}?url=${encodeURIComponent(soundUrl)}`
  }
}

async function myinstantsSearch(q, page) {
  if (!q) {
    // Empty query → trending (use the API for trending since it works for that)
    const params = new URLSearchParams()
    if (page > 1) params.set('page', String(page))
    const url = 'https://www.myinstants.com/api/v1/instants/' + (params.toString() ? '?' + params : '')
    const data = await cached('myinstants:' + url, () => fetchJson(url))
    const results = (data.results || []).map((r) => {
      const soundUrl = r.sound || ''
      if (!soundUrl) return null
      const ext = soundUrl.split('.').pop() || 'mp3'
      return {
        id: 'mi:' + (r.slug || ''),
        name: r.name || '',
        provider: 'myinstants',
        url: `/api/sounds/proxy.${ext}?url=${encodeURIComponent(soundUrl)}`
      }
    }).filter(Boolean)
    return { ok: true, results, count: data.count || results.length }
  }

  // Search via HTML scraping — the API's search parameter is broken.
  // No caching for search results: the cache was causing stale/wrong results
  // to be returned for different queries (race condition in the cached() helper).
  // Cache-buster (_t) prevents HTTP-level response caching.
  const url = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(q)}&page=${page}&_t=${Date.now()}`
  const r = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  if (!r.ok) throw new Error('upstream ' + r.status)
  const html = await r.text()

  // Parse each <button> with onclick="play('/media/sounds/xxx.mp3', ...)"
  // and title="Play <name> sound". We extract sound path, slug, and name
  // from the same button element to avoid misalignment.
  const results = []
  // Match the full <button ...> tag that contains both onclick=play and title="Play ..."
  const buttonRe = /<button[^>]*onclick="play\('([^']+)',\s*'[^']+',\s*'([^']+)'\)"[^>]*title="Play ([^"]+) sound"[^>]*>/g
  let match
  while ((match = buttonRe.exec(html)) !== null) {
    results.push(myinstantsNorm(match[3].trim(), match[1], match[2]))
  }

  // Estimate count: ~10 per page.
  const ql = String(q || '').toLowerCase()
  results.sort((a, b) => {
    const ae = a.name.toLowerCase() === ql ? 0 : a.name.toLowerCase().startsWith(ql) ? 1 : 2
    const be = b.name.toLowerCase() === ql ? 0 : b.name.toLowerCase().startsWith(ql) ? 1 : 2
    return ae - be
  })
  const sliced = results.slice(0, 10)
  const count = results.length >= 10 ? page * 10 + 10 : page * 10
  return { ok: true, results: sliced, count }
}

// --- UWUPad adapter ---------------------------------------------------------
// Search: GET https://uwupad.me/api/search?v3=true&query=<q>&limit=<n>&offset=<n>
// Response: { total, data: [{ id, title, extension, original_id, ... }] }
// CDN URL: https://cdn.uwupad.me/{original_id || id}.{extension}
// Trending: GET https://uwupad.me/api/sounds/?v3=true&tab=popular&limit=<n>&offset=<n>
const UWUPAD_CDN = 'https://cdn.uwupad.me'

function uwupadNorm(s) {
  const realId = s.original_id || s.id
  const ext = s.extension || 'mp3'
  const cdnUrl = `${UWUPAD_CDN}/${realId}.${ext}`
  return {
    id: 'uw:' + s.id,
    name: s.title || '',
    provider: 'uwupad',
    // Proxy through server — guarantees playback regardless of CORS/mixed-content.
    url: `/api/sounds/proxy.${ext}?url=${encodeURIComponent(cdnUrl)}`
  }
}

async function uwupadSearch(q, page) {
  const limit = 10
  const offset = (page - 1) * limit
  const url = `https://uwupad.me/api/search?v3=true&query=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`
  const data = await cached('uwupad:' + url, () => fetchJson(url))
  let results = (data.data || []).map(uwupadNorm).filter((r) => r.url)
  // Popularity-first: API already returns relevance/popular; boost exact name match to top.
  const ql = String(q || '').toLowerCase()
  if (ql) {
    results = [...results].sort((a, b) => {
      const ae = a.name.toLowerCase() === ql ? 0 : a.name.toLowerCase().startsWith(ql) ? 1 : 2
      const be = b.name.toLowerCase() === ql ? 0 : b.name.toLowerCase().startsWith(ql) ? 1 : 2
      return ae - be
    })
  }
  return { ok: true, results: results.slice(0, 10), count: data.total || results.length }
}

async function uwupadTrending(page) {
  const limit = 20
  const offset = (page - 1) * limit
  const url = `https://uwupad.me/api/sounds/?v3=true&tab=popular&limit=${limit}&offset=${offset}`
  const data = await cached('uwupad:trending:' + url, () => fetchJson(url))
  const results = (data.data || []).map(uwupadNorm).filter((r) => r.url)
  return { ok: true, results, count: data.total || results.length }
}

// Provider dispatch.
const SEARCH = {
  myinstants: myinstantsSearch,
  uwupad: uwupadSearch
}
const TRENDING = {
  myinstants: (page) => myinstantsSearch('', page),
  uwupad: uwupadTrending
}

const VALID_PROVIDERS = Object.keys(SEARCH)

export function mountSoundRoutes(app, requireModerator) {
  mountSoundCacheRoutes(app, requireModerator)
  // GET /api/sounds/search?provider=&q=&page=
  // Empty q → trending/first page for the provider (browse mode).
  app.get('/api/sounds/search', async (req, res) => {
    if (!requireModerator(req, res)) return
    const provider = String(req.query.provider || 'myinstants')
    const fn = SEARCH[provider]
    if (!fn) return res.status(400).json({ ok: false, error: 'unknown provider', provider })
    const q = String(req.query.q || '').trim()
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    try {
      const out = await fn(q, page)
      res.json(out)
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message, provider })
    }
  })

  // GET /api/sounds/trending?provider=&page=
  app.get('/api/sounds/trending', async (req, res) => {
    if (!requireModerator(req, res)) return
    const provider = String(req.query.provider || 'myinstants')
    const fn = TRENDING[provider]
    if (!fn) return res.status(400).json({ ok: false, error: 'unknown provider', provider })
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    try {
      const out = await fn(page)
      res.json(out)
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message, provider })
    }
  })

  // GET /api/sounds/proxy and /api/sounds/proxy.:ext?url=<audio-url>
  // Both routes serve audio directly. The :ext variant is for new URLs so
  // the browser can determine the format from the extension. The plain
  // variant handles already-saved sounds with old URL format.
  // No moderator auth — <audio> can't send Authorization. Security: SSRF
  // whitelist + rate limiting.

  // --- Rate limiter: 60 requests/min per IP ---
  const rateMap = new Map()
  const RATE_LIMIT = 60
  const RATE_WINDOW = 60_000
  function checkRate(ip) {
    const now = Date.now()
    let entry = rateMap.get(ip)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_WINDOW }
      rateMap.set(ip, entry)
    }
    entry.count++
    return entry.count <= RATE_LIMIT
  }
  setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of rateMap) {
      if (now > entry.resetAt) rateMap.delete(ip)
    }
  }, RATE_WINDOW)

  // Shared handler for both route variants.
  async function handleProxy(req, res) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    if (!checkRate(ip)) {
      res.set('Retry-After', '60')
      return res.status(429).json({ ok: false, error: 'rate limit exceeded' })
    }

    const url = String(req.query.url || '').trim()
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ ok: false, error: 'valid url required' })
    }
    const allowed = ['cdn.uwupad.me', 'www.myinstants.com', 'myinstants.com']
    let parsed
    try { parsed = new URL(url) } catch (_) {
      return res.status(400).json({ ok: false, error: 'invalid url' })
    }
    if (!allowed.includes(parsed.hostname)) {
      return res.status(403).json({ ok: false, error: 'host not allowed' })
    }
    try {
      const upstreamHeaders = {
        'Referer': 'https://uwupad.me/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
      // Don't forward Range header — the proxy buffers the full file, so
      // range requests don't make sense and partial-content responses
      // can confuse the browser's media element.
      const upstream = await fetch(url, { headers: upstreamHeaders })
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ ok: false, error: 'upstream ' + upstream.status })
      }
      // Buffer the response and send — simpler and more reliable than
      // streaming for short audio clips. Content-Type is set explicitly
      // so the browser knows it's audio even without a file extension.
      // No Accept-Ranges: the proxy buffers the full file, so range
      // requests don't make sense and can confuse the browser.
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.set('Content-Type', 'audio/mpeg')
      res.set('Content-Length', String(buf.length))
      res.set('Cache-Control', 'public, max-age=3600')
      res.status(200)
      res.send(buf)
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message })
    }
  }

  // Old format: /api/sounds/proxy?url=... (for already-saved sounds)
  app.get('/api/sounds/proxy', handleProxy)
  // New format: /api/sounds/proxy.mp3?url=... (extension for browser compat)
  app.get('/api/sounds/proxy.:ext', handleProxy)

  // GET /api/sounds/waveform?url=<audio-url>
  // Generates a simplified waveform (array of peak amplitudes) from an audio
  // file. Used by the SoundPad properties panel to visualize the sound.
  // Returns JSON: { ok, peaks: [0.0, 0.3, 0.8, ...] } (50 samples, 0..1).
  // No external deps — reads the file and samples raw bytes as a rough
  // approximation. For precise waveforms, ffmpeg would be needed, but this
  // is good enough for a visual preview.
  app.get('/api/sounds/waveform', async (req, res) => {
    const url = String(req.query.url || '').trim()
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ ok: false, error: 'valid url required' })
    }
    const allowed = ['cdn.uwupad.me', 'www.myinstants.com', 'myinstants.com']
    let parsed
    try { parsed = new URL(url) } catch (_) {
      return res.status(400).json({ ok: false, error: 'invalid url' })
    }
    if (!allowed.includes(parsed.hostname) && !parsed.pathname.startsWith('/uploads/')) {
      return res.status(403).json({ ok: false, error: 'host not allowed' })
    }
    try {
      // For /uploads/ paths, read from local disk.
      let buf
      if (parsed.pathname.startsWith('/uploads/')) {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const { fileURLToPath } = await import('node:url')
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        const filePath = path.join(__dirname, '..', parsed.pathname)
        buf = fs.readFileSync(filePath)
      } else {
        const upstream = await fetch(url, {
          headers: {
            'Referer': 'https://uwupad.me/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        })
        if (!upstream.ok) return res.status(502).json({ ok: false, error: 'upstream ' + upstream.status })
        buf = Buffer.from(await upstream.arrayBuffer())
      }
      // Generate 50 peak samples from the raw audio data.
      // Skip MP3 header (first ~4KB usually headers/metadata) and sample
      // the remaining bytes in chunks, taking the max absolute value per chunk.
      const SAMPLES = 50
      const skip = Math.min(4096, buf.length / 4)
      const data = buf.subarray(skip)
      if (data.length === 0) return res.json({ ok: true, peaks: new Array(SAMPLES).fill(0) })
      const chunkSize = Math.floor(data.length / SAMPLES)
      const peaks = []
      for (let i = 0; i < SAMPLES; i++) {
        let max = 0
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, data.length)
        for (let j = start; j < end; j += 4) { // sample every 4th byte
          const val = Math.abs(data[j] - 128)
          if (val > max) max = val
        }
        peaks.push(Math.min(1, max / 128))
      }
      res.json({ ok: true, peaks })
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message })
    }
  })
}

export { VALID_PROVIDERS }