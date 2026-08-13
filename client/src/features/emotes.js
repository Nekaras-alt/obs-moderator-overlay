// client/src/features/emotes.js
// Client-side helpers for the Stickers/Emotes panel. Talks to the
// server-side proxy (server/emotes.js) for search/browse, and constructs CDN
// URLs directly for the "By URL/ID" tab (no round-trip needed).
//
// Assets are proxied/cached via /api/emotes/asset and POST /api/emotes/cache
// so editor + OBS keep working offline after the first successful download.

import { useSceneStore } from '../stores/scene.js'

// Provider metadata + CDN URL builders. `search`/`global` flags tell the panel
// which features a provider supports. `myEmotes` means the provider supports
// fetching the connected user's personal emote sets.
export const PROVIDERS = {
  '7tv': {
    label: '7TV',
    color: '#22d3ee',
    search: true,
    global: true,
    myEmotes: true,
    // CDN: 4x is the largest size; .webp covers both static and animated.
    cdn: (id) => `https://cdn.7tv.app/emote/${id}/4x.webp`,
    // 7TV ids are 24-char objectids (legacy) or ULIDs.
    idPattern: /^[A-Za-z0-9]{20,26}$/
  },
  'bttv': {
    label: 'BetterTTV',
    color: '#3498db',
    search: true,
    global: true,
    myEmotes: false,
    // Ext comes from the emote's imageType; for the By-ID tab we default to gif
    // (BTTV's animated emotes are gif) and let the user toggle static/png.
    cdn: (id, opts = {}) => `https://cdn.betterttv.net/emote/${id}/3x.${opts.static ? 'png' : 'gif'}`,
    idPattern: /^[a-f0-9]{24}$/i
  },
  'ffz': {
    label: 'FrankerFaceZ',
    color: '#a855f7',
    search: true,
    global: true,
    myEmotes: false,
    // FFZ CDN: /emote/{id}/{1|2|4} (static) or /emote/{id}/animated/{1|2|4}.
    cdn: (id, opts = {}) => opts.animated
      ? `https://cdn.frankerfacez.com/emote/${id}/animated/4`
      : `https://cdn.frankerfacez.com/emote/${id}/4`,
    idPattern: /^\d+$/
  },
  'gifsru': {
    label: 'GIFS.RU',
    color: '#f97316',
    search: true,
    global: false,
    myEmotes: false,
    cdn: (id) => `https://media.gifs.ru/${id}.gif`,
    idPattern: /^[a-f0-9]{32,64}$/i
  }
}

export const PROVIDER_KEYS = Object.keys(PROVIDERS)

function token() { return localStorage.getItem('omo_token') || '' }

function authHeaders() { return { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' } }

/** Rewrite CDN URL through local cache proxy for <img> thumbs. */
export function proxiedEmoteUrl(cdnUrl) {
  if (!cdnUrl) return ''
  if (cdnUrl.startsWith('/uploads/emotes/') || cdnUrl.startsWith('/api/emotes/asset')) return cdnUrl
  if (!/^https?:\/\//i.test(cdnUrl)) return cdnUrl
  return `/api/emotes/asset?url=${encodeURIComponent(cdnUrl)}`
}

// Build a CDN URL for the "By URL/ID" tab. `input` may already be a full URL
// (then it's returned as-is) or a bare emote id, in which case we use the
// provider's cdn() builder. Returns { url, provider, emoteId } or null.
export function buildCdnUrl(provider, input, opts = {}) {
  const cfg = PROVIDERS[provider]
  if (!cfg) return null
  const s = String(input || '').trim()
  if (!s) return null
  // Already a full URL — accept it verbatim (covers pasted CDN links too).
  if (/^https?:\/\//i.test(s)) return { url: s, provider, emoteId: '' }
  // Bare id → construct via the provider's CDN template.
  return { url: cfg.cdn(s, opts), provider, emoteId: s }
}

// Search/browse via the server proxy. Both resolve to the normalized
// { id, name, provider, url, animated } shape (or throw on error).
export async function searchEmotes(provider, q, limit = 36) {
  const r = await fetch(
    `/api/emotes/search?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: { Authorization: 'Bearer ' + token() } }
  )
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Search failed')
  return json.results || []
}

export async function globalEmotes(provider) {
  const r = await fetch(
    `/api/emotes/global?provider=${encodeURIComponent(provider)}`,
    { headers: { Authorization: 'Bearer ' + token() } }
  )
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Failed to load global emotes')
  return json.results || []
}

/** 7TV catalog sections from 7tv.app/emotes (TOP / TRENDING_* / NEW / GLOBAL). */
export async function catalogEmotes(category = 'TOP', limit = 48, page = 1) {
  const r = await fetch(
    `/api/emotes/catalog?provider=7tv&category=${encodeURIComponent(category)}&limit=${limit}&page=${page}`,
    { headers: { Authorization: 'Bearer ' + token() } }
  )
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Failed to load 7TV catalog')
  return {
    results: json.results || [],
    page: json.page || page,
    limit: json.limit || limit,
    count: json.count ?? null,
    hasMore: !!json.hasMore
  }
}

async function gifsruGet(path) {
  const r = await fetch('/api/emotes/gifsru/' + path, {
    headers: { Authorization: 'Bearer ' + token() }
  })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'GIFS.RU request failed')
  return json
}

function gifsruPaged(json, page, limit) {
  return {
    results: json.results || [],
    page: json.page || page,
    limit: json.limit || limit,
    count: json.count ?? null,
    hasMore: !!json.hasMore,
    communities: json.communities
  }
}

export async function gifsruPopular(kind = 'gif', page = 1, limit = 36) {
  const json = await gifsruGet(
    `popular?kind=${encodeURIComponent(kind)}&page=${page}&limit=${limit}`
  )
  return gifsruPaged(json, page, limit)
}

export async function gifsruCommunities() {
  const json = await gifsruGet('communities')
  return json.communities || []
}

export async function gifsruCommunity(id, kind = 'gif', page = 1, limit = 36) {
  const json = await gifsruGet(
    `community?id=${encodeURIComponent(id)}&kind=${encodeURIComponent(kind)}&page=${page}&limit=${limit}`
  )
  return gifsruPaged(json, page, limit)
}

export async function gifsruSearch(q, kind = 'gif', page = 1, limit = 36) {
  const json = await gifsruGet(
    `search?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}&page=${page}&limit=${limit}`
  )
  return gifsruPaged(json, page, limit)
}

// --- Local "My Emotes" (panel collection, not 7TV account) -------------------
const MY_EMOTES_KEY = 'omo_my_emotes'
const RECENT_MS = 7 * 24 * 60 * 60 * 1000

function emoteKey(e) {
  return `${e.provider || '7tv'}:${e.id || e.emoteId || e.url}`
}

export function listMyEmotes() {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_EMOTES_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .map((e) => ({
        id: String(e.id || e.emoteId || ''),
        name: String(e.name || 'Emote'),
        provider: String(e.provider || '7tv'),
        url: String(e.url || e.src || ''),
        animated: !!e.animated,
        addedAt: Number(e.addedAt) || 0
      }))
      .filter((e) => e.url || e.id)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
  } catch (_) {
    return []
  }
}

function saveMyEmotes(list) {
  localStorage.setItem(MY_EMOTES_KEY, JSON.stringify(list.slice(0, 500)))
}

export function isInMyEmotes(emote) {
  const k = emoteKey(emote)
  return listMyEmotes().some((e) => emoteKey(e) === k)
}

/** Add to local My Emotes; returns updated list. Newest first. */
export function addToMyEmotes(emote) {
  const list = listMyEmotes()
  const k = emoteKey(emote)
  const next = list.filter((e) => emoteKey(e) !== k)
  next.unshift({
    id: String(emote.id || emote.emoteId || ''),
    name: String(emote.name || 'Emote'),
    provider: String(emote.provider || '7tv'),
    url: String(emote.url || emote.src || ''),
    animated: !!emote.animated,
    addedAt: Date.now()
  })
  saveMyEmotes(next)
  return next
}

export function removeFromMyEmotes(emote) {
  const k = emoteKey(emote)
  const next = listMyEmotes().filter((e) => emoteKey(e) !== k)
  saveMyEmotes(next)
  return next
}

/** Split local collection: recently added (7d) vs older. */
export function splitMyEmotes(list = listMyEmotes()) {
  const cutoff = Date.now() - RECENT_MS
  const recent = []
  const older = []
  for (const e of list) {
    if ((e.addedAt || 0) >= cutoff) recent.push(e)
    else older.push(e)
  }
  return { recent, older, all: list }
}

/** Previously cached stickers (disk) — works offline. */
export async function listCachedEmotes() {
  const r = await fetch('/api/emotes/cached', {
    headers: { Authorization: 'Bearer ' + token() }
  })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Failed to load cached emotes')
  return json
}

export async function cacheEmoteAsset(emote) {
  const r = await fetch('/api/emotes/cache', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      url: emote.url || emote.src,
      provider: emote.provider || '',
      emoteId: emote.id || emote.emoteId || '',
      name: emote.name || '',
      animated: !!emote.animated
    })
  })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Cache failed')
  return json
}

// --- 7TV account helpers (optional) -----------------------------------------
// These call the server proxy which stores the 7TV token server-side.
// The browser never receives the 7TV token itself.

// Connect a 7TV account by sending the user's access token to the server.
// The server verifies it against 7TV's actor query and persists it.
// Returns { ok, username } on success.
export async function sevenLogin(sevenToken) {
  const r = await fetch('/api/emotes/7tv-login', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ token: sevenToken })
  })
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Failed to connect 7TV account')
  return json
}

// Check 7TV account status (connected + username, without revealing the token).
export async function sevenAccount() {
  const r = await fetch('/api/emotes/7tv-account', {
    headers: { Authorization: 'Bearer ' + token() }
  })
  return r.json() // { connected, username? }
}

// Disconnect 7TV account (server wipes the stored token).
export async function sevenLogout() {
  const r = await fetch('/api/emotes/7tv-account', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token() }
  })
  return r.json() // { ok, connected }
}

// Fetch the connected 7TV user's emote sets ("My Emotes").
// Returns { ok, connected, username, setCount, results } or throws.
export async function myEmotes(provider) {
  const r = await fetch(
    `/api/emotes/my?provider=${encodeURIComponent(provider)}`,
    { headers: { Authorization: 'Bearer ' + token() } }
  )
  const json = await r.json()
  if (!json.ok) throw new Error(json.error || 'Failed to load My Emotes')
  return json
}

function isRemoteCdn(src) {
  return typeof src === 'string' && /^https?:\/\//i.test(src)
}

// Add an emote to the scene as an `emote`-typed layer (renders via <img> in
// both the editor and the OBS Browser Source). Selects it on success.
export async function addEmote(emote) {
  const scene = useSceneStore()
  const remoteUrl = emote.url || emote.src
  let src = remoteUrl
  let cacheWarn = null

  // Already local (Cached tab)
  if (remoteUrl && remoteUrl.startsWith('/uploads/emotes/')) {
    src = remoteUrl
  } else {
    try {
      const json = await cacheEmoteAsset({
        url: remoteUrl,
        provider: emote.provider,
        id: emote.id || emote.emoteId,
        name: emote.name,
        animated: emote.animated
      })
      if (json.src) src = json.src
      if (json.offline) cacheWarn = 'Used offline cache (CDN unreachable)'
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (offline || !isRemoteCdn(remoteUrl)) {
        throw new Error(err.message || 'Emote not in cache — cannot add offline')
      }
      // Online but cache failed: last-resort CDN (warn).
      cacheWarn = err.message || 'Cache failed — using CDN URL'
      console.warn('[emotes] cache miss, keeping CDN:', cacheWarn)
      src = remoteUrl
    }
  }

  await scene.addLayer({
    type: 'emote',
    src,
    name: emote.name || 'Emote',
    emote: {
      provider: emote.provider || '',
      emoteId: emote.id || emote.emoteId || '',
      animated: !!emote.animated
    }
  })
  return { src, warn: cacheWarn }
}

/** Background: rewrite any remaining CDN emote layers to local cache. */
export async function hydrateClientEmotes() {
  const scene = useSceneStore()
  const remotes = (scene.layers || []).filter(
    (l) => l.type === 'emote' && isRemoteCdn(l.src)
  )
  for (const layer of remotes) {
    try {
      const json = await cacheEmoteAsset({
        url: layer.src,
        provider: layer.emote?.provider,
        id: layer.emote?.emoteId,
        name: layer.name,
        animated: layer.emote?.animated
      })
      if (json?.src && json.src !== layer.src) {
        await scene.updateLayer(layer.id, { src: json.src }, { optimistic: true })
      }
    } catch (_) { /* keep remote until network returns */ }
  }
}
