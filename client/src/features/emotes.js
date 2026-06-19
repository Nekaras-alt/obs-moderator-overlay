// client/src/features/emotes.js
// Client-side helpers for the Stickers/Emotes panel. Talks to the
// server-side proxy (server/emotes.js) for search/browse, and constructs CDN
// URLs directly for the "By URL/ID" tab (no round-trip needed).
//
// 7TV: search + browse work anonymously via the proxy (which calls their GraphQL
// API). Connecting your 7TV account is optional and unlocks "My Emotes" — your
// personal emote sets. Your 7TV token is stored server-side only; the browser
// never sees it (it's sent from the Node proxy to 7tv.io over HTTPS).

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
  }
}

export const PROVIDER_KEYS = Object.keys(PROVIDERS)

function token() { return localStorage.getItem('omo_token') || '' }

function authHeaders() { return { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' } }

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

// Add an emote to the scene as an `emote`-typed layer (renders via <img> in
// both the editor and the OBS Browser Source). Selects it on success.
export async function addEmote(emote) {
  const scene = useSceneStore()
  await scene.addLayer({
    type: 'emote',
    src: emote.url,
    name: emote.name || 'Emote',
    emote: {
      provider: emote.provider || '',
      emoteId: emote.id || emote.emoteId || '',
      animated: !!emote.animated
    }
  })
}
