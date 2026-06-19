// server/obs-bridge.js
// Connects to OBS Studio via obs-websocket (v5 protocol) and periodically
// polls the current scene's source transforms. The editor overlays these so
// the moderator can see exactly where OBS's OWN elements sit relative to the
// overlay — useful for avoiding overlaps and matching positions.
//
// Supports read (source transforms) and limited write operations:
//   - Toggle scene item visibility (show/hide a source in OBS).
//   - Switch the current program scene.
//   - List all scenes.
//
// Config (read from the environment at boot): OBS_HOST (default localhost:4455),
// OBS_PASSWORD (optional). The connection itself is user-controlled via the
// Settings panel — the bridge starts disconnected and only connects when the
// moderator hits "Connect" (POST /api/obs/connect). This avoids spamming retry
// attempts against a port the user may never use.

import OBSWebSocket from 'obs-websocket-js'

const HOST = process.env.OBS_HOST || 'localhost:4455'
const PASSWORD = process.env.OBS_PASSWORD || ''
const POLL_MS = 1500
const RETRY_MS = 5000

class ObsBridge {
  constructor() {
    this.obs = new OBSWebSocket()
    this.connected = false
    this.started = false         // has the moderator asked us to connect?
    this.sources = []            // [{ name, x, y, w, h, visible }]
    this.timer = null            // poll interval
    this._retry = null           // reconnect timeout
    this.onUpdate = null         // set by caller
  }

  // User flipped the switch to Connect. Idempotent: a second call while already
  // started is a no-op. Begins the connect+retry loop.
  start() {
    if (this.started) return
    this.started = true
    this._connect()
  }

  // User flipped the switch to Disconnect. Idempotent. Tears down the socket and
  // all timers, clears state, and notifies clients via onUpdate.
  stop() {
    this.started = false
    if (this._retry) { clearTimeout(this._retry); this._retry = null }
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.connected = false
    this.sources = []
    // Best-effort close; ignore errors from an already-closed socket.
    try { this.obs.disconnect() } catch (_) { /* already closed */ }
    if (this.onUpdate) this.onUpdate(this.sources)
  }

  async _connect() {
    if (!this.started) return
    try {
      await this.obs.connect(`ws://${HOST}`, PASSWORD)
      this.connected = true
      console.log(`[obs-bridge] connected to OBS at ${HOST}`)
      this.obs.on('ConnectionClosed', () => {
        this.connected = false
        console.log('[obs-bridge] disconnected')
        if (this.timer) { clearInterval(this.timer); this.timer = null }
        // Drop the now-stale bounds so the editor doesn't show a frozen frame.
        this.sources = []
        if (this.onUpdate) this.onUpdate(this.sources)
        // Only auto-retry if the user still wants to be connected.
        if (this.started) this._scheduleRetry()
      })
      this.obs.on('SceneItemTransformChanged', () => this._poll()) // live update
      this._poll()
      this.timer = setInterval(() => this._poll(), POLL_MS)
    } catch (e) {
      // OBS likely not running / websocket disabled — non-fatal. Keep retrying
      // while the user wants to be connected so it recovers when OBS comes up.
      this.connected = false
      if (this.started) this._scheduleRetry()
    }
  }

  _scheduleRetry() {
    if (this._retry) return
    if (!this.started) return
    this._retry = setTimeout(() => { this._retry = null; this._connect() }, RETRY_MS)
  }

  async _poll() {
    if (!this.connected) return
    try {
      // Get the current program scene name.
      const program = await this.obs.call('GetCurrentProgramScene')
      const sceneName = program?.currentProgramSceneName
      if (!sceneName) return
      // List the sources (items) in that scene with their transforms.
      const list = await this.obs.call('GetSceneItemList', { sceneName })
      this.sources = (list.sceneItems || [])
        .filter((it) => it.sceneItemTransform)
        .map((it) => {
          const t = it.sceneItemTransform
          // OBS bounds: positionX/Y is top-left of the source; width/height are
          // the source's own dimensions; we want the bounding box on the canvas.
          const w = Math.abs((t.scaleX || 1) * (t.width || 0))
          const h = Math.abs((t.scaleY || 1) * (t.height || 0))
          return {
            name: it.sourceName,
            x: Math.round(t.positionX || 0),
            y: Math.round(t.positionY || 0),
            w: Math.round(w),
            h: Math.round(h),
            visible: it.sceneItemEnabled !== false,
            scene: sceneName
          }
        })
      if (this.onUpdate) this.onUpdate(this.sources)
    } catch (e) {
      // Transient OBS error; ignore, will retry on next poll.
    }
  }

  snapshot() { return { connected: this.connected, host: HOST, sources: this.sources } }

  // --- Write operations (moderator-controlled) --------------------------------

  // Toggle a scene item's visibility in the current OBS scene.
  // Returns { ok, error? }.
  async setItemEnabled(sceneName, itemName, enabled) {
    if (!this.connected) return { ok: false, error: 'OBS not connected' }
    try {
      const list = await this.obs.call('GetSceneItemList', { sceneName })
      const item = list?.sceneItems?.find((it) => it.sourceName === itemName)
      if (!item) return { ok: false, error: 'source not found in scene' }
      await this.obs.call('SetSceneItemEnabled', {
        sceneName,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: !!enabled
      })
      // Re-poll so the editor overlay updates immediately.
      this._poll()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // Switch the current program scene in OBS.
  // Returns { ok, error? }.
  async switchScene(sceneName) {
    if (!this.connected) return { ok: false, error: 'OBS not connected' }
    try {
      await this.obs.call('SwitchToProgramScene', { sceneName })
      // Re-poll to update the source list for the new scene.
      this._poll()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // List all scenes in OBS.
  // Returns { scenes: [{ name, active }] }.
  async listScenes() {
    if (!this.connected) return { scenes: [] }
    try {
      const res = await this.obs.call('GetSceneList')
      const current = res?.currentProgramSceneName
      return {
        scenes: (res?.scenes || []).map((s) => ({
          name: s.sceneName,
          active: s.sceneName === current
        }))
      }
    } catch (e) {
      return { scenes: [] }
    }
  }
}

export const bridge = new ObsBridge()
