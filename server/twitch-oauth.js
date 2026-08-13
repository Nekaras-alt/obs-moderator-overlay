// Twitch OAuth — Device Code flow (no HTTPS redirect needed) + auth-code fallback.
import './config/env.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, ensureDirs } from './config/paths.js'

const TOKEN_FILE = path.join(DATA_DIR, 'twitch-mod-tokens.json')
function clientId() { return process.env.TWITCH_CLIENT_ID || '' }
function clientSecret() { return process.env.TWITCH_CLIENT_SECRET || '' }
function redirectUri() {
  return process.env.TWITCH_REDIRECT_URI || 'https://localhost'
}

const SCOPES = ['user:write:chat', 'user:read:chat']
const pendingStates = new Map() // state -> { key, createdAt }
const pendingDevices = new Map() // device_code -> { key, interval, expiresAt, timer }

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch (_) { /* ignore */ }
  return { users: {} }
}

function saveTokens(data) {
  ensureDirs()
  const tmp = TOKEN_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, TOKEN_FILE)
}

let store = loadTokens()

export function twitchOAuthConfigured() {
  return !!clientId()
}

async function fetchHelixUser(accessToken) {
  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Client-ID': clientId(),
      Authorization: 'Bearer ' + accessToken
    }
  })
  const users = await userRes.json()
  return users.data?.[0] || null
}

function saveUserTokens(key, tokens, me) {
  store.users[key] = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || '',
    login: me?.login || '',
    userId: me?.id || '',
    savedAt: Date.now()
  }
  store.users.default = store.users[key]
  saveTokens(store)
}

function stopDevicePoll(deviceCode) {
  const p = pendingDevices.get(deviceCode)
  if (p?.timer) clearTimeout(p.timer)
  pendingDevices.delete(deviceCode)
}

async function pollDeviceOnce(deviceCode) {
  const body = new URLSearchParams({
    client_id: clientId(),
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    scopes: SCOPES.join(' ')
  })
  if (clientSecret()) body.set('client_secret', clientSecret())
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const tokens = await tokenRes.json()
  return { status: tokenRes.status, tokens }
}

function scheduleDevicePoll(deviceCode) {
  const pending = pendingDevices.get(deviceCode)
  if (!pending) return
  if (Date.now() > pending.expiresAt) {
    stopDevicePoll(deviceCode)
    return
  }
  pending.timer = setTimeout(async () => {
    try {
      const { status, tokens } = await pollDeviceOnce(deviceCode)
      if (tokens.access_token) {
        const me = await fetchHelixUser(tokens.access_token)
        saveUserTokens(pending.key, tokens, me)
        stopDevicePoll(deviceCode)
        return
      }
      if (tokens.message === 'slow_down') pending.interval = Math.min(30, (pending.interval || 5) + 5)
      if (status === 400 && (tokens.message === 'authorization_pending' || tokens.message === 'slow_down')) {
        scheduleDevicePoll(deviceCode)
        return
      }
      stopDevicePoll(deviceCode)
    } catch (_) {
      scheduleDevicePoll(deviceCode)
    }
  }, (pending.interval || 5) * 1000)
}

export function mountTwitchOAuth(app, requireModerator) {
  app.get('/api/twitch/oauth/status', (req, res) => {
    if (!requireModerator(req, res)) return
    const key = req.headers['x-omo-session'] || 'default'
    const u = store.users[key] || store.users.default
    res.json({
      ok: true,
      configured: twitchOAuthConfigured(),
      hasSecret: !!clientSecret(),
      connected: !!(u?.accessToken),
      login: u?.login || null,
      redirectHint: 'Register OAuth Redirect URL as https://localhost (click Add). Connect uses Device Code — no local HTTPS needed.'
    })
  })

  app.post('/api/twitch/oauth/device/start', async (req, res) => {
    if (!requireModerator(req, res)) return
    if (!clientId()) {
      return res.status(503).json({
        ok: false,
        error: 'Set TWITCH_CLIENT_ID in .env. In Twitch Console put redirect https://localhost and click Add.'
      })
    }
    try {
      const body = new URLSearchParams({
        client_id: clientId(),
        scopes: SCOPES.join(' ')
      })
      const r = await fetch('https://id.twitch.tv/oauth2/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      const data = await r.json()
      if (!data.device_code) {
        return res.status(502).json({ ok: false, error: data.message || 'device start failed', data })
      }
      const key = req.headers['x-omo-session'] || 'default'
      stopDevicePoll(data.device_code)
      pendingDevices.set(data.device_code, {
        key,
        interval: Number(data.interval) || 5,
        expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000,
        timer: null
      })
      scheduleDevicePoll(data.device_code)
      res.json({
        ok: true,
        userCode: data.user_code,
        verificationUri: data.verification_uri || 'https://www.twitch.tv/activate',
        expiresIn: data.expires_in,
        deviceCode: data.device_code
      })
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message })
    }
  })

  app.get('/api/twitch/oauth/device/poll', async (req, res) => {
    if (!requireModerator(req, res)) return
    const key = req.headers['x-omo-session'] || 'default'
    const u = store.users[key] || store.users.default
    const deviceCode = String(req.query.device_code || '')
    const stillPending = deviceCode
      ? pendingDevices.has(deviceCode)
      : [...pendingDevices.values()].some((p) => p.key === key)
    res.json({
      ok: true,
      connected: !!(u?.accessToken),
      login: u?.login || null,
      pending: stillPending
    })
  })

  app.get('/api/twitch/oauth/start', (req, res) => {
    if (!requireModerator(req, res)) return
    if (!clientId() || !clientSecret()) {
      return res.status(503).json({
        ok: false,
        error: 'Browser OAuth needs Client ID + Secret and a real HTTPS redirect. Prefer Device Code.'
      })
    }
    const state = crypto.randomBytes(12).toString('hex')
    pendingStates.set(state, { key: req.headers['x-omo-session'] || 'default', createdAt: Date.now() })
    const url = new URL('https://id.twitch.tv/oauth2/authorize')
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(' '))
    url.searchParams.set('state', state)
    res.json({ ok: true, url: url.toString() })
  })

  app.get('/api/twitch/oauth/callback', async (req, res) => {
    const { code, state } = req.query
    const pending = pendingStates.get(String(state || ''))
    pendingStates.delete(String(state || ''))
    if (!code || !pending) return res.status(400).send('Invalid OAuth state')
    try {
      const body = new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri()
      })
      const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      const tokens = await tokenRes.json()
      if (!tokens.access_token) throw new Error(tokens.message || 'token exchange failed')
      const me = await fetchHelixUser(tokens.access_token)
      saveUserTokens(pending.key, tokens, me)
      res.send('<html><body style="font-family:system-ui;background:#1b1c1f;color:#eee;padding:40px"><h2>Twitch connected</h2><p>You can close this window.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>')
    } catch (err) {
      res.status(500).send('OAuth failed: ' + err.message)
    }
  })

  app.post('/api/twitch/chat/send', async (req, res) => {
    if (!requireModerator(req, res)) return
    const { message, channelLogin } = req.body || {}
    if (!message) return res.status(400).json({ ok: false, error: 'message required' })
    const key = req.headers['x-omo-session'] || 'default'
    const u = store.users[key] || store.users.default
    if (!u?.accessToken) return res.status(401).json({ ok: false, error: 'Connect Twitch OAuth first' })
    if (!clientId()) return res.status(503).json({ ok: false, error: 'TWITCH_CLIENT_ID not set' })
    try {
      const ch = String(channelLogin || '').replace(/^#/, '').toLowerCase()
      if (!ch) return res.status(400).json({ ok: false, error: 'Set twitch channel in settings' })
      const userRes = await fetch('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(ch), {
        headers: { 'Client-ID': clientId(), Authorization: 'Bearer ' + u.accessToken }
      })
      const udata = await userRes.json()
      const broadcasterId = udata.data?.[0]?.id
      if (!broadcasterId) return res.status(404).json({ ok: false, error: 'channel not found' })
      if (!u.userId) {
        const me = await fetchHelixUser(u.accessToken)
        if (me) {
          u.userId = me.id
          u.login = me.login
          saveTokens(store)
        }
      }
      const sendRes = await fetch('https://api.twitch.tv/helix/chat/messages', {
        method: 'POST',
        headers: {
          'Client-ID': clientId(),
          Authorization: 'Bearer ' + u.accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          sender_id: u.userId,
          message: String(message).slice(0, 500)
        })
      })
      const result = await sendRes.json().catch(() => ({}))
      if (!sendRes.ok) {
        return res.status(sendRes.status).json({ ok: false, error: result.message || 'send failed', result })
      }
      res.json({ ok: true, result })
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/twitch/oauth/manual', (req, res) => {
    if (!requireModerator(req, res)) return
    const { accessToken, login, userId } = req.body || {}
    if (!accessToken) return res.status(400).json({ ok: false, error: 'accessToken required' })
    const key = req.headers['x-omo-session'] || 'default'
    store.users[key] = {
      accessToken,
      refreshToken: '',
      login: login || 'manual',
      userId: userId || '',
      savedAt: Date.now()
    }
    store.users.default = store.users[key]
    saveTokens(store)
    res.json({ ok: true, connected: true, login: store.users[key].login })
  })
}

export async function sendTwitchChatAsDefault(message, channelLogin) {
  const u = store.users.default
  if (!u?.accessToken || !clientId()) throw new Error('Twitch not connected')
  const ch = String(channelLogin || '').replace(/^#/, '').toLowerCase()
  const userRes = await fetch('https://api.twitch.tv/helix/users?login=' + encodeURIComponent(ch), {
    headers: { 'Client-ID': clientId(), Authorization: 'Bearer ' + u.accessToken }
  })
  const udata = await userRes.json()
  const broadcasterId = udata.data?.[0]?.id
  if (!broadcasterId) throw new Error('channel not found')
  const sendRes = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      'Client-ID': clientId(),
      Authorization: 'Bearer ' + u.accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      broadcaster_id: broadcasterId,
      sender_id: u.userId,
      message: String(message).slice(0, 500)
    })
  })
  if (!sendRes.ok) {
    const result = await sendRes.json().catch(() => ({}))
    throw new Error(result.message || 'send failed')
  }
  return true
}
