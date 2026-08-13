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
    obsLayoutRev: 0,
    obsLayoutTarget: 'program', // program | preview
    obsStudioMode: false,
    obsProgramScene: '',
    obsPreviewScene: '',
    obsSelectedId: null,
    obsPreviewStatus: null,
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
    mediaState: {},
    // Authoritative YouTube timelines (serverClock / moderatorMaster).
    // id -> { playing, mediaTime, wallClock, rate, stop, nonce }
    ytTimeline: {},
    // Soft sync status from StageRenderer (editor UI): id -> { correcting, driftMs }
    ytSyncStatus: {},
    // SoundPad row: 10 trigger slots (server-authoritative, persisted). Each
    // { name, src, volume, color }. Healed to length 10 by the server.
    soundpad: [],
    // Transient SoundPad play signal: { src, volume, stopAll, nonce }. Replaced
    // wholesale on every broadcast (the nonce lets repeats re-fire). SoundPlayer
    // watches this and plays; not persisted.
    pendingSound: null,
    // Which pad slot is currently playing (for visual feedback). Set by
    // SoundPlayer when a sound starts, cleared when it ends or stopAll fires.
    playingSlotId: null,
    // Live moderator presence (WS).
    presence: [],
    // Scene revision from server (patch protocol).
    rev: 0,
    // Donation queue mirror.
    donationQueue: { paused: false, current: null, pending: [], log: [] },
    // Undo / redo stacks (client-side, max 50).
    _undoStack: [],
    _redoStack: []
  }),
  getters: {
    selected: (s) => s.layers.find((l) => l.id === s.selectedId) || null,
    orderedLayers: (s) => [...s.layers].sort((a, b) => (a.order || 0) - (b.order || 0)),
    moderatorCount: (s) => (s.presence || []).length,
    canUndo: (s) => (s._undoStack || []).length > 0,
    canRedo: (s) => (s._redoStack || []).length > 0,
    performMode: (s) => !!s.settings.performMode
  },
  actions: {
    _pushUndo() {
      const snap = {
        layers: JSON.parse(JSON.stringify(this.layers)),
        folders: JSON.parse(JSON.stringify(this.folders)),
        soundpad: JSON.parse(JSON.stringify(this.soundpad))
      }
      this._undoStack = [...(this._undoStack || []).slice(-49), snap]
      this._redoStack = []
    },
    async undo() {
      if (!this._undoStack?.length) return
      const prev = this._undoStack[this._undoStack.length - 1]
      this._undoStack = this._undoStack.slice(0, -1)
      this._redoStack = [...(this._redoStack || []), {
        layers: JSON.parse(JSON.stringify(this.layers)),
        folders: JSON.parse(JSON.stringify(this.folders)),
        soundpad: JSON.parse(JSON.stringify(this.soundpad))
      }]
      await socket.sendOp({ kind: 'replaceScene', scene: {
        ...JSON.parse(JSON.stringify({
          layers: prev.layers,
          folders: prev.folders,
          soundpad: prev.soundpad,
          settings: this.settings,
          presets: this.presets,
          trash: this.trash,
          version: 1
        }))
      }})
    },
    async redo() {
      if (!this._redoStack?.length) return
      const next = this._redoStack[this._redoStack.length - 1]
      this._redoStack = this._redoStack.slice(0, -1)
      this._undoStack = [...(this._undoStack || []), {
        layers: JSON.parse(JSON.stringify(this.layers)),
        folders: JSON.parse(JSON.stringify(this.folders)),
        soundpad: JSON.parse(JSON.stringify(this.soundpad))
      }]
      await socket.sendOp({ kind: 'replaceScene', scene: {
        layers: next.layers,
        folders: next.folders,
        soundpad: next.soundpad,
        settings: this.settings,
        presets: this.presets,
        trash: this.trash,
        version: 1
      }})
    },
    connect(token) {
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
    _applyOpLocally(op) {
      if (!op) return
      if (op.kind === 'updateLayer') {
        const l = this.layers.find((x) => x.id === op.id)
        if (!l) return
        Object.assign(l, op.patch)
        if (op.patch?.transform) l.transform = { ...l.transform, ...op.patch.transform }
      } else if (op.kind === 'updateSettings') {
        this.settings = { ...this.settings, ...(op.patch || {}) }
      } else if (op.kind === 'updateSoundpad') {
        const id = Math.floor(op.slotId)
        if (!Array.isArray(this.soundpad)) this.soundpad = []
        if (id >= 0 && id < this.soundpad.length) {
          this.soundpad[id] = { name: '', src: '', volume: 1, color: '#3b82f6', ...op.slot }
        }
      }
    },
    _onMessage(msg) {
      if (msg.type === 'scene') {
        this.layers = msg.scene.layers || []
        this.settings = msg.scene.settings || {}
        this.folders = msg.scene.folders || []
        this.presets = msg.scene.presets || []
        this.trash = msg.scene.trash || []
        this.soundpad = msg.scene.soundpad || []
        if (typeof msg.rev === 'number') this.rev = msg.rev
        this._rebuildTtl()
        // Background: CDN emote layers → local /uploads/emotes (offline)
        import('../features/emotes.js')
          .then((m) => m.hydrateClientEmotes())
          .catch(() => { /* ignore */ })
      } else if (msg.type === 'patch') {
        if (typeof msg.rev === 'number') {
          if (this.rev && msg.rev > this.rev + 1) {
            socket.sendRaw({ type: 'resync' })
          }
          this.rev = msg.rev
        }
        this._applyOpLocally(msg.op)
      } else if (msg.type === 'presence') {
        this.presence = msg.moderators || []
      } else if (msg.type === 'donation-queue') {
        this.donationQueue = {
          paused: !!msg.paused,
          current: msg.current || null,
          pending: msg.pending || [],
          log: msg.log || this.donationQueue.log || []
        }
      } else if (msg.type === 'donation-play' || msg.type === 'donation-stop') {
        // Queue snapshot usually follows; keep soft update
      } else if (msg.type === 'obs-sources' || msg.type === 'obs-layout') {
        this.obsSources = msg.sources || []
        this.obsConnected = !!msg.obsConnected
        if (msg.rev != null) this.obsLayoutRev = msg.rev
        if (msg.target) this.obsLayoutTarget = msg.target
        if (typeof msg.studioMode === 'boolean') this.obsStudioMode = msg.studioMode
        if (msg.programScene != null) this.obsProgramScene = msg.programScene
        if (msg.previewScene != null) this.obsPreviewScene = msg.previewScene
      } else if (msg.type === 'obs-layout-patch') {
        this.obsConnected = msg.obsConnected !== undefined ? !!msg.obsConnected : this.obsConnected
        if (msg.rev != null) this.obsLayoutRev = msg.rev
        if (msg.target) this.obsLayoutTarget = msg.target
        if (typeof msg.studioMode === 'boolean') this.obsStudioMode = msg.studioMode
        if (msg.programScene != null) this.obsProgramScene = msg.programScene
        if (msg.previewScene != null) this.obsPreviewScene = msg.previewScene
        const removes = new Set(msg.removes || [])
        let next = (this.obsSources || []).filter((s) => !removes.has(s.id))
        const byId = new Map(next.map((s) => [s.id, s]))
        for (const u of msg.upserts || []) {
          byId.set(u.id, { ...(byId.get(u.id) || {}), ...u })
        }
        this.obsSources = [...byId.values()].sort((a, b) => (a.index || 0) - (b.index || 0))
      } else if (msg.type === 'obs-preview-status') {
        this.obsPreviewStatus = {
          mode: msg.mode || null,
          whepUrl: msg.whepUrl || null,
          mjpegPath: msg.mjpegPath || '/api/obs/preview.mjpeg',
          fps: msg.fps || 4,
          width: msg.width || 960,
          connected: !!msg.connected,
          lastError: msg.lastError || null
        }
      } else if (msg.type === 'media-ctrl') {
        this.mediaCtrl = { ...this.mediaCtrl, [msg.id]: { ...(msg.patch || {}), nonce: msg.nonce } }
      } else if (msg.type === 'yt-timeline') {
        if (msg.id && msg.timeline) {
          this.ytTimeline = { ...this.ytTimeline, [msg.id]: { ...msg.timeline } }
        }
      } else if (msg.type === 'yt-timelines') {
        this.ytTimeline = { ...(msg.timelines || {}) }
      } else if (msg.type === 'yt-chase') {
        if (msg.id && msg.timeline) {
          this.ytTimeline = { ...this.ytTimeline, [msg.id]: { ...msg.timeline, _chase: true } }
        }
      } else if (msg.type === 'sound-play') {
        const cur = this.pendingSound
        if (cur && cur.src === msg.src && !!cur.stopAll === !!msg.stopAll &&
            typeof cur.nonce === 'string' && cur.nonce.startsWith('local-')) {
          return
        }
        this.pendingSound = {
          src: msg.src, volume: msg.volume, stopAll: msg.stopAll, slotId: msg.slotId,
          nonce: msg.nonce, compressor: msg.compressor ?? !!this.settings.soundpadCompressor
        }
      } else if (msg.type === 'error') {
        console.warn('[scene] server error:', msg.error)
      }
    },

    async addLayer(partial) {
      this._pushUndo()
      const order = this.layers.reduce((m, l) => Math.max(m, l.order || 0), -1) + 1
      const layer = createLayer({ ...partial, order })
      await socket.sendOp({ kind: 'addLayer', layer })
      this.selectedId = layer.id
      return layer
    },
    async updateLayer(id, patch, { optimistic = false } = {}) {
      if (!optimistic) this._pushUndo()
      if (optimistic) {
        this._applyOpLocally({ kind: 'updateLayer', id, patch })
      }
      await socket.sendOp({ kind: 'updateLayer', id, patch })
    },
    async deleteLayer(id) {
      this._pushUndo()
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
      this._pushUndo()
      await socket.sendOp({ kind: 'clearWorkspace' })
      this.selectedId = null
    },
    async togglePerformMode() {
      await this.updateSettings({ performMode: !this.settings.performMode })
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

    selectObsSource(id) {
      this.obsSelectedId = id == null ? null : id
    },

    async setObsLayoutTarget(target) {
      const token = localStorage.getItem('omo_token') || ''
      const r = await fetch('/api/obs/layout-target', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({ target: target === 'preview' ? 'preview' : 'program' })
      })
      const data = await r.json().catch(() => ({}))
      if (data?.target) this.obsLayoutTarget = data.target
      return data
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
    // Authoritative YouTube transport → server timeline → broadcast yt-timeline.
    async sendYtTransport(id, patch) {
      const prev = this.ytTimeline[id] || {}
      const hasSeek = typeof patch.seek === 'number' && isFinite(patch.seek)
      let mediaTime = hasSeek ? Math.max(0, patch.seek) : (prev.mediaTime || 0)
      let playing = !!prev.playing
      if (patch.stop) {
        playing = false
        mediaTime = 0
      } else if (patch.playing === true) {
        playing = true
      } else if (patch.playing === false) {
        playing = false
      }
      const forceSeek = !!patch.stop || hasSeek || (playing !== !!prev.playing)
      const nonce = 'local-' + Date.now()
      const optimistic = {
        id,
        playing,
        mediaTime,
        wallClock: Date.now(),
        rate: typeof patch.rate === 'number' && patch.rate > 0 ? patch.rate : (prev.rate || 1),
        stop: !!patch.stop,
        forceSeek,
        nonce
      }
      this.ytTimeline = { ...this.ytTimeline, [id]: optimistic }
      // Optimistic media-ctrl so editor iframe moves immediately (same as legacy).
      const ctrl = {}
      if (patch.stop) ctrl.stop = true
      else {
        if (forceSeek) ctrl.seek = mediaTime
        if (patch.playing === true || patch.playing === false) ctrl.playing = playing
        else if (forceSeek && playing) ctrl.playing = true
      }
      this.mediaCtrl = { ...this.mediaCtrl, [id]: { ...ctrl, nonce } }
      await socket.sendYtTransport(id, patch)
    },
    // moderatorMaster heartbeat (fire-and-forget).
    sendYtTime(id, patch) {
      socket.sendYtTime(id, patch)
    },
    // Editor-only readout from StageRenderer: live current/duration/playing
    // for the transport bars. Never sent to the server.
    setMediaState(id, partial) {
      this.mediaState = { ...this.mediaState, [id]: { ...(this.mediaState[id] || {}), ...partial } }
    },
    setYtSyncStatus(id, partial) {
      this.ytSyncStatus = { ...this.ytSyncStatus, [id]: { ...(this.ytSyncStatus[id] || {}), ...partial } }
    },

    // --- SoundPad slots (persisted) -----------------------------------------
    // Replace one of the 10 slot objects. slotId is 0..9. Server-authoritative
    // via the updateSoundpad op, so a second moderator (or a reload) converges.
    async setSoundpadSlot(slotId, slot) {
      let next = { ...slot }
      const src = next.src || ''
      if (/^https?:\/\//i.test(src)) {
        try {
          const token = localStorage.getItem('omo_token') || ''
          const r = await fetch('/api/sounds/cache', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: src, name: next.name })
          }).then((x) => x.json())
          if (r.ok && r.src) next.src = r.src
        } catch (_) { /* keep CDN */ }
      }
      await socket.sendOp({ kind: 'updateSoundpad', slotId, slot: next })
    },

    // --- SoundPad playback (transient) -------------------------------------
    // Play a reaction sound on BOTH moderator + OBS.
    // CRITICAL: update pendingSound synchronously here (in user gesture context)
    // so the browser allows audio playback. The server broadcast will echo back
    // with a different nonce, but the watcher ignores it (lastNonce already set).
    async sendSoundPlay({ src, volume, slotId } = {}) {
      if (!src) return
      const master = typeof this.settings.soundpadMasterVolume === 'number' ? this.settings.soundpadMasterVolume : 0.5
      const vol = (typeof volume === 'number' ? volume : 1) * master
      const nonce = 'local-' + Date.now() + '-' + Math.random()
      const compressor = !!this.settings.soundpadCompressor
      this.pendingSound = { src, volume: vol, stopAll: false, slotId, nonce, compressor }
      await socket.sendSoundPlay({ src, volume: typeof volume === 'number' ? volume : 1, stopAll: false, slotId, compressor })
    },
    previewSound({ src, volume, slotId } = {}) {
      if (!src) return
      const master = typeof this.settings.soundpadMasterVolume === 'number' ? this.settings.soundpadMasterVolume : 0.5
      const vol = (typeof volume === 'number' ? volume : 1) * master
      this.pendingSound = {
        src, volume: vol, stopAll: false, slotId,
        nonce: 'preview-' + Date.now() + '-' + Math.random(),
        compressor: !!this.settings.soundpadCompressor
      }
    },
    // Stop every SoundPad <audio> element in editor and OBS at once.
    async stopAllSounds() {
      this.pendingSound = { stopAll: true, nonce: 'stop-' + Date.now() + '-' + Math.random() }
      this.playingSlotId = null
      await socket.sendSoundPlay({ stopAll: true })
    }
  }
})
