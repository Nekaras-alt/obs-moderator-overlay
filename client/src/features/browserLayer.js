// Shared helpers for StageRenderer (browser/chatis/multiBrowser URL building).
import { buildChatisUrl, defaultChatisConfig } from '@shared/chatis.js'

/** Hosts that refuse iframe embedding (XFO/CSP) — must go through our gateway. */
const FRAME_BLOCKED_HOSTS = [
  'donationalerts.com',
  'www.donationalerts.com',
  'static.donationalerts.ru',
  'www.donationalerts.ru',
  'donationalerts.ru',
  'twitchpaste.ru',
  'www.twitchpaste.ru'
]

export function browserCfgOf(layer) {
  if (!layer) return {}
  return layer.type === 'chatis' ? (layer.chatis || {}) : (layer.browser || {})
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase() } catch (_) { return '' }
}

export function isFrameBlockedHost(url) {
  const h = hostOf(url)
  if (!h) return false
  return FRAME_BLOCKED_HOSTS.some((b) => h === b || h.endsWith('.' + b.replace(/^www\./, '')))
}

export function authTokenForBrowser() {
  try {
    if (typeof localStorage !== 'undefined') {
      const mod = localStorage.getItem('omo_token') || ''
      if (mod) return mod
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof location !== 'undefined') {
      const t = new URLSearchParams(location.search).get('t')
      if (t) return t
    }
  } catch (_) { /* ignore */ }
  return ''
}

/**
 * Proxy/gateway only when required:
 * - Custom CSS inject
 * - Hosts that block iframe embedding (X-Frame-Options), e.g. DonationAlerts
 *
 * Do NOT gateway just for "Control audio via OBS" — re-hosting breaks
 * Donatex/SignalR and other live widgets. Audio control then only works
 * when the page is already gated (or use mute at the OBS level).
 */
export function browserNeedsProxy(cfg = {}) {
  const css = String(cfg.customCss || '').trim()
  if (css) return true
  const url = String(cfg.url || '').trim()
  if (url && isFrameBlockedHost(url)) return true
  if (cfg.forceProxy) return true
  return false
}

/**
 * Build /api/bg/<auth>/<host>/<path>?<original query>&_omo_*
 * Keeps widget ?token= in the iframe location.search (required by DonationAlerts).
 */
export function gatewaySrc(url, cfg = {}) {
  const auth = authTokenForBrowser()
  if (!auth) return 'about:blank'
  let u
  try { u = new URL(url) } catch (_) { return 'about:blank' }
  const q = new URLSearchParams(u.search)
  q.set('_omo_r', String(cfg.refreshKey || 0))
  if (cfg.customCss) q.set('_omo_css', cfg.customCss)
  if (cfg.controlAudioViaObs) q.set('_omo_audio', '1')
  const path = `/api/bg/${encodeURIComponent(auth)}/${u.host}${u.pathname}`
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
}

export function browserSrc(layer) {
  try {
    const cfg = browserCfgOf(layer)
    let url = cfg.url || layer.src || ''
    if (layer.type === 'chatis' && !url && cfg.channel) {
      url = buildChatisUrl({
        ...defaultChatisConfig(cfg.channel),
        ...(cfg.chatisParams || {})
      })
    }
    if (!url || typeof url !== 'string') return 'about:blank'
    url = url.trim()
    if (!url || url === 'https://' || url === 'http://') return 'about:blank'
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return 'about:blank'

    const needsProxy = browserNeedsProxy(cfg)

    if (needsProxy) return gatewaySrc(url, cfg)

    if (cfg.refreshKey) {
      try {
        const u = new URL(url)
        u.searchParams.set('_omo_r', String(cfg.refreshKey))
        return u.toString()
      } catch (_) {
        return url
      }
    }
    return url
  } catch (_) {
    return 'about:blank'
  }
}

export function multiBrowserUrls(layer, { preferDirect = false } = {}) {
  const urls = layer?.multiBrowser?.urls
  if (!Array.isArray(urls)) return []
  const refreshKey = layer?.multiBrowser?.refreshKey || 0
  return urls.map((raw) => {
    const u = String(raw || '').trim()
    if (!u || (!/^https?:\/\//i.test(u) && !u.startsWith('/'))) return ''
    if (preferDirect || !isFrameBlockedHost(u)) {
      if (refreshKey) {
        try {
          const parsed = new URL(u)
          parsed.searchParams.set('_omo_r', String(refreshKey))
          return parsed.toString()
        } catch (_) { return u }
      }
      return u
    }
    return gatewaySrc(u, { refreshKey })
  }).filter(Boolean)
}

/** Raw https URLs for Electron webview (OBS-like CEF). */
export function multiBrowserDirectUrls(layer) {
  return multiBrowserUrls(layer, { preferDirect: true })
}

export function pushBrowserAudio(el, cfg = {}) {
  if (!el || !cfg.controlAudioViaObs) return
  // Electron <webview> (OBS CEF analogue) — mute at guest level.
  if (typeof el.setAudioMuted === 'function') {
    try {
      const muted = !!cfg.muted || (typeof cfg.volume === 'number' && cfg.volume <= 0)
      el.setAudioMuted(muted)
    } catch (_) { /* ignore */ }
    return
  }
  if (!el.contentWindow) return
  try {
    el.contentWindow.postMessage({
      type: 'omo-browser-audio',
      volume: typeof cfg.volume === 'number' ? cfg.volume : 1,
      muted: !!cfg.muted
    }, '*')
  } catch (_) { /* ignore */ }
}
