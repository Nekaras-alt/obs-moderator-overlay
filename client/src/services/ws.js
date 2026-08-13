// client/src/services/ws.js
// WebSocket client with auto-reconnect. Sends ops to the server (authoritative
// apply), and notifies subscribers when a fresh scene arrives.
//
// The token decides role: the editor passes its moderator session token (from
// PIN login); /obs passes the viewer token from the URL.

export class SceneSocket {
  constructor() {
    this.ws = null
    this.token = null
    this.connected = false
    this._listeners = new Set()       // (message) => void
    this._statusListeners = new Set() // (connected: boolean) => void
    this._pending = []
    this._reconnectTimer = null
    this._refCounter = 1
    this._opResolvers = new Map()     // ref -> { resolve, reject }
    this._shouldConnect = false
  }

  onMessage(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  onStatus(fn) { this._statusListeners.add(fn); fn(this.connected); return () => this._statusListeners.delete(fn) }

  _setStatus(v) {
    this.connected = v
    for (const fn of this._statusListeners) fn(v)
  }

  connect(token) {
    this.token = token
    this._shouldConnect = true
    this._open()
  }

  disconnect() {
    this._shouldConnect = false
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    if (this.ws) { try { this.ws.close(1000, 'disconnect') } catch (_) {} this.ws = null }
    this._setStatus(false)
    this._pending = []
    this._opResolvers.forEach((r) => r.resolve({ ok: false, error: 'disconnected' }))
    this._opResolvers.clear()
  }

  _open() {
    // Build the WS URL. In dev, Vite proxies /ws to :8090. In prod, same origin.
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws?t=${encodeURIComponent(this.token)}`
    let ws
    try { ws = new WebSocket(url) } catch (e) { this._scheduleReconnect(); return }
    this.ws = ws

    ws.onopen = () => {
      this._setStatus(true)
      // Flush anything queued while offline. (M0: the server resyncs full scene
      // on connect, so the queue is mostly relevant for late ops; kept simple.)
      for (const m of this._pending) this.ws.send(m)
      this._pending = []
    }
    ws.onclose = (ev) => {
      this._setStatus(false)
      // 4001 = unauthorized: server rejected the token. Stop reconnecting
      // so the client doesn't spam reconnect attempts with an invalid token.
      if (ev.code === 4001) this._shouldConnect = false
      if (this._shouldConnect) this._scheduleReconnect()
    }
    ws.onerror = () => { /* onclose will handle reconnect */ }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch (_) { return }
      if (msg.type === 'op-result' && msg.ref) {
        const r = this._opResolvers.get(msg.ref)
        if (r) { r(msg.result); this._opResolvers.delete(msg.ref) }
        return
      }
      for (const fn of this._listeners) fn(msg)
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (this._shouldConnect) this._open()
    }, 1200)
  }

  _send(msg) {
    const data = JSON.stringify(msg)
    if (this.ws && this.ws.readyState === 1) this.ws.send(data)
    else this._pending.push(data)
  }

  // Send an op; resolves with the server's { ok, error? } result.
  sendOp(op) {
    const ref = this._refCounter++
    return new Promise((resolve) => {
      this._opResolvers.set(ref, resolve)
      this._send({ type: 'op', ref, op })
      // Safety timeout so a UI never hangs forever if the server is silent.
      setTimeout(() => {
        if (this._opResolvers.has(ref)) {
          this._opResolvers.delete(ref)
          resolve({ ok: false, error: 'timeout' })
        }
      }, 4000)
    })
  }

  // Send a transient media transport command (play/pause/seek). Not an op:
  // the server fans it out to all clients without persisting it, so transport
  // never pollutes scene.json via autosave. patch shape: { playing?, seek? }.
  sendMediaCtrl(id, patch) {
    const ref = this._refCounter++
    return new Promise((resolve) => {
      this._opResolvers.set(ref, resolve)
      this._send({ type: 'mediaCtrl', ref, id, patch })
      setTimeout(() => {
        if (this._opResolvers.has(ref)) {
          this._opResolvers.delete(ref)
          resolve({ ok: false, error: 'timeout' })
        }
      }, 4000)
    })
  }

  // Authoritative YouTube timeline transport (serverClock / moderatorMaster).
  // patch: { playing?, seek?, stop?, rate? }
  sendYtTransport(id, patch) {
    const ref = this._refCounter++
    return new Promise((resolve) => {
      this._opResolvers.set(ref, resolve)
      this._send({ type: 'ytTransport', ref, id, patch })
      setTimeout(() => {
        if (this._opResolvers.has(ref)) {
          this._opResolvers.delete(ref)
          resolve({ ok: false, error: 'timeout' })
        }
      }, 4000)
    })
  }

  // moderatorMaster chase heartbeat. Fire-and-forget (no op-result wait).
  // patch: { current, playing?, rate? }
  sendYtTime(id, patch) {
    this._send({ type: 'ytTime', id, patch })
  }

  // Send a transient SoundPad one-shot (play a reaction sound / stop all).
  // Same non-persisted fan-out model as sendMediaCtrl: the server broadcasts it
  // to all clients including the sender, so the editor preview and the OBS
  // stream converge. payload shape: { src?, volume?, stopAll?, slotId? }.
  sendSoundPlay(payload) {
    const ref = this._refCounter++
    return new Promise((resolve) => {
      this._opResolvers.set(ref, resolve)
      this._send({ type: 'soundPlay', ref, ...payload })
      setTimeout(() => {
        if (this._opResolvers.has(ref)) {
          this._opResolvers.delete(ref)
          resolve({ ok: false, error: 'timeout' })
        }
      }, 4000)
    })
  }

  // Send raw JSON (used for resync).
  sendRaw(msg) { this._send(msg) }

  ping() { this._send({ type: 'ping' }) }
}

export const socket = new SceneSocket()
