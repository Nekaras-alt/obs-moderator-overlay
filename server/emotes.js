// server/emotes.js
// Emote search proxy for 7TV / BetterTTV / FrankerFaceZ.
//
// Why a proxy at all: the three providers have inconsistent CORS headers, so
// calling them directly from the browser is unreliable. This normalizes them
// into one shape and adds a short in-memory cache so a busy sticker session
// doesn't hammer the upstreams.
//
// Normalized result shape (every adapter returns this):
//   { id, name, provider, url, animated }
// `url` is a direct CDN URL the renderer can drop into <img src>. The OBS
// Browser Source fetches it over HTTPS the same way it fetches any image.
//
// 7TV: uses GraphQL (POST https://7tv.io/v3/gql). Search and the curated
// Global Emotes set work anonymously — no account needed. The moderator MAY
// optionally connect their 7TV account to browse their own emote sets ("My
// Emotes"). That token is stored server-side only and never sent to the
// browser (see server/auth.js get7tvToken/set7tvToken).

import { get7tvToken, set7tvToken, clear7tvToken } from './auth.js'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map() // key -> { at, value }

function cached(key, compute) {
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value)
  return Promise.resolve(compute()).then((value) => {
    cache.set(key, { at: now, value })
    // Bounded cache: drop oldest entries past a soft cap.
    if (cache.size > 256) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }
    return value
  })
}

// Invalidate cache entries for a given prefix (e.g. after connecting 7TV).
function invalidateCache(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

// Memoize an async factory: the first call runs the producer, subsequent calls
// reuse the same promise (and resolved value). The producer runs at most once
// for the lifetime of the process. Used for the BTTV searchable corpus, which
// is built once from two endpoints and then filtered per-query in memory.
function memoizePromise(producer) {
  let p = null
  return () => {
    if (!p) p = Promise.resolve(producer())
    return p
  }
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${url}`)
  return r.json()
}

// --- 7TV (GraphQL) ------------------------------------------------------------
// Endpoint: POST https://7tv.io/v3/gql
// Search + Global Emotes set: anonymous (no token).
// My Emotes (user's emote sets): requires Bearer token (stored server-side).

const SEVEN_GQL = 'https://7tv.io/v3/gql'

async function sevenGql(query, variables, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const r = await fetch(SEVEN_GQL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    cache: 'no-store'
  })
  // 7TV wraps errors in JSON even on 401; surface the useful message.
  const body = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = body?.error || body?.errors?.[0]?.message || `${r.status} ${r.statusText}`
    const err = new Error(msg)
    err.status = r.status
    throw err
  }
  if (body?.errors?.length) {
    throw new Error(body.errors[0].message)
  }
  return body.data
}

// Pick the best CDN URL from a 7TV host.files array.
// Prefers 4x.webp (animated-friendly, high-res), then 4x.gif, then any 4x,
// then the largest available.
function sevenBestUrl(host) {
  if (!host?.files?.length) return ''
  const base = host.url.startsWith('//') ? 'https:' + host.url : host.url
  const pick = (pref) => {
    const f = host.files.find((x) => pref(x))
    return f ? `${base}/${f.name}` : null
  }
  // Exact 4x.webp > 4x.gif > any 4x > largest file
  return (
    pick((x) => x.name === '4x.webp') ||
    pick((x) => x.name === '4x.gif') ||
    pick((x) => x.name.startsWith('4x.')) ||
    (() => {
      // Sort by width descending, pick first
      const sorted = [...host.files].sort((a, b) => (b.width || 0) - (a.width || 0))
      return sorted[0] ? `${base}/${sorted[0].name}` : ''
    })()
  )
}

function sevenNorm(e) {
  const host = e.host || {}
  return {
    id: e.id,
    name: e.name,
    provider: '7tv',
    url: sevenBestUrl(host),
    animated: !!e.animated
  }
}

// For ActiveEmote items inside EmoteSet — the emote data is nested in .data
function sevenActiveNorm(ae) {
  const emote = ae.data || ae
  return sevenNorm(emote)
}

const SEVEN_SEARCH_Q = `
  query SearchEmotes($query: String!, $page: Int, $limit: Int) {
    emotes(query: $query, page: $page, limit: $limit) {
      count
      items { id name animated host { url files { name format width } } }
    }
  }`

const SEVEN_GLOBAL_Q = `
  query GlobalSet {
    namedEmoteSet(name: GLOBAL) {
      id
      name
      emote_count
      emotes {
        id
        name
        data { id name animated host { url files { name format width } } }
      }
    }
  }`

const SEVEN_ACTOR_Q = `
  query { actor { id username } }`

const SEVEN_USER_SETS_Q = `
  query UserSets($id: ObjectID!) {
    user(id: $id) {
      username
      emote_sets {
        id
        name
        emote_count
        emotes {
          id
          name
          data { id name animated host { url files { name format width } } }
        }
      }
    }
  }`

async function sevenSearch(q, limit) {
  const data = await sevenGql(SEVEN_SEARCH_Q, { query: q, page: 1, limit })
  const items = data?.emotes?.items
  return (Array.isArray(items) ? items : []).map(sevenNorm).filter((e) => e.url)
}

async function sevenGlobal() {
  const data = await sevenGql(SEVEN_GLOBAL_Q, {})
  const emotes = data?.namedEmoteSet?.emotes
  return (Array.isArray(emotes) ? emotes : []).map(sevenActiveNorm).filter((e) => e.url)
}

// Fetch all emotes from the authenticated user's emote sets.
// Returns { ok, username, results } or throws.
async function sevenMyEmotes(token) {
  // 1. Identify the actor.
  const actorData = await sevenGql(SEVEN_ACTOR_Q, {}, token)
  const actor = actorData?.actor
  if (!actor?.id) throw new Error('Token rejected by 7TV — check your access token')

  // 2. Fetch their emote sets.
  const userData = await sevenGql(SEVEN_USER_SETS_Q, { id: actor.id }, token)
  const user = userData?.user
  const sets = user?.emote_sets || []

  // 3. Flatten all sets into one list, dedup by emote id.
  const seen = new Set()
  const results = []
  for (const set of sets) {
    const emotes = set.emotes || []
    for (const ae of emotes) {
      const normed = sevenActiveNorm(ae)
      if (normed.url && !seen.has(normed.id)) {
        seen.add(normed.id)
        results.push(normed)
      }
    }
  }
  return { ok: true, username: user.username, setCount: sets.length, results }
}

// --- BetterTTV ---------------------------------------------------------------
// Two working endpoints back the picker:
//   - /3/emotes/shared/search?query=...&limit=...&offset=...
//       Real text search across the whole shared-emote catalog. Returns bare
//       emote objects (same shape as /cached/emotes/global): { id, code,
//       imageType, animated }. Honors `limit`.
//   - /3/cached/emotes/global  +  /3/emotes/shared/top
//       The browse corpus: the official global set (~65) plus the trending
//       shared emotes (~100). /top wraps each in { emote: {...} }.
// (Note: the sibling GET /3/emotes/shared ignores its `query` param entirely —
//  it always returns the same trending list — so it is useless for search and
//  not used here.)
// CDN:    https://cdn.betterttv.net/emote/{id}/3x.{gif|png}
function bttvExt(e) {
  return (e.imageType || 'png').toLowerCase()
}
function bttvUrl(e) {
  // Pick an animated asset when the emote is animated (gif), else png.
  const ext = e.animated ? 'gif' : bttvExt(e)
  return `https://cdn.betterttv.net/emote/${e.id}/3x.${ext}`
}
function bttvNorm(e) {
  return { id: e.id, name: e.code, provider: 'bttv', url: bttvUrl(e), animated: !!e.animated }
}
// Search the shared-emote catalog server-side. Empty query is handled by the
// caller (which routes to bttvGlobal for the browse list instead).
async function bttvSearch(q, limit) {
  const data = await fetchJson(
    `https://api.betterttv.net/3/emotes/shared/search?query=${encodeURIComponent(q)}&limit=${limit}`
  )
  const list = Array.isArray(data) ? data : []
  return list.map(bttvNorm).filter((e) => e.url)
}
// Fetch the merged global + trending BTTV corpus (deduped by id). The /top
// list wraps each emote in { emote: {...} }, so unwrap it before normalizing.
const bttvCorpus = memoizePromise(async () => {
  const [globalRes, topRes] = await Promise.allSettled([
    fetchJson('https://api.betterttv.net/3/cached/emotes/global'),
    fetchJson('https://api.betterttv.net/3/emotes/shared/top')
  ])
  const seen = new Set()
  const out = []
  const push = (raw) => {
    if (!raw || !raw.id || seen.has(raw.id)) return
    seen.add(raw.id)
    out.push(bttvNorm(raw))
  }
  if (globalRes.status === 'fulfilled') {
    for (const e of Array.isArray(globalRes.value) ? globalRes.value : []) push(e)
  }
  if (topRes.status === 'fulfilled') {
    for (const wrapped of Array.isArray(topRes.value) ? topRes.value : []) {
      // /top returns { emote: {...} }; global returns the bare emote.
      push(wrapped.emote || wrapped)
    }
  }
  return out
})
async function bttvGlobal() {
  // Browse tab: show the full merged corpus (global + trending), deduped.
  return bttvCorpus().then((list) => list.slice())
}

// --- FrankerFaceZ ------------------------------------------------------------
// Search: GET https://api.frankerfacez.com/v1/emotes?q=...&per_page=...
//   -> { emotes: [{id,name,urls:{1,2,4},animated:{1,2,4}|undefined}] }
// Global: GET https://api.frankerfacez.com/v1/set/global
//   -> { sets: { "<id>": { emoticons: [...] } } } (we merge every set)
function ffzBestUrl(e) {
  // Prefer an animated asset if present, else the largest static size.
  if (e.animated) return e.animated['4'] || e.animated['2'] || e.animated['1'] || null
  const u = e.urls || {}
  return u['4'] || u['2'] || u['1'] || null
}
function ffzNorm(e) {
  return {
    id: String(e.id),
    name: e.name,
    provider: 'ffz',
    url: ffzBestUrl(e) || '',
    animated: !!e.animated
  }
}
async function ffzSearch(q, limit) {
  const data = await fetchJson(
    `https://api.frankerfacez.com/v1/emotes?q=${encodeURIComponent(q)}&per_page=${limit}`
  )
  const list = Array.isArray(data?.emoticons) ? data.emoticons : []
  return list.map(ffzNorm).filter((e) => e.url)
}
async function ffzGlobal() {
  const data = await fetchJson('https://api.frankerfacez.com/v1/set/global')
  const sets = data?.sets || {}
  const out = []
  for (const key of Object.keys(sets)) {
    const emotes = sets[key]?.emoticons
    if (Array.isArray(emotes)) for (const e of emotes) out.push(ffzNorm(e))
  }
  return out.filter((e) => e.url)
}

// --- Dispatch ----------------------------------------------------------------
const SEARCH = { bttv: bttvSearch, ffz: ffzSearch, '7tv': sevenSearch }
const GLOBAL = { bttv: bttvGlobal, ffz: ffzGlobal, '7tv': sevenGlobal }

// Mount the emote search/browse routes. `requireModerator(req, res)` is the same
// gate the OBS write endpoints use (server/index.js) — passed in so this module
// stays decoupled from the auth implementation. Only the moderator (editor)
// needs the picker; the /obs viewer never calls these.
export function mountEmoteRoutes(app, requireModerator) {
  // GET /api/emotes/search?provider=7tv|bttv|ffz&q=...&limit=...
  app.get('/api/emotes/search', (req, res) => {
    if (!requireModerator(req, res)) return
    const { provider, q } = req.query
    const limit = Math.min(parseInt(req.query.limit, 10) || 36, 80)
    if (!q || !String(q).trim()) return res.json({ ok: true, results: [] })
    const fn = SEARCH[provider]
    if (!fn) return res.status(400).json({ ok: false, error: 'Unsupported provider for search' })
    cached(`search|${provider}|${q}|${limit}`, () => fn(String(q).trim(), limit))
      .then((results) => res.json({ ok: true, results }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider }))
  })

  // GET /api/emotes/global?provider=7tv|bttv|ffz
  app.get('/api/emotes/global', (req, res) => {
    if (!requireModerator(req, res)) return
    const { provider } = req.query
    const fn = GLOBAL[provider]
    if (!fn) return res.status(400).json({ ok: false, error: 'Unsupported provider for browse' })
    cached(`global|${provider}`, () => fn())
      .then((results) => res.json({ ok: true, results }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider }))
  })

  // --- 7TV account routes (moderator only) -----------------------------------
  // All of these use the token stored server-side in data/.secret.
  // The browser NEVER sees the 7TV token.

  // GET /api/emotes/my?provider=7tv
  // Fetch all emotes from the connected 7TV user's emote sets.
  app.get('/api/emotes/my', (req, res) => {
    if (!requireModerator(req, res)) return
    if (req.query.provider !== '7tv') return res.status(400).json({ ok: false, error: 'My Emotes only supports 7TV' })
    const token = get7tvToken()
    if (!token) return res.json({ ok: true, connected: false, results: [] })
    sevenMyEmotes(token)
      .then((result) => res.json({ ok: true, connected: true, ...result }))
      .catch((err) => res.status(502).json({ ok: false, connected: true, error: err.message, provider: '7tv' }))
  })

  // POST /api/emotes/7tv-login  { token: "..." }
  // Verify the token against 7TV's actor query, then persist it.
  app.post('/api/emotes/7tv-login', (req, res) => {
    if (!requireModerator(req, res)) return
    const { token } = req.body || {}
    const trimmed = String(token || '').trim()
    if (!trimmed) return res.status(400).json({ ok: false, error: 'Token is required' })
    // Verify by calling actor query.
    sevenGql(SEVEN_ACTOR_Q, {}, trimmed)
      .then((data) => {
        const actor = data?.actor
        if (!actor?.id) return res.status(401).json({ ok: false, error: 'Token rejected by 7TV — check and try again' })
        set7tvToken(trimmed)
        invalidateCache('global|7tv')
        res.json({ ok: true, username: actor.username })
      })
      .catch((err) => {
        const status = err.status === 401 ? 401 : 502
        res.status(status).json({ ok: false, error: err.message })
      })
  })

  // GET /api/emotes/7tv-account
  // Check if a 7TV token is stored and still valid (probes actor, never
  // returns the token itself to the client).
  app.get('/api/emotes/7tv-account', async (req, res) => {
    if (!requireModerator(req, res)) return
    const token = get7tvToken()
    if (!token) return res.json({ connected: false })
    try {
      const data = await sevenGql(SEVEN_ACTOR_Q, {}, token)
      const actor = data?.actor
      if (!actor?.id) {
        clear7tvToken()
        return res.json({ connected: false })
      }
      res.json({ connected: true, username: actor.username })
    } catch (_) {
      // Token is probably expired or revoked.
      clear7tvToken()
      res.json({ connected: false })
    }
  })

  // DELETE /api/emotes/7tv-account
  // Disconnect: wipe the stored token.
  app.delete('/api/emotes/7tv-account', (req, res) => {
    if (!requireModerator(req, res)) return
    clear7tvToken()
    invalidateCache('global|7tv')
    invalidateCache('my|7tv')
    res.json({ ok: true, connected: false })
  })
}
