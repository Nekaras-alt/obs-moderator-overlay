// Host-side relay client: registers a room, proxies tunnelled HTTP/WS to local Express.
import { WebSocket } from 'ws'
import http from 'node:http'
import { FRAME, encodeFrame, decodeFrame, bodyToB64, b64ToBuffer, sanitizeHeaders } from './protocol.js'
import { getSecret } from '../auth.js'

/** Overlay via relay often omits ?t= (join code is the secret). Inject viewer token for /obs and /ws. */
function injectViewerToken(urlPath) {
  let path = String(urlPath || '/')
  if (!path.startsWith('/')) path = '/' + path
  const q = path.indexOf('?')
  const pathname = q >= 0 ? path.slice(0, q) : path
  const search = q >= 0 ? path.slice(q + 1) : ''
  const needs = pathname === '/obs' || pathname === '/ws' || pathname === '/multi-alerts'
  if (!needs) return path
  const params = new URLSearchParams(search)
  if (params.get('t')) return path
  try {
    params.set('t', getSecret().viewerToken)
  } catch (_) {
    return path
  }
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export class HostRelaySession {
  constructor({ localPort, relayUrl, preferredCode, onStatus, onDisconnect }) {
    this.localPort = Number(localPort) || 8090
    this.relayUrl = relayUrl
    this.preferredCode = preferredCode || null
    this.onStatus = onStatus || (() => {})
    this.onDisconnect = onDisconnect || (() => {})
    this.ws = null
    this.code = null
    this.paired = false
    this.alive = false
    this._rttMs = null
    this._closing = false
    this._pingTimer = null
    this._reconnectTimer = null
    this._localWs = new Map() // id -> WebSocket to localhost
    this._shouldRun = false
    this._failStreak = 0
  }

  status() {
    return {
      role: 'host',
      relayUrl: this.relayUrl,
      connected: this.alive,
      paired: this.paired,
      code: this.code,
      rttMs: this._rttMs
    }
  }

  start() {
    this._shouldRun = true
    this._closing = false
    this._connect()
  }

  stop() {
    this._shouldRun = false
    this._closing = true
    if (this._pingTimer) clearInterval(this._pingTimer)
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._pingTimer = null
    this._reconnectTimer = null
    for (const [, lw] of this._localWs) {
      try { lw.close() } catch (_) { /* ignore */ }
    }
    this._localWs.clear()
    if (this.ws) {
      try { this.ws.close() } catch (_) { /* ignore */ }
      this.ws = null
    }
    this.alive = false
    this.paired = false
    this.onStatus(this.status())
  }

  _connect() {
    if (!this._shouldRun) return
    try {
      const ws = new WebSocket(this.relayUrl)
      this.ws = ws
      ws.on('open', () => {
        this.alive = true
        this._failStreak = 0
        this.onStatus(this.status())
        const hello = { type: FRAME.HELLO, role: 'host' }
        if (this.preferredCode) hello.code = this.preferredCode
        ws.send(encodeFrame(hello))
        this._pingTimer = setInterval(() => {
          if (ws.readyState === 1) {
            ws.send(encodeFrame({ type: FRAME.PING, t: Date.now() }))
          }
        }, 15000)
      })
      ws.on('message', (data) => this._onMessage(data))
      ws.on('close', () => this._onClose())
      ws.on('error', () => { /* close handles */ })
    } catch (err) {
      console.error('[connector:host] connect failed', err.message)
      this._scheduleReconnect()
    }
  }

  _onClose() {
    this.alive = false
    this.paired = false
    this._failStreak++
    if (this._pingTimer) clearInterval(this._pingTimer)
    this._pingTimer = null
    this.onStatus(this.status())
    try { this.onDisconnect(this) } catch (_) { /* ignore */ }
    for (const [, lw] of this._localWs) {
      try { lw.close() } catch (_) { /* ignore */ }
    }
    this._localWs.clear()
    if (this._shouldRun && !this._closing) this._scheduleReconnect()
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._shouldRun) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._connect()
    }, 2500)
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(encodeFrame(obj))
  }

  _onMessage(raw) {
    const msg = decodeFrame(raw)
    if (!msg || !msg.type) return

    if (msg.type === FRAME.REGISTERED) {
      this.code = msg.code
      this.onStatus(this.status())
      return
    }
    if (msg.type === FRAME.PAIRED) {
      this.paired = true
      this.onStatus(this.status())
      return
    }
    if (msg.type === FRAME.PONG) {
      if (msg.t) this._rttMs = Math.max(0, Date.now() - Number(msg.t))
      this.onStatus(this.status())
      return
    }
    if (msg.type === FRAME.ERROR) {
      console.warn('[connector:host] relay error:', msg.error)
      return
    }
    if (msg.type === FRAME.HTTP_REQ) {
      this._handleHttpReq(msg)
      return
    }
    if (msg.type === FRAME.WS_OPEN) {
      this._handleWsOpen(msg)
      return
    }
    if (msg.type === FRAME.WS_DATA) {
      const lw = this._localWs.get(msg.id)
      if (lw && lw.readyState === 1) {
        try {
          lw.send(msg.binary ? b64ToBuffer(msg.data) : (msg.data || ''))
        } catch (_) { /* ignore */ }
      }
      return
    }
    if (msg.type === FRAME.WS_CLOSE) {
      const lw = this._localWs.get(msg.id)
      if (lw) {
        try { lw.close(msg.code || 1000) } catch (_) { /* ignore */ }
        this._localWs.delete(msg.id)
      }
    }
  }

  _handleHttpReq(msg) {
    const id = msg.id
    const method = msg.method || 'GET'
    const urlPath = injectViewerToken(msg.path || '/')
    const headers = sanitizeHeaders(msg.headers || {})
    const body = b64ToBuffer(msg.body)

    const req = http.request({
      host: '127.0.0.1',
      port: this.localPort,
      path: urlPath,
      method,
      headers: {
        ...headers,
        host: `127.0.0.1:${this.localPort}`,
        'content-length': body.length
      }
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        this._send({
          type: FRAME.HTTP_RES,
          id,
          status: res.statusCode || 500,
          headers: sanitizeHeaders(res.headers),
          body: bodyToB64(buf)
        })
      })
    })
    req.on('error', (err) => {
      this._send({
        type: FRAME.HTTP_RES,
        id,
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: bodyToB64(JSON.stringify({ ok: false, error: err.message }))
      })
    })
    if (body.length) req.write(body)
    req.end()
  }

  _handleWsOpen(msg) {
    const id = msg.id
    const urlPath = injectViewerToken(msg.path || '/ws')
    const proto = 'ws:'
    const url = `${proto}//127.0.0.1:${this.localPort}${urlPath}`
    let lw
    try {
      lw = new WebSocket(url)
    } catch (err) {
      this._send({ type: FRAME.WS_CLOSE, id, code: 1011, reason: err.message })
      return
    }
    this._localWs.set(id, lw)
    lw.on('open', () => {
      /* peer already knows open succeeded when we accept */
    })
    lw.on('message', (data, isBinary) => {
      if (isBinary || Buffer.isBuffer(data)) {
        this._send({ type: FRAME.WS_DATA, id, binary: true, data: bodyToB64(data) })
      } else {
        this._send({ type: FRAME.WS_DATA, id, binary: false, data: String(data) })
      }
    })
    lw.on('close', (code) => {
      this._localWs.delete(id)
      this._send({ type: FRAME.WS_CLOSE, id, code: code || 1000 })
    })
    lw.on('error', () => {
      try { lw.close() } catch (_) { /* ignore */ }
    })
  }
}
