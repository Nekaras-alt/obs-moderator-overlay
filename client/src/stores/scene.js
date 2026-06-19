// client/src/stores/scene.js
// Pinia store: the authoritative scene as seen by this client. It mirrors the
// server's canonical state. The editor mutates via sendOp() (server validates
// and broadcasts back); /obs only ever receives 'scene' messages.

import { defineStore } from 'pinia'
import { socket } from '../services/ws.js'
import { createLayer } from '@shared/schema.js'

export const useSceneStore = defineStore('scene', {
  state: () => ({
    layers: [],
    settings: {},
    folders: [],
    presets: [],
    trash: [],
    connected: false,
    selectedId: null,
    // OBS bridge: native source boundaries from OBS (editor-only overlay).
    obsSources: [],
    obsConnected: false,
    // Temporary objects: absolute expiry (ms epoch) per layer id, and the
    // display map of seconds remaining (updated every second by _ttlTick).
    // ttlExpiresAt is the source of truth; ttlRemaining is its read-out.
    ttlExpiresAt: {},
    ttlRemaining: {},
    // Media transport sync. mediaCtrl is the latest broadcast command per
    // layer id: { playing?, seek?, nonce }. StageRenderer watches it and
    // applies play/pause/seek to the live <video>/<audio> elements in BOTH
    // editor and OBS mode. mediaState is the editor-only readout
    // (current/duration/playing) pushed back up from the renderer for the
    // transport bars; not authoritative, not persisted.
    mediaCtrl: {},
    mediaState: {}
  }),
  getters: {
    selected: (s) => s.layers.find((l) => l.id === s.selectedId) || null,
    // Layers sorted by stacking order (front = last, like OBS).
    orderedLayers: (s) => [...s.layers].sort((a, b) => (a.order || 0) - (b.order || 0))
  },
  actions: {
    // --- connection plumbing ---
    connect(token) {
      // Register WS listeners once. The socket may be reused across
      // disconnect/reconnect cycles (e.g. failed auto-login → PIN login).
      if (!this._wsBound) {
        socket.onMessage((msg) => this._onMessage(msg))
        socket.onStatus((v) => (this.connected = v))
        this._wsBound = true
      }
      socket.connect(token)
    },
    disconnect() {
      socket.disconnect()
      this.connected = false
    },
    _onMessage(msg) {
      if (msg.type === 'scene') {
        // Full resync from server (authoritative).
        this.layers = msg.scene.layers || []
        this.settings = msg.scene.settings || {}
        this.folders = msg.scene.folders || []
        this.presets = msg.scene.presets || []
        this.trash = msg.scene.trash || []
        // Rebuild the TTL expiry map from the authoritative layer list. Any
        // id no longer present is dropped (server already deleted it).
        this._rebuildTtl()
      } else if (msg.type === 'obs-sources') {
        // Native OBS source boundaries (editor-only overlay).
        this.obsSources = msg.sources || []
        this.obsConnected = !!msg.obsConnected
      } else if (msg.type === 'media-ctrl') {
        // Transient transport command fanned out by the server. Replace this
        // id's slot with the new command object (carries a nonce so a repeat
        // — e.g. two seeks to the same time — still fires in the watcher).
        this.mediaCtrl = { ...this.mediaCtrl, [msg.id]: { ...(msg.patch || {}), nonce: msg.nonce } }
      } else if (msg.type === 'error') {
        console.warn('[scene] server error:', msg.error)
      }
    },

    // --- op senders (moderator only) ---
    async addLayer(partial) {
      // Assign order = max+1 so it lands on top.
      const order = this.layers.reduce((m, l) => Math.max(m, l.order || 0), -1) + 1
      const layer = createLayer({ ...partial, order })
      await socket.sendOp({ kind: 'addLayer', layer })
      this.selectedId = layer.id
      return layer
    },
    async updateLayer(id, patch) {
      await socket.sendOp({ kind: 'updateLayer', id, patch })
    },
    async deleteLayer(id) {
      await socket.sendOp({ kind: 'deleteLayer', id })
      if (this.selectedId === id) this.selectedId = null
    },
    async restoreLayer(id) {
      await socket.sendOp({ kind: 'restoreLayer', id })
    },
    async purgeTrash() {
      await socket.sendOp({ kind: 'purgeTrash' })
    },
    async reorder(orderIds) {
      await socket.sendOp({ kind: 'reorder', order: orderIds })
    },
    async clearWorkspace() {
      await socket.sendOp({ kind: 'clearWorkspace' })
      this.selectedId = null
    },
    async updateSettings(patch) {
      await socket.sendOp({ kind: 'updateSettings', patch })
    },
    async duplicateLayer(id) {
      const l = this.layers.find((x) => x.id === id)
      if (!l) return
      const copy = createLayer({
        ...JSON.parse(JSON.stringify(l)),
        id: undefined,
        name: l.name + ' copy',
        transform: { ...l.transform, x: l.transform.x + 24, y: l.transform.y + 24 }
      })
      await this.addLayer(copy)
    },
    // Move a layer to a new stacking index (0 = back). Rebuilds the order array
    // and sends the full id list so the server's reorder stays authoritative.
    async moveLayerTo(id, newIndex) {
      const ordered = [...this.layers].sort((a, b) => (a.order || 0) - (b.order || 0))
      const from = ordered.findIndex((l) => l.id === id)
      if (from === -1) return
      const [moved] = ordered.splice(from, 1)
      ordered.splice(newIndex, 0, moved)
      await this.reorder(ordered.map((l) => l.id))
    },
    select(id) { this.selectedId = id },

    // --- Temporary objects (TTL) -------------------------------------------
    // A layer with `ttl` (seconds) auto-deletes itself after the countdown
    // reaches zero. The start moment is persisted as `ttlStartedAt` (ms epoch)
    // so every editor client converges on the same expiry regardless of when it
    // connected. When it elapses the layer is deleted via the normal op
    // (server-authoritative); /obs just stops rendering once the server drops it.
    startTtl(id, seconds) {
      const l = this.layers.find((x) => x.id === id)
      if (!l) return
      const ttl = Math.max(1, Math.floor(seconds))
      const startedAt = Date.now()
      // Persist ttl + ttlStartedAt; both round-trip through the server's
      // generic updateLayer (Object.assign) so they survive reconnect/reload.
      this.updateLayer(id, { ttl, ttlStartedAt: startedAt })
      // Optimistically seed the local expiry so the badge appears instantly.
      this.ttlExpiresAt = { ...this.ttlExpiresAt, [id]: startedAt + ttl * 1000 }
      this._ensureTtlTick()
    },
    cancelTtl(id) {
      const l = this.layers.find((x) => x.id === id)
      if (!l) return
      this.updateLayer(id, { ttl: null, ttlStartedAt: null })
      const next = { ...this.ttlExpiresAt }
      delete next[id]
      this.ttlExpiresAt = next
      const rem = { ...this.ttlRemaining }
      delete rem[id]
      this.ttlRemaining = rem
    },
    // Rebuild ttlExpiresAt from the authoritative layer list (used after a
    // scene resync). ttlStartedAt anchors the countdown so it is stable across
    // clients regardless of when each connected.
    _rebuildTtl() {
      const now = Date.now()
      const next = {}
      for (const l of this.layers) {
        if (l.ttl && l.ttl > 0 && l.ttlStartedAt) {
          next[l.id] = l.ttlStartedAt + l.ttl * 1000
        }
      }
      this.ttlExpiresAt = next
      if (Object.keys(next).length) {
        this._ensureTtlTick()
        // Drop any that already expired during the rebuild.
        if (Object.values(next).some((exp) => exp <= now)) this._ttlTick()
      } else {
        this._stopTtlTick()
      }
    },
    _ensureTtlTick() {
      if (this._ttlTimer) return
      this._ttlTimer = setInterval(() => this._ttlTick(), 1000)
      this._ttlTick() // run immediately so the first badge value is correct
    },
    _stopTtlTick() {
      if (this._ttlTimer) { clearInterval(this._ttlTimer); this._ttlTimer = null }
      this.ttlRemaining = {}
    },
    _ttlTick() {
      const now = Date.now()
      const expires = this.ttlExpiresAt
      const ids = Object.keys(expires)
      if (!ids.length) { this._stopTtlTick(); return }
      const rem = {}
      const expired = []
      for (const id of ids) {
        const left = Math.ceil((expires[id] - now) / 1000)
        if (left <= 0) expired.push(id)
        else rem[id] = left
      }
      this.ttlRemaining = rem
      // Delete expired layers through the normal op so the server stays the
      // source of truth and every client converges.
      for (const id of expired) {
        const next = { ...this.ttlExpiresAt }
        delete next[id]
        this.ttlExpiresAt = next
        if (this.layers.some((x) => x.id === id)) this.deleteLayer(id)
      }
    },
    // Add a brand-new temporary layer of a media-like type (used by the
    // toolbar's "temporary object" preset row). It is created hidden from the
    // audience so the moderator can position it, then revealed manually.
    async addTemporaryLayer(partial, ttlSeconds) {
      const layer = await this.addLayer(partial)
      if (ttlSeconds && ttlSeconds > 0) this.startTtl(layer.id, ttlSeconds)
      return layer
    },    // Folders: moderator-defined groups (memes, videos, ads, ...).
    async addFolder(name) {
      const folder = { id: 'f' + Date.now().toString(36), name: name || 'Folder', color: '#888' }
      // Folders live in scene.folders; persist via a generic settings-like op.
      // We piggyback on updateSettings shape by storing folders through a
      // dedicated op in the server; here we just push locally + resync.
      await socket.sendOp({ kind: 'addFolder', folder })
      return folder
    },
    async removeFolder(id) {
      await socket.sendOp({ kind: 'removeFolder', id })
    },

    // --- Presets ---
    async savePreset(name) {
      const res = await socket.sendOp({ kind: 'savePreset', name: name || 'Preset' })
      return res?.presetId
    },
    async loadPreset(id) {
      await socket.sendOp({ kind: 'loadPreset', id })
      this.selectedId = null
    },
    async removePreset(id) {
      await socket.sendOp({ kind: 'removePreset', id })
    },

    // --- OBS bridge connect/disconnect ---
    // Flips the server-side obs-websocket link on/off AND persists the
    // moderator's intent into scene.settings.obsEnabled, so the bridge
    // auto-starts on the next server boot (see server/index.js boot check).
    // The server pushes the new obsConnected state back over WS via the
    // existing 'obs-sources' message, so we don't set state optimistically —
    // we only mirror the persisted intent (obsEnabled), not the live link
    // (obsConnected), which can drop and reconnect independently.
    async toggleObs(connect) {
      // Persist intent first: even if the HTTP connect fails (OBS not running
      // yet), the choice is recorded so the boot logic re-asserts it later.
      await this.updateSettings({ obsEnabled: !!connect })
      const token = localStorage.getItem('omo_token') || ''
      await fetch('/api/obs/' + (connect ? 'connect' : 'disconnect'), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      })
    },

    // --- Manual save (force persist) ---
    async forceSave() {
      await socket.sendOp({ kind: 'forceSave' })
    },

    // --- Media transport (play / pause / seek) -------------------------------
    // Sends a transient transport command for a media layer. The server fans
    // it out to every client (editor + OBS) without persisting it, so the
    // stream follows the moderator's transport. patch: { playing?, seek? }.
    // Optimistically seed the local ctrl slot so the editor preview reacts
    // instantly even before the broadcast echoes back.
    async sendMediaCtrl(id, patch) {
      this.mediaCtrl = { ...this.mediaCtrl, [id]: { ...patch, nonce: 'local-' + Date.now() } }
      await socket.sendMediaCtrl(id, patch)
    },
    // Editor-only readout from StageRenderer: live current/duration/playing
    // for the transport bars. Never sent to the server.
    setMediaState(id, partial) {
      this.mediaState = { ...this.mediaState, [id]: { ...(this.mediaState[id] || {}), ...partial } }
    }
  }
})
