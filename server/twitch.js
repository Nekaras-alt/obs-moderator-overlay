// server/twitch.js
// Proxy for Twitch chat emotes from BetterTTV, FrankerFaceZ, and 7TV.
//
// The Twitch chat client (client-side IRC over WSS) resolves the channel ID
// from the IRC ROOMSTATE tag, then calls this proxy to fetch all three
// providers' channel + global emotes in one round-trip. This avoids CORS
// issues (the three providers have inconsistent CORS headers) and lets us
// cache aggressively — channel emotes rarely change mid-stream.
//
// Normalized emote shape:
//   { code, url, provider, animated }
// `code` is the text users type in chat (e.g. "Kappa"). `url` is a direct
// CDN URL for the largest available size. The client builds a Map<code, url>
// and replaces matching words in each chat message with <img> tags.
//
// Routes:
//   GET /api/twitch/channel-emotes?channelId=<id>  — channel + global emotes
//   GET /api/twitch/resolve-channel?channel=<name> — resolve name → id

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 min — emote sets change infrequently
const cache = new Map()

function cached(key, compute) {
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value)
  return Promise.resolve(compute()).then((value) => {
    cache.set(key, { at: now, value })
    if (cache.size > 128) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }
    return value
  })
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
  if (!r.ok) throw new Error(`${r.status} from ${url}`)
  return r.json()
}

// --- Channel name → ID resolution -------------------------------------------
// Twitch's own API needs a client-id + token, which we don't have. We use
// DecAPI (a community service) which returns the numeric ID as plain text.
// Falls back to the IRC ROOMSTATE tag if this fails (the client handles that).
async function resolveChannelId(channel) {
  const key = 'resolve:' + channel.toLowerCase()
  return cached(key, async () => {
    const r = await fetch(`https://decapi.me/twitch/id/${encodeURIComponent(channel)}`, {
      cache: 'no-store'
    })
    if (!r.ok) throw new Error('decapi ' + r.status)
    const text = (await r.text()).trim()
    if (!/^\d+$/.test(text)) throw new Error('Could not resolve channel: ' + text)
    return { ok: true, channelId: text }
  })
}

// --- BTTV --------------------------------------------------------------------
// Channel: GET https://api.betterttv.net/3/cached/users/twitch/<id>
// Response: { id, name, avatar, channelEmotes: [...], sharedEmotes: [...], bots }
// Each emote: { id, code, imageType, userId, user }
// Global: GET https://api.betterttv.net/3/cached/emotes/global
// Each: { id, code, imageType, height, width }
function bttvNorm(e) {
  const ext = e.imageType === 'png' ? 'png' : 'gif'
  return {
    code: e.code,
    url: `https://cdn.betterttv.net/emote/${e.id}/3x.${ext}`,
    provider: 'bttv',
    animated: ext === 'gif'
  }
}

async function bttvChannel(channelId) {
  try {
    const data = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`)
    const emotes = [
      ...(data.channelEmotes || []),
      ...(data.sharedEmotes || [])
    ].map(bttvNorm)
    return emotes
  } catch (_) { return [] }
}

async function bttvGlobal() {
  try {
    const data = await fetchJson('https://api.betterttv.net/3/cached/emotes/global')
    return (data || []).map(bttvNorm)
  } catch (_) { return [] }
}

// --- FFZ ---------------------------------------------------------------------
// Channel: GET https://api.frankerfacez.com/v1/room/id/<id>
// Response: { room: {...}, sets: { <setid>: { emotes: [...] } } }
// Each emote: { id, name, height, width, urls: { 1, 2, 4 } }
// Global: GET https://api.frankerfacez.com/v1/set/global
// Response: { sets: { <setid>: { emotes: [...] } } }
function ffzNorm(e) {
  const urls = e.urls || {}
  const url = urls['4'] || urls['2'] || urls['1'] || ''
  // FFZ URLs are relative (e.g. "/emote/123/4"). Prepend CDN origin if relative.
  const full = url && url.startsWith('//') ? 'https:' + url
    : url && url.startsWith('/') ? 'https://cdn.frankerfacez.com' + url
    : url
  return {
    code: e.name,
    url: full,
    provider: 'ffz',
    animated: false
  }
}

async function ffzChannel(channelId) {
  try {
    const data = await fetchJson(`https://api.frankerfacez.com/v1/room/id/${channelId}`)
    const emotes = []
    for (const set of Object.values(data.sets || {})) {
      for (const e of (set.emotes || [])) emotes.push(ffzNorm(e))
    }
    return emotes
  } catch (_) { return [] }
}

async function ffzGlobal() {
  try {
    const data = await fetchJson('https://api.frankerfacez.com/v1/set/global')
    const emotes = []
    for (const set of Object.values(data.sets || {})) {
      for (const e of (set.emotes || [])) emotes.push(ffzNorm(e))
    }
    return emotes
  } catch (_) { return [] }
}

// --- 7TV ---------------------------------------------------------------------
// Channel: GET https://7tv.io/v3/users/twitch/<id>
// Response: { user: {...}, emote_set: { emotes: [...] } }
// Each emote: { id, name, flags, data: { animated, host: { url, files: [...] } } }
// Global: GET https://7tv.io/v3/emote-sets/global
// Response: { emotes: [...] }
function sevenNorm(e) {
  const data = e.data || {}
  const host = data.host || {}
  const files = host.files || []
  // Prefer 4x.webp, then 4x.avif, then any 4x, then largest available.
  const best = files.find(f => f.name === '4x.webp')
    || files.find(f => f.name === '4x.avif')
    || files.find(f => f.name?.startsWith('4x'))
    || files[files.length - 1]
  const url = best && host.url ? `https:${host.url}/${best.name}` : ''
  return {
    code: e.name,
    url,
    provider: '7tv',
    animated: !!data.animated
  }
}

async function sevenChannel(channelId) {
  try {
    const data = await fetchJson(`https://7tv.io/v3/users/twitch/${channelId}`)
    const emotes = ((data.emote_set?.emotes) || []).map(sevenNorm)
    return emotes
  } catch (_) { return [] }
}

async function sevenGlobal() {
  try {
    const data = await fetchJson('https://7tv.io/v3/emote-sets/global')
    const emotes = ((data.emotes) || []).map(sevenNorm)
    return emotes
  } catch (_) { return [] }
}

// --- Combined fetch ----------------------------------------------------------
// Fetch all providers' channel + global emotes in parallel. Returns a flat
// array of normalized emotes. Deduplicates by code (first wins, channel
// emotes take priority over global since they're fetched first in the
// Promise.all order — but we sort channel before global in the merge).
async function fetchAllEmotes(channelId) {
  const key = 'emotes:' + channelId
  return cached(key, async () => {
    const [bttvCh, bttvGl, ffzCh, ffzGl, sevenCh, sevenGl] = await Promise.all([
      bttvChannel(channelId),
      bttvGlobal(),
      ffzChannel(channelId),
      ffzGlobal(),
      sevenChannel(channelId),
      sevenGlobal()
    ])
    // Channel emotes first (higher priority), then global. Dedup by code.
    const all = [...bttvCh, ...ffzCh, ...sevenCh, ...bttvGl, ...ffzGl, ...sevenGl]
    const seen = new Set()
    const deduped = []
    for (const e of all) {
      if (!e.code || !e.url) continue
      const key = e.code.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(e)
    }
    return { ok: true, emotes: deduped }
  })
}

export function mountTwitchRoutes(app, requireModerator) {
  // GET /api/twitch/resolve-channel?channel=<name>
  // Resolves a Twitch channel name to its numeric user ID.
  app.get('/api/twitch/resolve-channel', async (req, res) => {
    if (!requireModerator(req, res)) return
    const channel = String(req.query.channel || '').trim().toLowerCase().replace(/^#/, '')
    if (!channel) return res.status(400).json({ ok: false, error: 'channel required' })
    try {
      const result = await resolveChannelId(channel)
      res.json(result)
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message })
    }
  })

  // GET /api/twitch/channel-emotes?channelId=<id>
  // Returns all BTTV + FFZ + 7TV channel + global emotes for the given
  // Twitch channel ID. The client builds a Map<code, url> for rendering.
  app.get('/api/twitch/channel-emotes', async (req, res) => {
    if (!requireModerator(req, res)) return
    const channelId = String(req.query.channelId || '').trim()
    if (!/^\d+$/.test(channelId)) return res.status(400).json({ ok: false, error: 'numeric channelId required' })
    try {
      const result = await fetchAllEmotes(channelId)
      res.json(result)
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message })
    }
  })

  // GET /api/twitch/embed?channel=<name>
  // Same-origin wrapper so Twitch parent=localhost works from Electron / Tailscale.
  // Top-window breakout is blocked in electron/main.cjs (will-navigate), not by
  // stripping allow-same-origin (that blanked the embeds).
  app.get('/api/twitch/embed', (req, res) => {
    const channel = String(req.query.channel || '').trim().toLowerCase().replace(/^#/, '')
    if (!channel) return res.status(400).send('channel required')
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}
  iframe{width:100%;height:100%;border:0}
</style>
</head><body>
<iframe
  src="https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=localhost&muted=true&autoplay=true"
  frameborder="0" scrolling="no" allowfullscreen
  allow="autoplay; fullscreen"
></iframe>
</body></html>`
    res.set('Content-Type', 'text/html')
    res.set('X-Frame-Options', 'SAMEORIGIN')
    res.set('Referrer-Policy', 'no-referrer')
    res.send(html)
  })

  // Chat embed proxy (same Tailscale/IP + Electron parent workaround as player).
  app.get('/api/twitch/embed-chat', (req, res) => {
    const channel = String(req.query.channel || '').trim().toLowerCase().replace(/^#/, '')
    if (!channel) return res.status(400).send('channel required')
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#0e0e10;width:100%;height:100%}
  iframe{width:100%;height:100%;border:0}
</style>
</head><body>
<iframe
  src="https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=localhost&darkpopout"
  frameborder="0"
></iframe>
</body></html>`
    res.set('Content-Type', 'text/html')
    res.set('X-Frame-Options', 'SAMEORIGIN')
    res.set('Referrer-Policy', 'no-referrer')
    res.send(html)
  })
}
