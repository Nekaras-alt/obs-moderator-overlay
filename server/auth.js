// server/auth.js
// Lightweight PIN-based session auth. The moderator connects over Tailscale,
// which is itself private, but we still gate the editor behind a PIN so a
// mistyped address or a compromised node can't take over the stream.
//
// OBS Browser Source uses a special "viewer" token (no PIN) so it can render
// without human interaction. The viewer token only receives the scene; it
// cannot author patches.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SECRET_FILE = path.join(__dirname, '..', 'data', '.secret')

// Sessions: token -> { role, createdAt }. In-memory; cleared on restart,
// which is fine — the moderator just re-enters the PIN.
const sessions = new Map()
const SESSION_TTL = 1000 * 60 * 60 * 12 // 12h

function loadOrCreateSecret() {
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const raw = fs.readFileSync(SECRET_FILE, 'utf8').trim()
      if (raw) return JSON.parse(raw)
    }
  } catch (_) { /* regenerate below */ }

  // First run: generate a random PIN and a long-lived viewer token.
  const pin = String(Math.floor(1000 + Math.random() * 9000))
  const viewerToken = crypto.randomBytes(16).toString('hex')
  const adminToken = crypto.randomBytes(16).toString('hex') // bootstrap, unused
  const data = { pin, viewerToken, adminToken }
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    fs.writeFileSync(SECRET_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch (_) { /* ignore; in-memory still works */ }
  return data
}

let secret = loadOrCreateSecret()

export function getSecret() { return secret }
export function resetSecret() { secret = loadOrCreateSecret(); return secret }

// Persist the in-memory secret back to disk (atomic-ish: write tmp + rename,
// matching state.js's pattern). Best-effort — a failure just means the change
// won't survive a restart, but in-memory state stays correct for this session.
function persistSecret() {
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    const tmp = SECRET_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(secret, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, SECRET_FILE)
  } catch (err) {
    console.error('[auth] failed to persist secret:', err.message)
  }
}

// --- 7TV user access token (optional) ---------------------------------------
// Stored SERVER-SIDE ONLY. The moderator pastes a personal access token from
// 7tv.app → Settings; we use it to read their emote sets ("My Emotes"). It is
// never sent to the browser — only from this proxy to 7tv.io over HTTPS — so
// it can't leak to the OBS Browser Source or any client. Empty string = not
// connected (search/browse/global all work anonymously without it).
export function get7tvToken() { return secret.sevenTvToken || '' }

export function set7tvToken(token) {
  secret.sevenTvToken = typeof token === 'string' ? token.trim() : ''
  persistSecret()
  return secret.sevenTvToken
}

export function clear7tvToken() {
  secret.sevenTvToken = ''
  persistSecret()
}

export function createSession(role) {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, { role, createdAt: Date.now() })
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

// Token passed via URL (?t=...) or WS subprotocol/header. OBS Browser Source
// uses the viewer token; the editor uses a session token after PIN login.
export function roleForToken(token) {
  if (token === secret.viewerToken) return 'viewer'
  const s = verifySession(token)
  return s ? s.role : null
}
