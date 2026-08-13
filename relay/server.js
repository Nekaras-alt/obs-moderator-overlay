#!/usr/bin/env node
/**
 * OMO Connector Relay — pairs host ↔ remote editor by join code,
 * and proxies OBS overlay HTTP/WS at /o/:code (plugin Browser remote).
 * Does not store scene data; only multiplexes tunnel frames.
 *
 * Env:
 *   PORT=8787
 *   OMO_RELAY_PATH=/connector
 *   OMO_RELAY_TTL_MS=3600000
 *   OMO_RELAY_MAX_ROOMS=500
 *   OMO_RELAY_RATE_WINDOW_MS=60000
 *   OMO_RELAY_RATE_MAX=30
 *   OMO_RELAY_OVERLAY_RATE_MAX=300
 *   OMO_RELAY_PAIR_ONCE=0
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import crypto from 'node:crypto'

const PORT = Number(process.env.PORT) || 8787
const PATH = process.env.OMO_RELAY_PATH || '/connector'
const ROOM_TTL_MS = Number(process.env.OMO_RELAY_TTL_MS) || 60 * 60 * 1000
const MAX_ROOMS = Math.max(1, Number(process.env.OMO_RELAY_MAX_ROOMS) || 500)
const RATE_WINDOW_MS = Math.max(1000, Number(process.env.OMO_RELAY_RATE_WINDOW_MS) || 60_000)
const RATE_MAX = Math.max(1, Number(process.env.OMO_RELAY_RATE_MAX) || 30)
const OVERLAY_RATE_MAX = Math.max(1, Number(process.env.OMO_RELAY_OVERLAY_RATE_MAX) || 300)
const PAIR_ONCE = process.env.OMO_RELAY_PAIR_ONCE === '1'
const OVERLAY_COOKIE = 'omo_room'
const OVERLAY_TIMEOUT_MS = 60_000
const OVERLAY_MAX_BODY = 32 * 1024 * 1024

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateCode(len = 6) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for']
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim()
  return String(req.socket?.remoteAddress || 'unknown')
}

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateByIp = new Map()
const overlayRateByIp = new Map()

function takeRateBucket(map, ip, max) {
  const now = Date.now()
  let bucket = map.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS }
    map.set(ip, bucket)
  }
  bucket.count += 1
  return bucket.count <= max
}

function takeRate(ip) {
  return takeRateBucket(rateByIp, ip, RATE_MAX)
}

function takeOverlayRate(ip) {
  return takeRateBucket(overlayRateByIp, ip, OVERLAY_RATE_MAX)
}

function emptyOverlay() {
  return {
    pending: new Map(),
    sockets: new Map(),
    seq: 1
  }
}

/** @type {Map<string, { host: import('ws').WebSocket|null, client: import('ws').WebSocket|null, createdAt: number, pairedAt: number|null, clientEver: boolean, overlay: ReturnType<typeof emptyOverlay> }>} */
const rooms = new Map()

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
}

function peerOf(room, ws) {
  if (!room) return null
  if (room.host === ws) return room.client
  if (room.client === ws) return room.host
  return null
}

function nextOvlId(room) {
  return 'ovl-' + (room.overlay.seq++)
}

function abortOverlay(room, reason) {
  if (!room?.overlay) return
  for (const [, p] of room.overlay.pending) {
    try { clearTimeout(p.timeout) } catch (_) { /* ignore */ }
    try {
      p.res.writeHead(503, { 'content-type': 'text/plain' })
      p.res.end(reason || 'host left')
    } catch (_) { /* ignore */ }
  }
  room.overlay.pending.clear()
  for (const [, cws] of room.overlay.sockets) {
    try { cws.close(4000, reason || 'host left') } catch (_) { /* ignore */ }
  }
  room.overlay.sockets.clear()
}

function cleanupRoom(code) {
  const room = rooms.get(code)
  if (!room) return
  abortOverlay(room, 'room closed')
  if (room.host) try { room.host.close() } catch (_) { /* ignore */ }
  if (room.client) try { room.client.close() } catch (_) { /* ignore */ }
  rooms.delete(code)
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    let v = part.slice(i + 1).trim()
    try { v = decodeURIComponent(v) } catch (_) { /* keep */ }
    out[k] = v
  }
  return out
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function overlayCodeFromReq(req) {
  const u = new URL(req.url || '/', 'http://relay.local')
  const m = u.pathname.match(/^\/o\/([A-Z0-9]+)/i)
  if (m) return normalizeCode(m[1])
  return normalizeCode(parseCookies(req.headers.cookie)[OVERLAY_COOKIE] || '')
}

function hostPathFromOverlay(urlStr, code) {
  const u = new URL(urlStr || '/', 'http://relay.local')
  let pathname = u.pathname || '/'
  const prefix = '/o/' + code
  if (pathname.toUpperCase().startsWith(prefix.toUpperCase())) {
    pathname = pathname.slice(prefix.length) || '/'
    if (!pathname.startsWith('/')) pathname = '/' + pathname
  }
  if (pathname === '/' || pathname === '') pathname = '/obs'
  return pathname + u.search
}

function overlayCookie(code, req) {
  const xf = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  const secure = xf === 'https'
  let v = `${OVERLAY_COOKIE}=${code}; Path=/; SameSite=Lax; HttpOnly`
  if (secure) v += '; Secure'
  return v
}

const HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding',
  'te', 'trailer', 'upgrade', 'proxy-connection', 'content-length'
])

function sanitizeHeaders(headers = {}) {
  const out = {}
  for (const [k, v] of Object.entries(headers)) {
    if (HOP.has(String(k).toLowerCase())) continue
    if (v == null) continue
    out[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  return out
}

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) cleanupRoom(code)
  }
  for (const [ip, bucket] of rateByIp) {
    if (now >= bucket.resetAt) rateByIp.delete(ip)
  }
  for (const [ip, bucket] of overlayRateByIp) {
    if (now >= bucket.resetAt) overlayRateByIp.delete(ip)
  }
}, 60_000)

function fulfillOverlayHttp(room, msg) {
  const pending = room.overlay.pending.get(msg.id)
  if (!pending) return false
  room.overlay.pending.delete(msg.id)
  try { clearTimeout(pending.timeout) } catch (_) { /* ignore */ }
  let body = Buffer.alloc(0)
  try { body = Buffer.from(msg.body || '', 'base64') } catch (_) { body = Buffer.alloc(0) }
  const headers = sanitizeHeaders(msg.headers || {})
  if (pending.setCookie) {
    const prev = headers['set-cookie']
    if (!prev) headers['set-cookie'] = pending.setCookie
    else if (Array.isArray(prev)) headers['set-cookie'] = [...prev, pending.setCookie]
    else headers['set-cookie'] = [prev, pending.setCookie]
  }
  headers['content-length'] = String(body.length)
  try {
    pending.res.writeHead(msg.status || 500, headers)
    pending.res.end(body)
  } catch (_) { /* ignore */ }
  return true
}

function handleHostOverlayFrame(room, msg) {
  if (!msg || !msg.type || !msg.id || !String(msg.id).startsWith('ovl-')) return false
  if (msg.type === 'http-res') return fulfillOverlayHttp(room, msg)
  if (msg.type === 'ws-data') {
    const cws = room.overlay.sockets.get(msg.id)
    if (cws && cws.readyState === 1) {
      try {
        cws.send(msg.binary ? Buffer.from(msg.data || '', 'base64') : (msg.data || ''))
      } catch (_) { /* ignore */ }
    }
    return true
  }
  if (msg.type === 'ws-close') {
    const cws = room.overlay.sockets.get(msg.id)
    if (cws) {
      try { cws.close(msg.code || 1000) } catch (_) { /* ignore */ }
      room.overlay.sockets.delete(msg.id)
    }
    return true
  }
  return false
}

function handleOverlayHttp(req, res) {
  const ip = clientIp(req)
  if (!takeOverlayRate(ip)) {
    res.writeHead(429, { 'content-type': 'text/plain' })
    res.end('Rate limited — try again later')
    return
  }
  const u = new URL(req.url || '/', 'http://relay.local')
  const fromPath = /^\/o\//i.test(u.pathname)
  const code = overlayCodeFromReq(req)
  if (!code) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const room = rooms.get(code)
  if (!room || !room.host || room.host.readyState !== 1) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Invalid or expired join code')
    return
  }

  if (fromPath) {
    const rest = u.pathname.replace(/^\/o\/[^/]+/i, '')
    if (rest === '' || rest === '/') {
      res.writeHead(302, {
        location: `/o/${code}/obs${u.search}`,
        'set-cookie': overlayCookie(code, req)
      })
      res.end()
      return
    }
  }

  const chunks = []
  let size = 0
  let overflow = false
  req.on('data', (c) => {
    size += c.length
    if (size > OVERLAY_MAX_BODY) {
      overflow = true
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (overflow) {
      try {
        res.writeHead(413, { 'content-type': 'text/plain' })
        res.end('too large')
      } catch (_) { /* ignore */ }
      return
    }
    const id = nextOvlId(room)
    const timeout = setTimeout(() => {
      if (!room.overlay.pending.has(id)) return
      room.overlay.pending.delete(id)
      try {
        res.writeHead(504, { 'content-type': 'text/plain' })
        res.end('overlay timeout')
      } catch (_) { /* ignore */ }
    }, OVERLAY_TIMEOUT_MS)
    room.overlay.pending.set(id, {
      res,
      timeout,
      setCookie: fromPath ? overlayCookie(code, req) : null
    })
    send(room.host, {
      type: 'http-req',
      id,
      method: req.method || 'GET',
      path: hostPathFromOverlay(req.url, code),
      headers: sanitizeHeaders(req.headers),
      body: Buffer.concat(chunks).toString('base64')
    })
  })
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://relay.local')
  if (u.pathname === '/health' || u.pathname === '/') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      ok: true,
      service: 'omo-connector-relay',
      rooms: rooms.size,
      maxRooms: MAX_ROOMS,
      path: PATH,
      overlay: '/o/:code',
      ttlMs: ROOM_TTL_MS,
      rateMax: RATE_MAX,
      overlayRateMax: OVERLAY_RATE_MAX,
      rateWindowMs: RATE_WINDOW_MS
    }))
    return
  }
  if (u.pathname.startsWith('/o/') || parseCookies(req.headers.cookie)[OVERLAY_COOKIE]) {
    handleOverlayHttp(req, res)
    return
  }
  res.writeHead(404)
  res.end('not found')
})

const wssConnector = new WebSocketServer({ noServer: true })
const wssOverlay = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url || '/', 'http://relay.local')
  const connPath = PATH.endsWith('/') ? PATH.slice(0, -1) : PATH
  if (u.pathname === connPath || u.pathname === connPath + '/') {
    wssConnector.handleUpgrade(req, socket, head, (ws) => {
      wssConnector.emit('connection', ws, req)
    })
    return
  }
  const code = overlayCodeFromReq(req)
  const overlayWs = u.pathname === '/ws' || /^\/o\/[A-Z0-9]+\/ws$/i.test(u.pathname)
  if (code && overlayWs) {
    const room = rooms.get(code)
    if (!room || !room.host || room.host.readyState !== 1) {
      socket.destroy()
      return
    }
    wssOverlay.handleUpgrade(req, socket, head, (ws) => {
      const id = nextOvlId(room)
      room.overlay.sockets.set(id, ws)
      send(room.host, {
        type: 'ws-open',
        id,
        path: hostPathFromOverlay(req.url, code)
      })
      ws.on('message', (data, isBinary) => {
        if (isBinary || Buffer.isBuffer(data)) {
          send(room.host, { type: 'ws-data', id, binary: true, data: Buffer.from(data).toString('base64') })
        } else {
          send(room.host, { type: 'ws-data', id, binary: false, data: String(data) })
        }
      })
      ws.on('close', (closeCode) => {
        room.overlay.sockets.delete(id)
        send(room.host, { type: 'ws-close', id, code: closeCode || 1000 })
      })
    })
    return
  }
  socket.destroy()
})

wssConnector.on('connection', (ws, req) => {
  ws._roomCode = null
  ws._role = null
  ws._ip = clientIp(req)

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch (_) { return }
    if (!msg || !msg.type) return

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t, probe: !!msg.probe })
      if (msg.probe) {
        setTimeout(() => { try { ws.close() } catch (_) { /* ignore */ } }, 50)
      }
      return
    }

    if (msg.type === 'hello' && msg.role === 'host') {
      if (!takeRate(ws._ip)) {
        send(ws, { type: 'error', error: 'Rate limited — try again later' })
        return
      }
      if (rooms.size >= MAX_ROOMS) {
        send(ws, { type: 'error', error: 'Relay at capacity — try another region or later' })
        return
      }
      let code = String(msg.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (code) {
        const existing = rooms.get(code)
        if (existing && existing.host && existing.host.readyState === 1 && existing.host !== ws) {
          send(ws, { type: 'error', error: 'Join code already in use on this relay' })
          return
        }
        if (existing) {
          abortOverlay(existing, 'replaced')
          try { existing.host?.close() } catch (_) { /* ignore */ }
          try { existing.client?.close() } catch (_) { /* ignore */ }
          rooms.delete(code)
        }
      } else {
        code = generateCode()
        while (rooms.has(code)) code = generateCode()
      }
      rooms.set(code, {
        host: ws,
        client: null,
        createdAt: Date.now(),
        pairedAt: null,
        clientEver: false,
        overlay: emptyOverlay()
      })
      ws._roomCode = code
      ws._role = 'host'
      send(ws, { type: 'registered', code })
      console.log(`[relay] host registered code=${code} rooms=${rooms.size} ip=${ws._ip}`)
      return
    }

    if (msg.type === 'join' && msg.role === 'client') {
      if (!takeRate(ws._ip)) {
        send(ws, { type: 'error', error: 'Rate limited — try again later' })
        return
      }
      const code = String(msg.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      const room = rooms.get(code)
      if (!room || !room.host || room.host.readyState !== 1) {
        send(ws, { type: 'error', error: 'Invalid or expired join code' })
        return
      }
      if (room.client && room.client.readyState === 1) {
        send(ws, { type: 'error', error: 'Room already has a client' })
        return
      }
      if (PAIR_ONCE && room.clientEver && room.pairedAt && !room.client) {
        send(ws, { type: 'error', error: 'Room sealed after disconnect — ask host for a new join code' })
        return
      }
      room.client = ws
      room.clientEver = true
      room.pairedAt = room.pairedAt || Date.now()
      ws._roomCode = code
      ws._role = 'client'
      send(ws, { type: 'paired', code })
      send(room.host, { type: 'paired', code })
      console.log(`[relay] paired code=${code}`)
      return
    }

    const code = ws._roomCode
    if (!code) {
      send(ws, { type: 'error', error: 'Not in a room' })
      return
    }
    const room = rooms.get(code)
    if (ws._role === 'host' && handleHostOverlayFrame(room, msg)) return

    const peer = peerOf(room, ws)
    if (peer && peer.readyState === 1) {
      peer.send(typeof raw === 'string' ? raw : String(raw))
    }
  })

  ws.on('close', () => {
    const code = ws._roomCode
    if (!code) return
    const room = rooms.get(code)
    if (!room) return
    if (room.host === ws) {
      console.log(`[relay] host left code=${code}`)
      abortOverlay(room, 'host left')
      if (room.client) try { room.client.close(4000, 'host left') } catch (_) { /* ignore */ }
      rooms.delete(code)
    } else if (room.client === ws) {
      console.log(`[relay] client left code=${code}`)
      room.client = null
      if (room.host && room.host.readyState === 1) {
        send(room.host, { type: 'status', event: 'client-left' })
      }
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] listening on :${PORT}${PATH} overlay=/o/:code maxRooms=${MAX_ROOMS} ttlMs=${ROOM_TTL_MS}`)
})
