// HTML proxy: Custom CSS, audio inject, and same-origin API rewrite so widgets
// like DonationAlerts (X-Frame-Options: SAMEORIGIN) work inside our iframe.
// Axios/fetch('/api/...') ignores <base href> and would hit localhost — we rewrite.
import { URL } from 'node:url'
import { tokenFromReq, roleForToken } from './auth.js'

function escapeStyle(css) {
  return String(css || '').replace(/<\/style/gi, '<\\/style')
}

function stripFramingGuards(html) {
  let out = String(html || '')
  out = out.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
  out = out.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '')
  return out
}

function originShim(origin, authToken, widgetHref) {
  const o = JSON.stringify(String(origin || '').replace(/\/$/, ''))
  const tok = JSON.stringify(String(authToken || ''))
  let widgetQs = {}
  try {
    widgetQs = Object.fromEntries(new URL(String(widgetHref || '')).searchParams.entries())
  } catch (_) { widgetQs = {} }
  const wqs = JSON.stringify(widgetQs)
  return `<script id="omo-origin-shim">(function(){
  try {
    var ORIGIN = ${o};
    var TOKEN = ${tok};
    var WIDGET_QS = ${wqs};
    if (!ORIGIN) return;

    // DonationAlerts WidgetSession reads token from window.location.search /
    // window.token. Our iframe URL is /api/browser-proxy?... so we must restore
    // the real widget query params (token, group_id, …).
    if (WIDGET_QS && WIDGET_QS.token) {
      try { window.token = WIDGET_QS.token; } catch (e) {}
    }
    try {
      var _qsGet = URLSearchParams.prototype.get;
      URLSearchParams.prototype.get = function(key) {
        var k = String(key);
        if (WIDGET_QS && Object.prototype.hasOwnProperty.call(WIDGET_QS, k)) {
          return WIDGET_QS[k];
        }
        return _qsGet.call(this, key);
      };
    } catch (e) {}

    function tunnelHttp(u) {
      if (u == null || typeof u !== 'string') return u;
      if (!u || u.startsWith('data:') || u.startsWith('blob:')) return u;
      // Already tunneled
      if (u.indexOf('/api/browser-fetch') >= 0 || u.indexOf('/api/browser-proxy') >= 0) return u;
      if (u.indexOf('/api/browser-ws') >= 0) return u;

      var remote = u;
      try {
        var parsed = new URL(u, location.href);
        var oh = new URL(ORIGIN).hostname;
        var appOrigin = location.origin;
        var host = parsed.hostname;
        var isWidgetHost = (host === oh) || host.indexOf('donationalerts') >= 0;
        // Axios resolves '/api/...' against the iframe origin (localhost) BEFORE open().
        // Rewrite those back to the real widget host.
        var isAppLocalApi = (parsed.origin === appOrigin) && (
          parsed.pathname.indexOf('/api/') === 0 ||
          parsed.pathname.indexOf('/widget') === 0 ||
          parsed.pathname.indexOf('/css/') === 0 ||
          parsed.pathname.indexOf('/js/') === 0
        ) && parsed.pathname.indexOf('/api/browser-') !== 0;

        if (isWidgetHost) {
          remote = parsed.href;
        } else if (isAppLocalApi) {
          remote = ORIGIN + parsed.pathname + parsed.search + parsed.hash;
        } else if (u.startsWith('/') || u.startsWith('./')) {
          remote = ORIGIN + (u.startsWith('/') ? u : '/' + u);
        } else {
          return u;
        }
      } catch (e) {
        if (u.startsWith('/')) remote = ORIGIN + u;
        else return u;
      }

      var q = '/api/browser-fetch?url=' + encodeURIComponent(remote);
      if (TOKEN) q += '&t=' + encodeURIComponent(TOKEN);
      return q;
    }
    function tunnelWs(u) {
      if (u == null || typeof u !== 'string') return u;
      var remote = u;
      try {
        var parsed = new URL(u, ORIGIN);
        remote = parsed.href;
      } catch (e) {}
      if (remote.indexOf('http://') === 0) remote = 'ws://' + remote.slice(7);
      if (remote.indexOf('https://') === 0) remote = 'wss://' + remote.slice(8);
      if (remote.indexOf('/api/browser-ws') >= 0) return remote;
      var proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
      var q = proto + location.host + '/api/browser-ws?url=' + encodeURIComponent(remote);
      if (TOKEN) q += '&t=' + encodeURIComponent(TOKEN);
      return q;
    }

    var ofetch = window.fetch;
    if (typeof ofetch === 'function') {
      window.fetch = function(input, init) {
        try {
          if (typeof input === 'string') input = tunnelHttp(input);
          else if (input && typeof Request !== 'undefined' && input instanceof Request)
            input = new Request(tunnelHttp(input.url), input);
        } catch (e) {}
        return ofetch.call(this, input, init);
      };
    }
    var oxhr = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { arguments[1] = tunnelHttp(url); } catch (e) {}
      return oxhr.apply(this, arguments);
    };

    var OWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      try { url = tunnelWs(String(url)); } catch (e) {}
      if (protocols !== undefined) return new OWS(url, protocols);
      return new OWS(url);
    };
    window.WebSocket.prototype = OWS.prototype;
    window.WebSocket.CONNECTING = OWS.CONNECTING;
    window.WebSocket.OPEN = OWS.OPEN;
    window.WebSocket.CLOSING = OWS.CLOSING;
    window.WebSocket.CLOSED = OWS.CLOSED;

    window.__omoProxyOrigin = ORIGIN;
  } catch (e) {}
})()</script>`
}

const AUDIO_CTRL_SCRIPT = `<script id="omo-audio-ctrl">(function(){
  try {
    window.__omoVolume = 1;
    window.__omoMuted = false;
    function applyVol() {
      var v = window.__omoMuted ? 0 : (Number(window.__omoVolume) || 0);
      document.querySelectorAll('audio,video').forEach(function(el){
        try { el.volume = v; el.muted = !!window.__omoMuted; } catch(e){}
      });
    }
    window.addEventListener('message', function(e){
      var d = e && e.data;
      if (!d || d.type !== 'omo-browser-audio') return;
      if (typeof d.volume === 'number') window.__omoVolume = Math.max(0, Math.min(1, d.volume));
      if (typeof d.muted === 'boolean') window.__omoMuted = d.muted;
      applyVol();
    });
    try {
      new MutationObserver(applyVol).observe(document.documentElement, { childList: true, subtree: true });
    } catch(e){}
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyVol);
    else applyVol();
  } catch(e){}
})()</script>`

// Only block top navigation attempts — do not redefine parent (breaks some widgets).
const TOP_GUARD = `<script id="omo-top-guard">(function(){
  try {
    document.addEventListener('click', function(e) {
      var a = e.target && e.target.closest && e.target.closest('a[target="_top"],a[target="_parent"]');
      if (a) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  } catch(e){}
})()</script>`

function allowBrowserProxy(req, res) {
  const token = tokenFromReq(req)
  const role = roleForToken(token)
  if (role === 'moderator' || role === 'viewer') return true
  res.status(403).send('auth required')
  return false
}

export function mountBrowserProxy(app, _requireModerator) {
  app.get('/api/browser-proxy', async (req, res) => {
    const qToken = String(req.query.t || '')
    if (qToken && !req.headers.authorization) {
      req.headers.authorization = 'Bearer ' + qToken
    }

    if (!allowBrowserProxy(req, res)) return
    const rawUrl = String(req.query.url || '')
    const css = String(req.query.css || '')
    const wantAudio = String(req.query.audio || '') === '1'
    if (!rawUrl) return res.status(400).send('url required')
    let target
    try {
      target = new URL(rawUrl)
    } catch (_) {
      return res.status(400).send('bad url')
    }
    if (!['http:', 'https:'].includes(target.protocol)) {
      return res.status(400).send('only http(s)')
    }
    if (target.hostname === '169.254.169.254') {
      return res.status(403).send('blocked')
    }

    try {
      const upstream = await fetch(target.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      })
      const ct = upstream.headers.get('content-type') || ''
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
        return res.redirect(target.href)
      }
      let html = stripFramingGuards(await upstream.text())
      const base = `<base href="${target.origin}/">`
      const authTok = tokenFromReq(req)
      const shim = originShim(target.origin, authTok, target.href)
      const style = css ? `<style id="omo-custom-css">${escapeStyle(css)}</style>` : ''
      const audio = wantAudio ? AUDIO_CTRL_SCRIPT : ''
      // Order: base → origin shim (before page scripts) → CSS → guards → audio
      const inject = `${base}${shim}${style}${TOP_GUARD}${audio}`
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
      } else {
        html = `${inject}${html}`
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Security-Policy', 'frame-ancestors *')
      res.removeHeader('X-Frame-Options')
      res.send(html)
    } catch (err) {
      res.status(502).send('proxy failed: ' + err.message)
    }
  })
}
