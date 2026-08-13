// Short human-friendly join codes (no ambiguous chars).
import crypto from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateJoinCode(len = 6) {
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

export function normalizeJoinCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Public overlay URL for streamer plugin Browser (remote): https://relay/o/CODE/obs */
export function overlayHttpUrlFromRelay(relayUrl, joinCode) {
  const code = normalizeJoinCode(joinCode)
  if (!relayUrl || !code) return null
  try {
    const u = new URL(relayUrl)
    const proto = u.protocol === 'wss:' ? 'https:' : (u.protocol === 'ws:' ? 'http:' : u.protocol)
    return `${proto}//${u.host}/o/${code}/obs`
  } catch {
    return null
  }
}
