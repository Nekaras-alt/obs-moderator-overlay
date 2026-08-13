// Same-origin tunnel for Browser Source widgets (DonationAlerts etc.).
// Page runs on localhost but APIs/WS must hit the real host without browser CORS.
import { URL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { tokenFromReq, roleForToken } from './auth.js'

function allowTunnel(req, res) {
  const qToken = String(req.query?.t || '')
  if (qToken && !req.headers.authorization) {
    req.headers.authorization = 'Bearer ' + qToken
  }
  const role = roleForToken(tokenFromReq(req))
  if (role === 'moderator' || role === 'viewer') return true
  if (res) {
    res.status(403).send('auth required')
  }
  return false
}

function parseTarget(raw) {
  const u = new URL(String(raw || ''))
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) {
    throw new Error('bad protocol')
  }
  if (u.hostname === '169.254.169.254') throw new Error('blocked')
  return u
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length'
])

function forwardHeaders(req, targetHost) {
  const out = {
    'user-agent': req.headers['user-agent'] || 'OBS-Moderator-Overlay/0.1',
    accept: req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'en',
    origin: `https://${targetHost}`,
    referer: `https://${targetHost}/`
  }
  for (const key of ['authorization', 'content-type', 'x-requested-with', 'cookie']) {
    if (req.headers[key]) out[key] = req.headers[key]
  }
  return out
}

export function mountBrowserTunnel(app) {
  // Preflight (in case anything still hits CORS)
  app.options('/api/browser-fetch', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.status(204).end()
  })

  app.all('/api/browser-fetch', async (req, res) => {
    if (!allowTunnel(req, res)) return
    let target
    try {
      target = parseTarget(req.query.url)
    } catch (e) {
      return res.status(400).send('bad url')
    }
    if (target.protocol === 'ws:' || target.protocol === 'wss:') {
      return res.status(400).send('use browser-ws for websocket')
    }


    try {
      const method = req.method || 'GET'
      const headers = forwardHeaders(req, target.hostname)
      const init = { method, headers, redirect: 'follow', signal: AbortSignal.timeout(30000) }
      if (method !== 'GET' && method !== 'HEAD') {
        if (Buffer.isBuffer(req.body)) init.body = req.body
        else if (typeof req.body === 'string') init.body = req.body
        else if (req.body && Object.keys(req.body).length) init.body = JSON.stringify(req.body)
      }
      const upstream = await fetch(target.href, init)
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.status(upstream.status)
      upstream.headers.forEach((v, k) => {
        const lk = k.toLowerCase()
        if (HOP_BY_HOP.has(lk)) return
        if (lk === 'content-security-policy' || lk === 'x-frame-options') return
        if (lk === 'content-encoding') return // we already decoded
        try { res.setHeader(k, v) } catch (_) {}
      })
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Cache-Control', 'no-store')
      res.send(buf)
    } catch (err) {
      res.status(502).send('tunnel failed: ' + err.message)
    }
  })
}

/**
 * Attach WS upgrade handler for /api/browser-ws?url=wss://...&t=token
 * Must be registered on the HTTP server before or alongside other WS servers.
 */
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
        target = parseTarget(u.searchParams.get('url'))
      } catch (_) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        return
      }
      if (target.protocol === 'http:') target.protocol = 'ws:'
      if (target.protocol === 'https:') target.protocol = 'wss:'


      wss.handleUpgrade(req, socket, head, (clientWs) => {
        const upstream = new WebSocket(target.href, {
          origin: `https://${target.hostname}`,
          headers: {
            Origin: `https://${target.hostname}`,
            'User-Agent': 'OBS-Moderator-Overlay/0.1'
          }
        })

        const closeBoth = () => {
          try { clientWs.close() } catch (_) {}
          try { upstream.close() } catch (_) {}
        }

        upstream.on('open', () => {
          clientWs.on('message', (data, isBinary) => {
            if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: !!isBinary })
          })
          upstream.on('message', (data, isBinary) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: !!isBinary })
          })
        })
        upstream.on('error', closeBoth)
        clientWs.on('error', closeBoth)
        upstream.on('close', closeBoth)
        clientWs.on('close', closeBoth)
      })
    } catch (_) {
      try { socket.destroy() } catch (__) {}
    }
  })
}
