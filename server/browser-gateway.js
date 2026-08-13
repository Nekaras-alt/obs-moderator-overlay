/**
 * Path-based Browser Source gateway (OBS-like).
 *
 * iframe src:
 *   /api/bg/<auth>/www.donationalerts.com/widget/alerts?group_id=1&token=WIDGET
 *
 * <base href="/api/bg/<auth>/www.donationalerts.com/"> makes axios `/api/...`
 * resolve same-origin through this gateway — no fragile XHR monkey-patches.
 */
import { WebSocketServer, WebSocket } from 'ws'
import { roleForToken } from './auth.js'

function escapeStyle(css) {
  return String(css || '').replace(/<\/style/gi, '<\\/style')
}

function stripFramingGuards(html) {
  return String(html || '')
    .replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, '')
}

const HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length',
  'content-encoding', 'content-security-policy', 'x-frame-options'
])

function basePrefix(auth, host) {
  return `/api/bg/${encodeURIComponent(auth)}/${host}`
}

/**
 * Root-relative URLs like /js/x.js ignore <base path> (RFC 3986) and hit
 * localhost:5173/js/x.js → 404. Rewrite them onto the gateway prefix.
 */
function rewriteRootRelative(html, prefix) {
  const p = String(prefix || '').replace(/\/$/, '')
  return String(html || '').replace(
    /\b(src|href|action)=(["'])\/(?!\/)/gi,
    (_m, attr, q) => `${attr}=${q}${p}/`
  )
}

function pathFixScript(auth, host) {
  const prefix = basePrefix(auth, host)
  return `<script id="omo-path-fix">(function(){
  try {
    var PREFIX = ${JSON.stringify(prefix)};
    var AUTH = ${JSON.stringify(auth)};
    var HOST = ${JSON.stringify(host)};
    function fix(u) {
      if (typeof u !== 'string' || !u) return u;
      if (u.indexOf(PREFIX) === 0 || u.indexOf('/api/bg/') === 0) return u;
      if (u.indexOf('/api/browser-ws') === 0 || u.indexOf('/api/browser-fetch') === 0) return u;
      if (u.charAt(0) === '/' && u.charAt(1) !== '/') return PREFIX + u;
      try {
        var abs = new URL(u, location.href);
        if (abs.origin === location.origin && abs.pathname.indexOf('/api/bg/') !== 0) {
          if (/^\\/(api|js|css|widget|fonts|images|static|media|bundles|build|assets)\\b/.test(abs.pathname)) {
            return PREFIX + abs.pathname + abs.search + abs.hash;
          }
        }
      } catch (e) {}
      return u;
    }
    var ofetch = window.fetch;
    if (typeof ofetch === 'function') {
      window.fetch = function(input, init) {
        try {
          if (typeof input === 'string') input = fix(input);
          else if (input && typeof Request !== 'undefined' && input instanceof Request)
            input = new Request(fix(input.url), input);
        } catch (e) {}
        return ofetch.call(this, input, init);
      };
    }
    var oxhr = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { arguments[1] = fix(url); } catch (e) {}
      return oxhr.apply(this, arguments);
    };
    var OWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      var u = String(url || '');
      if (u.indexOf('/api/browser-ws') === 0) {
        if (u.indexOf('page=') < 0) {
          u += (u.indexOf('?') >= 0 ? '&' : '?') + 'page=' + encodeURIComponent(HOST);
        }
        u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + u;
      } else if (/^wss?:\\/\\//i.test(u)) {
        u = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
          '/api/browser-ws?url=' + encodeURIComponent(u) +
          '&t=' + encodeURIComponent(AUTH) +
          '&page=' + encodeURIComponent(HOST);
      }
      return protocols !== undefined ? new OWS(u, protocols) : new OWS(u);
    };
    window.WebSocket.prototype = OWS.prototype;
    window.WebSocket.CONNECTING = OWS.CONNECTING;
    window.WebSocket.OPEN = OWS.OPEN;
    window.WebSocket.CLOSING = OWS.CLOSING;
    window.WebSocket.CLOSED = OWS.CLOSED;
  } catch (e) {}
})()</script>`
}

function injectHtml(html, { auth, host, omo }) {
  const prefix = basePrefix(auth, host)
  html = stripFramingGuards(html)
  html = rewriteRootRelative(html, prefix)

  // Match OBS Native browser CSS: hide page scrollbars inside overlay layers.
  const overflowCss =
    'html,body{overflow:hidden!important;margin:0!important;}' +
    'html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}'
  const custom = omo.css ? escapeStyle(omo.css) : ''
  const style = `<style id="omo-custom-css">${overflowCss}${custom}</style>`
  const audio = omo.audio
    ? `<script id="omo-audio-ctrl">(function(){try{window.__omoVolume=1;window.__omoMuted=false;function A(){var v=window.__omoMuted?0:(Number(window.__omoVolume)||0);document.querySelectorAll("audio,video").forEach(function(el){try{el.volume=v;el.muted=!!window.__omoMuted}catch(e){}})}window.addEventListener("message",function(e){var d=e&&e.data;if(!d||d.type!=="omo-browser-audio")return;if(typeof d.volume==="number")window.__omoVolume=Math.max(0,Math.min(1,d.volume));if(typeof d.muted==="boolean")window.__omoMuted=d.muted;A()});try{new MutationObserver(A).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}A()}catch(e){}})()</script>`
    : ''
  const inject = `${pathFixScript(auth, host)}${style}${audio}`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
  return inject + html
}

function rewriteJsonWs(text, auth, pageHost) {
  try {
    const data = JSON.parse(text)
    const page = encodeURIComponent(pageHost || '')
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        if (typeof v === 'string' && /^wss?:\/\//i.test(v)) {
          obj[k] = `/api/browser-ws?url=${encodeURIComponent(v)}&t=${encodeURIComponent(auth)}&page=${page}`
        } else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(data)
    return JSON.stringify(data)
  } catch (_) {
    return text
  }
}

export function mountBrowserGateway(app) {
  app.all('/api/bg/:auth/*', async (req, res) => {
    const auth = req.params.auth
    const role = roleForToken(auth)
    if (role !== 'moderator' && role !== 'viewer') {
      return res.status(403).send('auth required')
    }
    const rest = req.params[0] || ''
    const slash = rest.indexOf('/')
    const host = slash === -1 ? rest : rest.slice(0, slash)
    const pathPart = slash === -1 ? '/' : rest.slice(slash)
    if (!/^[a-z0-9.-]+$/i.test(host)) return res.status(400).send('bad host')

    const target = new URL(`https://${host}${pathPart || '/'}`)
    const src = new URL(req.originalUrl, 'http://local')
    for (const [k, v] of src.searchParams) {
      if (k.startsWith('_omo_')) continue
      target.searchParams.set(k, v)
    }
    const omo = {
      css: src.searchParams.get('_omo_css') || '',
      audio: src.searchParams.get('_omo_audio') === '1'
    }


    try {
      const method = req.method || 'GET'
      const headers = {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        accept: req.headers.accept || '*/*',
        origin: `https://${host}`,
        referer: `https://${host}/`
      }
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
      if (req.headers.authorization) headers.authorization = req.headers.authorization

      const init = { method, headers, redirect: 'follow', signal: AbortSignal.timeout(30000) }
      if (method !== 'GET' && method !== 'HEAD') {
        if (Buffer.isBuffer(req.body)) init.body = req.body
        else if (typeof req.body === 'string') init.body = req.body
        else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
          init.body = JSON.stringify(req.body)
          headers['content-type'] = headers['content-type'] || 'application/json'
        }
      }

      const upstream = await fetch(target.href, init)
      const ct = upstream.headers.get('content-type') || ''
      const buf = Buffer.from(await upstream.arrayBuffer())

      res.status(upstream.status)
      upstream.headers.forEach((v, k) => {
        if (HOP.has(k.toLowerCase())) return
        try { res.setHeader(k, v) } catch (_) {}
      })
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Security-Policy', 'frame-ancestors *')
      res.removeHeader('X-Frame-Options')

      if (ct.includes('text/html')) {
        let html = injectHtml(buf.toString('utf8'), { auth, host, omo })
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return res.send(html)
      }

      if (ct.includes('json') || pathPart.includes('/api/')) {
        let text = buf.toString('utf8')
        if (text.includes('ws://') || text.includes('wss://')) text = rewriteJsonWs(text, auth, host)
        res.setHeader('Content-Type', ct.includes('json') ? ct : 'application/json; charset=utf-8')
        return res.send(text)
      }

      return res.send(buf)
    } catch (err) {
      res.status(502).send('gateway failed: ' + err.message)
    }
  })
}

export function attachBrowserWsTunnel(server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    try {
      const u = new URL(req.url || '', 'http://x')
      if (u.pathname !== '/api/browser-ws') return
      const token = u.searchParams.get('t') || ''
      const role = roleForToken(token)
      if (role !== 'moderator' && role !== 'viewer') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      let target
      try {
        target = new URL(u.searchParams.get('url') || '')
      } catch (_) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }
      if (target.protocol === 'http:') target.protocol = 'ws:'
      if (target.protocol === 'https:') target.protocol = 'wss:'


      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const pending = []
        let upstreamOpen = false
        // Centrifugo expects Origin of the *widget page* (www.donationalerts.com),
        // not the socket host (centrifugo.donationalerts.com). Wrong Origin →
        // immediate close / reconnect loop → blank Browser Source.
        const pageHost = String(u.searchParams.get('page') || '').replace(/[^a-z0-9.-]/gi, '')
        let originHost = pageHost
        if (!originHost) {
          const th = target.hostname
          originHost = th.startsWith('centrifugo.') ? `www.${th.slice('centrifugo.'.length)}` : th
        }
        const pageOrigin = `https://${originHost}`
        const protoHdr = req.headers['sec-websocket-protocol']
        const protocols = protoHdr
          ? String(protoHdr).split(',').map((s) => s.trim()).filter(Boolean)
          : undefined
        const upstreamOpts = {
          origin: pageOrigin,
          headers: {
            Origin: pageOrigin,
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {})
          },
          perMessageDeflate: false
        }
        const upstream = protocols && protocols.length
          ? new WebSocket(target.href, protocols, upstreamOpts)
          : new WebSocket(target.href, upstreamOpts)

        const closeBoth = (code, reason) => {
          try { clientWs.close() } catch (_) {}
          try { upstream.close() } catch (_) {}
        }

        // Buffer client→upstream until Centrifugo socket is open (Centrifuge
        // sends the connect frame immediately on WebSocket open).
        clientWs.on('message', (data, isBinary) => {
          if (!upstreamOpen) {
            pending.push({ data, isBinary: !!isBinary })
            return
          }
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: !!isBinary })
          }
        })

        upstream.on('open', () => {
          upstreamOpen = true
          for (const p of pending) {
            try { upstream.send(p.data, { binary: p.isBinary }) } catch (_) {}
          }
          pending.length = 0
        })

        upstream.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: !!isBinary })
          }
        })

        upstream.on('unexpected-response', (_req, res) => {
          closeBoth(res.statusCode, 'unexpected-response')
        })
        upstream.on('error', (err) => closeBoth(1011, err && err.message))
        clientWs.on('error', () => closeBoth())
        upstream.on('close', (code, reason) => closeBoth(code, reason))
        clientWs.on('close', () => closeBoth())
      })
    } catch (_) {
      try { socket.destroy() } catch (__) {}
    }
  })
}
