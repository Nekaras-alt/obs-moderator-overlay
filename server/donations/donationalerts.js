// DonationAlerts Centrifugo realtime listener + OAuth helpers.
import './../config/env.js'
import WebSocket from 'ws'
import crypto from 'node:crypto'

const DA_API = 'https://www.donationalerts.com/api/v1'
const DA_OAUTH = 'https://www.donationalerts.com/oauth'
const CENTRIFUGO = 'wss://centrifugo.donationalerts.com/connection/websocket'

const CLIENT_ID = process.env.DA_CLIENT_ID || process.env.DONATIONALERTS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.DA_CLIENT_SECRET || process.env.DONATIONALERTS_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.DA_REDIRECT_URI || process.env.DONATIONALERTS_REDIRECT_URI || 'http://localhost:8090/api/donations/oauth/da/callback'

const SCOPES = [
  'oauth-user-show',
  'oauth-donation-subscribe',
  'oauth-donation-index'
].join(' ')

export function daConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET)
}

export async function fetchDaUser(accessToken) {
  const r = await fetch(DA_API + '/user/oauth', {
    headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
  })
  let json = {}
  try { json = await r.json() } catch (_) { /* ignore */ }
  if (!r.ok) {
    const err = new Error(json.message || json.error || `DA user fetch failed (${r.status})`)
    err.status = r.status
    err.unauthenticated = r.status === 401 || /unauth/i.test(String(json.message || json.error || ''))
    throw err
  }
  return json.data
}

export async function refreshDaToken(refreshToken) {
  if (!refreshToken) throw new Error('no refresh token')
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('DA client not configured')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken),
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  })
  const r = await fetch(DA_OAUTH + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  })
  const json = await r.json().catch(() => ({}))
  if (!json.access_token) {
    const err = new Error(json.message || json.error || `refresh failed (${r.status})`)
    err.status = r.status
    err.unauthenticated = r.status === 401 || /unauth|invalid/i.test(String(json.message || json.error || ''))
    throw err
  }
  return json
}

export async function exchangeDaCode(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: String(code)
  })
  const r = await fetch(DA_OAUTH + '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const json = await r.json()
  if (!json.access_token) throw new Error(json.message || json.error || 'token exchange failed')
  return json
}

export function daAuthorizeUrl(state) {
  const u = new URL(DA_OAUTH + '/authorize')
  u.searchParams.set('client_id', CLIENT_ID)
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPES)
  u.searchParams.set('state', state)
  return u.toString()
}

/**
 * Live Centrifugo subscription for donation alerts.
 * onDonation(normalizedPartial)
 */
export class DonationAlertsListener {
  constructor({ getTokens, onDonation, onStatus, onTokensUpdated, onAuthInvalid }) {
    this.getTokens = getTokens
    this.onDonation = onDonation
    this.onStatus = onStatus
    this.onTokensUpdated = onTokensUpdated
    this.onAuthInvalid = onAuthInvalid
    this.ws = null
    this._msgId = 1
    this._retry = null
    this._stopped = true
    this.connected = false
    this._authDead = false
    this._failLogCount = 0
  }

  start() {
    this._stopped = false
    this._authDead = false
    this._failLogCount = 0
    this._connect()
  }

  stop() {
    this._stopped = true
    this.connected = false
    if (this._retry) { clearTimeout(this._retry); this._retry = null }
    if (this.ws) {
      try { this.ws.close() } catch (_) {}
      this.ws = null
    }
    this.onStatus?.({ connected: false })
  }

  _scheduleRetry(ms = 5000) {
    if (this._stopped || this._authDead || this._retry) return
    this._retry = setTimeout(() => {
      this._retry = null
      this._connect()
    }, ms)
  }

  _markAuthDead(message) {
    this._authDead = true
    if (this._retry) { clearTimeout(this._retry); this._retry = null }
    if (this._failLogCount === 0) {
      console.warn('[da] auth invalid (' + message + '). Reconnect DonationAlerts in Donations panel. Stopping retries.')
      this._failLogCount = 1
    }
    this.onStatus?.({ connected: false, error: message, needsReauth: true })
    try { this.onAuthInvalid?.(message) } catch (_) { /* ignore */ }
  }

  _logFailOnce(message) {
    if (this._failLogCount < 1) {
      console.error('[da] user/oauth failed:', message)
      this._failLogCount = 1
    } else if (this._failLogCount === 1) {
      console.error('[da] user/oauth still failing — retries continue quietly')
      this._failLogCount = 2
    }
  }

  async _resolveUser(tokens) {
    try {
      return await fetchDaUser(tokens.accessToken)
    } catch (err) {
      const unauth = !!(err.unauthenticated || err.status === 401 || /unauth/i.test(String(err.message || '')))
      if (!unauth) throw err

      if (tokens.refreshToken) {
        try {
          const refreshed = await refreshDaToken(tokens.refreshToken)
          this.onTokensUpdated?.({
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token || tokens.refreshToken,
            expiresIn: refreshed.expires_in
          })
          console.log('[da] access token refreshed')
          this._failLogCount = 0
          return await fetchDaUser(refreshed.access_token)
        } catch (refreshErr) {
          refreshErr.unauthenticated = true
          throw refreshErr
        }
      }
      throw err
    }
  }

  async _connect() {
    if (this._stopped || this._authDead) return
    const tokens = this.getTokens()
    if (!tokens?.accessToken) {
      this.onStatus?.({ connected: false, error: 'no token' })
      return
    }

    let user
    try {
      user = await this._resolveUser(tokens)
      this._failLogCount = 0
    } catch (err) {
      const unauth = !!(err.unauthenticated || err.status === 401 || /unauth/i.test(String(err.message || '')))
      if (unauth) {
        this._markAuthDead(err.message || 'Unauthenticated')
        return
      }
      this._logFailOnce(err.message)
      this.onStatus?.({ connected: false, error: err.message })
      this._scheduleRetry()
      return
    }

    const socketToken = user.socket_connection_token
    const userId = user.id
    if (!socketToken || !userId) {
      this.onStatus?.({ connected: false, error: 'missing socket token' })
      return
    }

    try {
      if (this.ws) try { this.ws.close() } catch (_) {}
      this.ws = new WebSocket(CENTRIFUGO)
    } catch (err) {
      this._scheduleRetry()
      return
    }

    this.ws.on('open', () => {
      // Centrifugo connect
      this.ws.send(JSON.stringify({
        id: this._msgId++,
        params: { token: socketToken }
      }))
    })

    this.ws.on('message', async (buf) => {
      let msg
      try { msg = JSON.parse(buf.toString()) } catch (_) { return }

      // Connect result with client id
      if (msg.result?.client && !msg.result.channel) {
        const clientId = msg.result.client
        const liveTokens = this.getTokens() || tokens
        try {
          const channel = `$alerts:donation_${userId}`
          const subRes = await fetch(DA_API + '/centrifuge/subscribe', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + liveTokens.accessToken,
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({ channels: [channel], client: clientId })
          })
          const subJson = await subRes.json()
          const ch = subJson.channels?.[0]
          if (!ch?.token) throw new Error('subscribe failed')
          this.ws.send(JSON.stringify({
            id: this._msgId++,
            method: 1,
            params: { channel: ch.channel, token: ch.token }
          }))
          this.connected = true
          this.onStatus?.({ connected: true, user: user.name || user.code, userId })
          console.log('[da] centrifugo subscribed to', ch.channel)
        } catch (err) {
          console.error('[da] subscribe error:', err.message)
          this.onStatus?.({ connected: false, error: err.message })
          try { this.ws.close() } catch (_) {}
        }
        return
      }

      // Publication
      const pub = msg.result?.data?.data || msg.result?.data || msg.push?.data?.data
      const channel = msg.result?.channel || msg.push?.channel || ''
      if (channel.includes('donation') && pub && (pub.username != null || pub.amount != null || pub.message != null)) {
        this.onDonation?.({
          source: 'donationalerts',
          id: String(pub.id || crypto.randomBytes(6).toString('hex')),
          user: pub.username || pub.name || 'Donor',
          amount: pub.amount ?? pub.amount_main ?? 0,
          currency: pub.currency || '',
          message: pub.message || '',
          mediaUrl: null,
          durationMs: undefined
        })
      }
    })

    this.ws.on('close', () => {
      this.connected = false
      this.onStatus?.({ connected: false })
      if (!this._stopped && !this._authDead) this._scheduleRetry()
    })
    this.ws.on('error', () => { /* close handler retries */ })
  }
}

export { CLIENT_ID as DA_CLIENT_ID, REDIRECT_URI as DA_REDIRECT_URI }
