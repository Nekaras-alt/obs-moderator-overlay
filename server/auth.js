// PIN-based session auth + secrets persistence.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, ensureDirs } from './config/paths.js'

const SECRET_FILE = path.join(DATA_DIR, '.secret')
const sessions = new Map()
const SESSION_TTL = 1000 * 60 * 60 * 12 // 12h

// Login rate limit: 5 attempts / minute per IP.
const loginAttempts = new Map() // ip -> { count, resetAt }
const LOGIN_MAX = 5
const LOGIN_WINDOW_MS = 60_000

const PIN_MIN = 4
const PIN_MAX = 16
const PIN_RE = /^[A-Za-z0-9]+$/

export function normalizePin(raw) {
  return String(raw ?? '').trim()
}

export function validatePinFormat(pin) {
  const p = normalizePin(pin)
  if (p.length < PIN_MIN || p.length > PIN_MAX) {
    return { ok: false, error: `PIN must be ${PIN_MIN}–${PIN_MAX} characters` }
  }
  if (!PIN_RE.test(p)) {
    return { ok: false, error: 'PIN may only contain letters and digits' }
  }
  return { ok: true, pin: p }
}

function loadOrCreateSecret() {
  ensureDirs()
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const raw = fs.readFileSync(SECRET_FILE, 'utf8').trim()
      if (raw) {
        const parsed = JSON.parse(raw)
        // Existing installs with a PIN are already set up.
        if (parsed.pin && parsed.setupComplete === undefined) {
          parsed.setupComplete = true
        }
        if (!parsed.viewerToken) parsed.viewerToken = crypto.randomBytes(16).toString('hex')
        if (!parsed.adminToken) parsed.adminToken = crypto.randomBytes(16).toString('hex')
        return parsed
      }
    }
  } catch (_) { /* regenerate */ }

  // First run: tokens only — streamer chooses PIN via /api/setup.
  const data = {
    pin: '',
    viewerToken: crypto.randomBytes(16).toString('hex'),
    adminToken: crypto.randomBytes(16).toString('hex'),
    setupComplete: false
  }
  try {
    fs.writeFileSync(SECRET_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch (_) { /* ignore */ }
  return data
}

let secret = loadOrCreateSecret()

export function getSecret() { return secret }

export function needsSetup() {
  return !secret.setupComplete || !secret.pin
}

export function resetSecret() {
  try { if (fs.existsSync(SECRET_FILE)) fs.unlinkSync(SECRET_FILE) } catch (_) { /* ignore */ }
  secret = loadOrCreateSecret()
  return secret
}

function persistSecret() {
  try {
    ensureDirs()
    const tmp = SECRET_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(secret, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, SECRET_FILE)
  } catch (err) {
    console.error('[auth] failed to persist secret:', err.message)
  }
}

/** One-time first-run PIN. Fails if setup already complete. */
export function completeSetup(rawPin) {
  if (!needsSetup()) return { ok: false, error: 'Setup already completed' }
  const v = validatePinFormat(rawPin)
  if (!v.ok) return v
  secret.pin = v.pin
  secret.setupComplete = true
  persistSecret()
  return { ok: true }
}

/** Change PIN while authenticated (current PIN must match). */
export function changePin(currentRaw, nextRaw) {
  if (needsSetup()) return { ok: false, error: 'Complete first-run setup first' }
  if (normalizePin(currentRaw) !== secret.pin) {
    return { ok: false, error: 'Current PIN is incorrect' }
  }
  const v = validatePinFormat(nextRaw)
  if (!v.ok) return v
  secret.pin = v.pin
  secret.setupComplete = true
  persistSecret()
  return { ok: true }
}

export function get7tvToken() { return secret.sevenTvToken || '' }
export function get7tvUsername() { return secret.sevenTvUsername || '' }

export function set7tvToken(token, username = '') {
  secret.sevenTvToken = typeof token === 'string' ? token.trim() : ''
  if (username) secret.sevenTvUsername = String(username)
  persistSecret()
  return secret.sevenTvToken
}

export function clear7tvToken() {
  secret.sevenTvToken = ''
  secret.sevenTvUsername = ''
  persistSecret()
}

export function createSession(role, extra = {}) {
  const token = crypto.randomBytes(24).toString('hex')
  const sessionId = crypto.randomBytes(8).toString('hex')
  const avatarSeed = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
  sessions.set(token, {
    role,
    createdAt: Date.now(),
    sessionId,
    displayName: extra.displayName || `Mod-${sessionId.slice(0, 4)}`,
    avatarSeed,
    ...extra
  })
  return token
}

export function verifySession(token) {
  if (!token) return null
  const s = sessions.get(token)
  if (!s) return null
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(token)
    return null
  }
  return s
}

export function getSession(token) {
  return verifySession(token)
}

export function roleForToken(token) {
  if (token === secret.viewerToken) return 'viewer'
  const s = verifySession(token)
  return s ? s.role : null
}

export function checkLoginRateLimit(ip) {
  const key = ip || 'unknown'
  const now = Date.now()
  let entry = loginAttempts.get(key)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS }
    loginAttempts.set(key, entry)
  }
  entry.count++
  if (entry.count > LOGIN_MAX) {
    return { ok: false, retryAfterMs: entry.resetAt - now }
  }
  return { ok: true }
}

export function tokenFromReq(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  if (req.query?.t) return String(req.query.t)
  return ''
}
