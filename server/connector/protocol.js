// Shared connector ↔ relay frame helpers (JSON text over WebSocket).

export const FRAME = {
  HELLO: 'hello',
  REGISTERED: 'registered',
  JOIN: 'join',
  PAIRED: 'paired',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  HTTP_REQ: 'http-req',
  HTTP_RES: 'http-res',
  WS_OPEN: 'ws-open',
  WS_DATA: 'ws-data',
  WS_CLOSE: 'ws-close',
  STATUS: 'status'
}

export function encodeFrame(obj) {
  return JSON.stringify(obj)
}

export function decodeFrame(raw) {
  if (typeof raw !== 'string') {
    try { raw = Buffer.from(raw).toString('utf8') } catch (_) { return null }
  }
  try { return JSON.parse(raw) } catch (_) { return null }
}

export function bodyToB64(buf) {
  if (buf == null) return ''
  if (Buffer.isBuffer(buf)) return buf.toString('base64')
  if (typeof buf === 'string') return Buffer.from(buf).toString('base64')
  return Buffer.from(buf).toString('base64')
}

export function b64ToBuffer(b64) {
  if (!b64) return Buffer.alloc(0)
  return Buffer.from(b64, 'base64')
}

/** Normalize header map for tunneling (drop hop-by-hop). */
export function sanitizeHeaders(headers = {}) {
  const out = {}
  const skip = new Set([
    'host', 'connection', 'keep-alive', 'transfer-encoding',
    'te', 'trailer', 'upgrade', 'proxy-connection', 'content-length'
  ])
  for (const [k, v] of Object.entries(headers)) {
    if (skip.has(String(k).toLowerCase())) continue
    if (v == null) continue
    out[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  return out
}
