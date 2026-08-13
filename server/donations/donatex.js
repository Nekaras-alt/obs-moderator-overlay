// Donatex.gg live ingest via SignalR controls-hub (JWT access token).
import '../config/env.js'
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'

const HUB_URL = () => process.env.DONATEX_HUB_URL || 'https://donatex.gg/api/controls-hub'

export function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json)
  } catch (_) {
    return null
  }
}

export function streamerIdFromToken(token) {
  const p = decodeJwtPayload(token)
  return p?.UserId || p?.userId || p?.sub || null
}

function pick(obj, keys, fallback = '') {
  if (!obj || typeof obj !== 'object') return fallback
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return obj[k]
  }
  return fallback
}

export function normalizeDonatexDonation(payload) {
  const d = payload?.donation || payload?.Donation || payload || {}
  return {
    source: 'donatex',
    externalId: String(pick(d, ['id', 'Id', 'donationId', 'DonationId'], '') || ''),
    user: String(pick(d, ['username', 'userName', 'Username', 'UserName', 'nickname', 'name', 'donorName'], 'Donor')),
    amount: Number(pick(d, ['amount', 'Amount', 'sum', 'Sum', 'value'], 0)) || 0,
    currency: String(pick(d, ['currency', 'Currency', 'currencyCode', 'CurrencyCode'], 'RUB')),
    message: String(pick(d, ['message', 'Message', 'text', 'Text', 'comment', 'Comment'], '')),
    mediaUrl: pick(d, ['mediaUrl', 'MediaUrl', 'media', 'Media'], null) || null
  }
}

/** Safe teardown — SignalR throws if stop() races a failed handshake while Connecting. */
async function safeStopConnection(conn) {
  if (!conn) return
  try {
    if (conn.state === HubConnectionState.Disconnected) return
    await conn.stop()
  } catch (_) {
    /* ignore stop/handshake races */
  }
}

export class DonatexListener {
  constructor({ getConfig, onDonation, onStatus }) {
    this.getConfig = getConfig
    this.onDonation = onDonation
    this.onStatus = onStatus
    this.connection = null
    this.seen = new Set()
    this._want = false
    this._starting = false
  }

  _status(partial) {
    this.onStatus?.(partial)
  }

  async start() {
    if (this._starting) return false
    this._starting = true
    this._want = true
    try {
      const cfg = this.getConfig() || {}
      const token = cfg.token || process.env.DONATEX_API_TOKEN || ''
      if (!token) {
        this._status({ connected: false, error: 'no token' })
        return false
      }
      const streamerId = cfg.streamerId || streamerIdFromToken(token)
      if (!streamerId) {
        this._status({ connected: false, error: 'no streamer id in JWT' })
        return false
      }

      await this.stop(false)

      const connection = new HubConnectionBuilder()
        .withUrl(HUB_URL(), { accessTokenFactory: () => token })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning)
        .build()

      this.connection = connection

      connection.on('ReceiveDonation', (payload) => this._handleDonation(payload))
      connection.on('WidgetConnectionStatus', () => {})
      connection.on('ServerTimeSync', () => {})
      connection.onreconnected(async () => {
        if (this.connection !== connection || !this._want) return
        try {
          await connection.invoke('JoinStreamerWidgetsObservation', streamerId)
          this._status({ connected: true, streamerId, hub: HUB_URL() })
        } catch (err) {
          this._status({ connected: false, error: String(err.message || err) })
        }
      })
      connection.onclose(() => {
        if (this.connection === connection && this._want) {
          this._status({ connected: false, error: 'disconnected' })
        }
      })

      try {
        await connection.start()
        if (!this._want || this.connection !== connection) {
          await safeStopConnection(connection)
          return false
        }
        await connection.invoke('JoinStreamerWidgetsObservation', streamerId)
        this._status({ connected: true, streamerId, hub: HUB_URL() })
        return true
      } catch (err) {
        if (this.connection === connection) this.connection = null
        await safeStopConnection(connection)
        this._status({ connected: false, error: String(err.message || err) })
        return false
      }
    } finally {
      this._starting = false
    }
  }

  _handleDonation(payload) {
    const partial = normalizeDonatexDonation(payload)
    const key = partial.externalId || `${partial.user}|${partial.amount}|${partial.message}|${Date.now()}`
    if (partial.externalId && this.seen.has(partial.externalId)) return
    if (partial.externalId) {
      this.seen.add(partial.externalId)
      if (this.seen.size > 500) {
        const first = this.seen.values().next().value
        this.seen.delete(first)
      }
    }
    this.onDonation?.(partial)
  }

  async stop(clearWant = true) {
    if (clearWant) this._want = false
    const conn = this.connection
    this.connection = null
    await safeStopConnection(conn)
    this._status({ connected: false })
  }
}
