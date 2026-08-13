// Proxy for the public gifs.ru website catalog (not the commercial Gifs API v2).
// Same JSON the site itself uses for Home / Communities / search.

import { attachCachedUrls } from './emote-cache.js'

const BASE = 'https://gifs.ru/api/v1'
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

const REFERER = 'https://gifs.ru/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const PAGE_MAX = 48

const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': UA,
  Referer: REFERER,
  Origin: 'https://gifs.ru'
}

function kindToContentType(kind) {
  return String(kind || '').toLowerCase() === 'sticker' ? 2 : 1
}

function pageSkip(page, take) {
  return Math.max(0, (Math.max(1, page) - 1) * take)
}

function unwrapList(json) {
  if (Array.isArray(json)) return json
  if (Array.isArray(json?.result)) return json.result
  if (Array.isArray(json?.data)) return json.data
  return []
}

function fileName(item) {
  const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : []
  if (tags[0]) return String(tags[0])
  if (tags.length) return tags.join(' ')
  return String(item?.id || item?.hash || 'gif')
}

export function normalizeGifsruFile(item) {
  if (!item || typeof item !== 'object') return null
  const url = String(item.cloudSource || '').trim()
  if (!url) return null
  return {
    id: String(item.id || item.hash || ''),
    name: fileName(item),
    provider: 'gifsru',
    url,
    thumb: String(item.cloudSource300 || url),
    animated: true
  }
}

async function gifsruFetch(path, { method = 'GET', params, body } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + (path.startsWith('/') ? path : '/' + path))
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  }
  const headers = { ...FETCH_HEADERS }
  if (body != null) headers['Content-Type'] = 'application/json'
  const r = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch (_) { json = null }
  if (!r.ok) {
    const msg = json?.error || json?.errorMessage || json?.errors?.detail || `${r.status} ${r.statusText}`
    throw new Error(String(msg))
  }
  if (json && json.isSuccess === false) {
    throw new Error(String(json.errorMessage || 'gifs.ru request failed'))
  }
  return json
}

export async function gifsruPopular(kind, page = 1, take = 36) {
  const contentType = kindToContentType(kind)
  const skip = pageSkip(page, take)
  const json = await gifsruFetch('/Popular', {
    params: { contentType, skip, take }
  })
  const raw = unwrapList(json)
  const results = raw.map(normalizeGifsruFile).filter(Boolean)
  return {
    results,
    page,
    limit: take,
    hasMore: results.length >= take
  }
}

export async function gifsruCommunities() {
  const json = await gifsruFetch('/Community/GetCommunities', {
    method: 'POST',
    body: {
      responseRequired: true,
      loadIds: true,
      loadTitles: true,
      loadDescriptions: false,
      loadCreatedDateTime: false,
      loadAvatars: false,
      loadFiles: false,
      loadUsers: false
    }
  })
  const raw = unwrapList(json)
  return raw
    .map((c) => ({
      id: Number(c.id) || c.id,
      title: String(c.title || c.name || c.link || c.id || ''),
      slug: String(c.link || '')
    }))
    .filter((c) => c.id && c.title)
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
}

export async function gifsruCommunityFiles(communityId, kind, page = 1, take = 36) {
  const id = Number(communityId)
  if (!Number.isFinite(id) || id <= 0) throw new Error('community id required')
  const contentType = kindToContentType(kind)
  const skip = pageSkip(page, take)
  const json = await gifsruFetch('/Community/GetFiles', {
    params: { communityId: id, skip, take, contentType }
  })
  const raw = unwrapList(json)
  const results = raw.map(normalizeGifsruFile).filter(Boolean)
  return {
    results,
    page,
    limit: take,
    hasMore: results.length >= take
  }
}

export async function gifsruSearch(query, kind, page = 1, take = 36) {
  const q = String(query || '').trim()
  if (!q) return { results: [], page, limit: take, hasMore: false, count: 0 }
  const contentType = kindToContentType(kind)
  const skip = pageSkip(page, take)
  const json = await gifsruFetch('/Gif/GetGifs', {
    method: 'POST',
    body: { query: q, skip, take, contentType }
  })
  const raw = unwrapList(json)
  const results = raw.map(normalizeGifsruFile).filter(Boolean)
  const count = Number.isFinite(json?.total) ? json.total : null
  return {
    results,
    page,
    limit: take,
    count,
    hasMore: count != null ? page * take < count : results.length >= take
  }
}

function parsePageLimit(req) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 36, PAGE_MAX)
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const kind = String(req.query.kind || 'gif').toLowerCase() === 'sticker' ? 'sticker' : 'gif'
  return { limit, page, kind }
}

export function mountGifsruRoutes(app, requireModerator) {
  app.get('/api/emotes/gifsru/popular', (req, res) => {
    if (!requireModerator(req, res)) return
    const { limit, page, kind } = parsePageLimit(req)
    cached(`gifsru|popular|${kind}|${limit}|p${page}`, () => gifsruPopular(kind, page, limit))
      .then((payload) => res.json({ ok: true, kind, ...payload, results: attachCachedUrls(payload.results) }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider: 'gifsru' }))
  })

  app.get('/api/emotes/gifsru/communities', (req, res) => {
    if (!requireModerator(req, res)) return
    cached('gifsru|communities', () => gifsruCommunities())
      .then((communities) => res.json({ ok: true, communities }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider: 'gifsru' }))
  })

  app.get('/api/emotes/gifsru/community', (req, res) => {
    if (!requireModerator(req, res)) return
    const { limit, page, kind } = parsePageLimit(req)
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ ok: false, error: 'id required' })
    cached(`gifsru|community|${id}|${kind}|${limit}|p${page}`, () => gifsruCommunityFiles(id, kind, page, limit))
      .then((payload) => res.json({ ok: true, kind, id, ...payload, results: attachCachedUrls(payload.results) }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider: 'gifsru' }))
  })

  app.get('/api/emotes/gifsru/search', (req, res) => {
    if (!requireModerator(req, res)) return
    const { limit, page, kind } = parsePageLimit(req)
    const q = String(req.query.q || '').trim()
    if (!q) return res.json({ ok: true, kind, results: [], page, limit, hasMore: false, count: 0 })
    cached(`gifsru|search|${kind}|${q}|${limit}|p${page}`, () => gifsruSearch(q, kind, page, limit))
      .then((payload) => res.json({ ok: true, kind, ...payload, results: attachCachedUrls(payload.results) }))
      .catch((err) => res.status(502).json({ ok: false, error: 'Upstream error: ' + err.message, provider: 'gifsru' }))
  })
}
