// Remote-side local proxy: HTTP+WS on a local port, tunnelled to host via relay.
import http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { FRAME, encodeFrame, decodeFrame, bodyToB64, b64ToBuffer, sanitizeHeaders } from './protocol.js'
import { normalizeJoinCode } from './join-code.js'

export class ClientRelaySession {
  constructor({ relayUrl, joinCode, localPort, onStatus }) {
    this.relayUrl = relayUrl
    this.joinCode = normalizeJoinCode(joinCode)
    this.localPort = Number(localPort) || 18090
    this.onStatus = onStatus || (() => {})
    this.ws = null
    this.alive = false
    this.paired = false
    this._rttMs = null
    this._shouldRun = false
    this._httpServer = null
    this._wss = null
    this._pendingHttp = new Map() // id -> { res, timeout }
    this._tunnelWs = new Map() // id -> client ws
    this._reqCounter = 1
    this._pingTimer = null
    this._reconnectTimer = null
  }

  status() {
    return {
      role: 'client',
      relayUrl: this.relayUrl,
      connected: this.alive,
      paired: this.paired,
      code: this.joinCode,
      localPort: this.localPort,
      rttMs: this._rttMs
    }
  }

  async start() {
    this._shouldRun = true
    await this._startLocalProxy()
    this._connectRelay()
  }

  /** Resolve when paired, or reject after timeoutMs. */
  waitUntilPaired(timeoutMs = 12000) {
    if (this.paired) return Promise.resolve(this.status())
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const tick = () => {
        if (this.paired) return resolve(this.status())
        if (!this._shouldRun) return reject(new Error('connector stopped'))
        if (Date.now() - started > timeoutMs) return reject(new Error('Pairing timeout'))
        setTimeout(tick, 200)
      }
      tick()
    })
  }

  /** Reconnect to a different relay URL keeping the same join code (failover). */
  switchRelay(relayUrl) {
    this.relayUrl = relayUrl
    this.paired = false
    if (this._pingTimer) clearInterval(this._pingTimer)
    this._pingTimer = null
    if (this.ws) {
      try { this.ws.close() } catch (_) { /* ignore */ }
      this.ws = null
    }
    if (this._shouldRun) this._connectRelay()
  }

  stop() {
    this._shouldRun = false
    if (this._pingTimer) clearInterval(this._pingTimer)
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    this._pingTimer = null
    this._reconnectTimer = null
    for (const [, p] of this._pendingHttp) {
      try {
        clearTimeout(p.timeout)
        p.res.statusCode = 503
        p.res.end('connector stopped')
      } catch (_) { /* ignore */ }
    }
    this._pendingHttp.clear()
    for (const [, cws] of this._tunnelWs) {
      try { cws.close() } catch (_) { /* ignore */ }
    }
    this._tunnelWs.clear()
    if (this.ws) {
      try { this.ws.close() } catch (_) { /* ignore */ }
      this.ws = null
    }
    if (this._wss) {
      try { this._wss.close() } catch (_) { /* ignore */ }
      this._wss = null
    }
    if (this._httpServer) {
      try { this._httpServer.close() } catch (_) { /* ignore */ }
      this._httpServer = null
    }
    this.alive = false
    this.paired = false
    this.onStatus(this.status())
  }

  _startLocalProxy() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._onHttp(req, res))
      const wss = new WebSocketServer({ noServer: true })
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (clientWs) => {
          this._onWsUpgrade(req, clientWs)
        })
      })
      server.once('error', reject)
      server.listen(this.localPort, '127.0.0.1', () => {
        this._httpServer = server
        this._wss = wss
        console.log(`[connector:client] local proxy http://127.0.0.1:${this.localPort}`)
        resolve()
      })
    })
  }

  _connectRelay() {
    if (!this._shouldRun) return
    try {
      const ws = new WebSocket(this.relayUrl)
      this.ws = ws
      ws.on('open', () => {
        this.alive = true
        this.onStatus(this.status())
        ws.send(encodeFrame({
          type: FRAME.JOIN,
          role: 'client',
          code: this.joinCode
        }))
        this._pingTimer = setInterval(() => {
          if (ws.readyState === 1) {
            ws.send(encodeFrame({ type: FRAME.PING, t: Date.now() }))
          }
        }, 15000)
      })
      ws.on('message', (data) => this._onRelayMessage(data))
      ws.on('close', () => this._onClose())
      ws.on('error', () => {})
    } catch (err) {
      console.error('[connector:client] relay connect failed', err.message)
      this._scheduleReconnect()
    }
  }

  _onClose() {
    this.alive = false
    this.paired = false
    if (this._pingTimer) clearInterval(this._pingTimer)
    this._pingTimer = null
    this.onStatus(this.status())
    if (this._shouldRun) this._scheduleReconnect()
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._shouldRun) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this._connectRelay()
    }, 2500)
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(encodeFrame(obj))
  }

  _onRelayMessage(raw) {
    const msg = decodeFrame(raw)
    if (!msg || !msg.type) return

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
      console.warn('[connector:client] relay error:', msg.error)
      this.onStatus({ ...this.status(), error: msg.error })
      return
    }
    if (msg.type === FRAME.HTTP_RES) {
      const pending = this._pendingHttp.get(msg.id)
      if (!pending) return
      this._pendingHttp.delete(msg.id)
      clearTimeout(pending.timeout)
      const { res } = pending
      try {
        res.statusCode = msg.status || 500
        const headers = sanitizeHeaders(msg.headers || {})
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        res.end(b64ToBuffer(msg.body))
      } catch (_) { /* ignore */ }
      return
    }
    if (msg.type === FRAME.WS_DATA) {
      const cws = this._tunnelWs.get(msg.id)
      if (cws && cws.readyState === 1) {
        try {
          cws.send(msg.binary ? b64ToBuffer(msg.data) : (msg.data || ''))
        } catch (_) { /* ignore */ }
      }
      return
    }
    if (msg.type === FRAME.WS_CLOSE) {
      const cws = this._tunnelWs.get(msg.id)
      if (cws) {
        try { cws.close(msg.code || 1000) } catch (_) { /* ignore */ }
        this._tunnelWs.delete(msg.id)
      }
    }
  }

  _onHttp(req, res) {
    if (!this.paired) {
      res.statusCode = 503
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: 'Not paired with host yet' }))
      return
    }
    const id = 'h' + (this._reqCounter++)
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const timeout = setTimeout(() => {
        if (!this._pendingHttp.has(id)) return
        this._pendingHttp.delete(id)
        try {
          res.statusCode = 504
          res.end('connector timeout')
        } catch (_) { /* ignore */ }
      }, 60000)
      this._pendingHttp.set(id, { res, timeout })
      const u = new URL(req.url || '/', 'http://x')
      this._send({
        type: FRAME.HTTP_REQ,
        id,
        method: req.method,
        path: u.pathname + u.search,
        headers: sanitizeHeaders(req.headers),
        body: bodyToB64(body)
      })
    })
  }

  _onWsUpgrade(req, clientWs) {
    if (!this.paired) {
      clientWs.close(1013, 'not paired')
      return
    }
    const id = 'w' + (this._reqCounter++)
    this._tunnelWs.set(id, clientWs)
    const u = new URL(req.url || '/ws', 'http://x')
    this._send({
      type: FRAME.WS_OPEN,
      id,
      path: u.pathname + u.search
    })
    clientWs.on('message', (data, isBinary) => {
      if (isBinary || Buffer.isBuffer(data)) {
        this._send({ type: FRAME.WS_DATA, id, binary: true, data: bodyToB64(data) })
      } else {
        this._send({ type: FRAME.WS_DATA, id, binary: false, data: String(data) })
      }
    })
    clientWs.on('close', (code) => {
      this._tunnelWs.delete(id)
      this._send({ type: FRAME.WS_CLOSE, id, code: code || 1000 })
    })
  }
}
