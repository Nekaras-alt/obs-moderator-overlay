// server/state.js
// Canonical scene state, persisted to disk. This is the single source of truth:
// the editor patches this, the server broadcasts it, /obs renders from it.
// Autosave every 30s + on shutdown; restores last good state on crash.

import fs from 'node:fs'
import path from 'node:path'
import { createInitialScene, emptySoundpad, SOUNDPAD_SLOTS } from '../shared/schema.js'
import { DATA_DIR, ensureDirs } from './config/paths.js'

const SCENE_FILE = path.join(DATA_DIR, 'scene.json')
const BACKUP_FILE = path.join(DATA_DIR, 'scene.bak.json')
const AUTOSAVE_INTERVAL = 30_000

// Ops that warrant a full scene broadcast (vs incremental patch).
export const FULL_SYNC_OPS = new Set([
  'addLayer', 'deleteLayer', 'restoreLayer', 'purgeTrash', 'reorder',
  'clearWorkspace', 'loadPreset', 'replaceScene', 'addFolder', 'removeFolder',
  'savePreset', 'removePreset'
])

class StateStore {
  constructor() {
    this.scene = null
    this.dirty = false
    this.lastSavedAt = 0
    this.rev = 0
    this._ensureDataDir()
    this.load()
    this._startAutosave()
  }

  _ensureDataDir() {
    ensureDirs()
  }

  // Load with crash-recovery: keep a .bak of the last good save. If the main
  // file is corrupt/missing, fall back to .bak; if both are gone, start fresh.
  load() {
    const tryRead = (file) => {
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.layers)) return parsed
      } catch (_) { /* ignore corrupt files */ }
      return null
    }
    this.scene = tryRead(SCENE_FILE) || tryRead(BACKUP_FILE) || createInitialScene()
      // Heal any missing fields against the current schema. Settings is merged
      // field-by-field (not replaced) so a newly added default is backfilled
      // into older save files without clobbering user choices.
      const defaults = createInitialScene()
    this.scene = { ...defaults, ...this.scene }
    this.scene.settings = { ...defaults.settings, ...(this.scene.settings || {}) }
    // Heal the SoundPad row: backfill slots on older saves that predate the
    // field, and pad/truncate to the current slot count so a schema bump never
    // leaves a partial row. Existing slot contents are preserved.
    const pad = emptySoundpad()
    const loaded = Array.isArray(this.scene.soundpad) ? this.scene.soundpad.slice(0, SOUNDPAD_SLOTS) : []
    this.scene.soundpad = pad.map((slot, i) =>
      loaded[i] && typeof loaded[i] === 'object'
        ? { name: '', src: '', volume: 1, color: '#3b82f6', ...loaded[i] }
        : slot
    )
    console.log(`[state] loaded scene with ${this.scene.layers.length} layers`)
  }

  markDirty() { this.dirty = true }

  save(force = false) {
    if (!force && !this.dirty) return
    try {
      // Rotate: current main file becomes the backup before we overwrite it.
      if (fs.existsSync(SCENE_FILE)) {
        try { fs.copyFileSync(SCENE_FILE, BACKUP_FILE) } catch (_) { /* best effort */ }
      }
      const tmp = SCENE_FILE + '.tmp'
      // Atomic-ish write: write to tmp then rename, so a crash mid-write
      // can't leave a half-written main file.
      fs.writeFileSync(tmp, JSON.stringify(this.scene, null, 2), 'utf8')
      fs.renameSync(tmp, SCENE_FILE)
      this.dirty = false
      this.lastSavedAt = Date.now()
    } catch (err) {
      console.error('[state] save failed:', err.message)
    }
  }

  _startAutosave() {
    setInterval(() => this.save(), AUTOSAVE_INTERVAL)
    // Persist on a graceful shutdown so the next launch resumes cleanly.
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => { this.save(true); process.exit(0) })
    }
  }

  // Replace the whole scene (e.g. on "restore backup" or "clear workspace").
  replace(newScene) {
    this.scene = { ...createInitialScene(), ...newScene }
    this.markDirty()
  }

  snapshot() {
    // Return a deep clone so callers can't mutate internal state by reference.
    return JSON.parse(JSON.stringify(this.scene))
  }

  // Apply a patch operation. Returns { ok, error?, rev?, kind? }.
  apply(op) {
    const s = this.scene
    const result = this._applyInner(op)
    if (result.ok) {
      this.rev++
      result.rev = this.rev
      result.kind = op.kind
      result.fullSync = FULL_SYNC_OPS.has(op.kind)
    }
    return result
  }

  _applyInner(op) {
    const s = this.scene
    switch (op.kind) {
      case 'addLayer': {
        s.layers.push(op.layer)
        this.markDirty()
        return { ok: true }
      }
      case 'updateLayer': {
        const l = s.layers.find((x) => x.id === op.id)
        if (!l) return { ok: false, error: 'layer not found' }
        Object.assign(l, op.patch)
        if (op.patch.transform) l.transform = { ...l.transform, ...op.patch.transform }
        this.markDirty()
        return { ok: true }
      }
      case 'deleteLayer': {
        const idx = s.layers.findIndex((x) => x.id === op.id)
        if (idx === -1) return { ok: false, error: 'layer not found' }
        const [removed] = s.layers.splice(idx, 1)
        // Soft-delete: keep in trash so the moderator can restore it.
        s.trash.push({ ...removed, deletedAt: Date.now() })
        this.markDirty()
        return { ok: true }
      }
      case 'restoreLayer': {
        // Move a layer back out of the trash.
        const idx = s.trash.findIndex((x) => x.id === op.id)
        if (idx === -1) return { ok: false, error: 'not in trash' }
        const [restored] = s.trash.splice(idx, 1)
        delete restored.deletedAt
        s.layers.push(restored)
        this.markDirty()
        return { ok: true }
      }
      case 'purgeTrash': {
        s.trash = []
        this.markDirty()
        return { ok: true }
      }
      case 'reorder': {
        // op.order is an array of layer ids in the desired stacking order.
        const map = new Map(s.layers.map((l) => [l.id, l]))
        s.layers = op.order.map((id) => map.get(id)).filter(Boolean)
        s.layers.forEach((l, i) => (l.order = i))
        this.markDirty()
        return { ok: true }
      }
      case 'clearWorkspace': {
        // Move everything to trash (recoverable) rather than destroying it.
        const now = Date.now()
        s.trash.push(...s.layers.map((l) => ({ ...l, deletedAt: now })))
        s.layers = []
        this.markDirty()
        return { ok: true }
      }
      case 'updateSettings': {
        s.settings = { ...s.settings, ...op.patch }
        this.markDirty()
        return { ok: true }
      }
      case 'addFolder': {
        s.folders.push(op.folder)
        this.markDirty()
        return { ok: true }
      }
      case 'removeFolder': {
        s.folders = s.folders.filter((f) => f.id !== op.id)
        // Unassign layers that were in this folder.
        for (const l of s.layers) if (l.folder === op.id) l.folder = null
        this.markDirty()
        return { ok: true }
      }
      case 'savePreset': {
        // Snapshot current layers under a preset name.
        const id = op.id || ('p' + Date.now().toString(36))
        const existing = s.presets.findIndex((p) => p.id === id)
        const preset = { id, name: op.name || 'Preset', snapshot: JSON.parse(JSON.stringify(s.layers)) }
        if (existing >= 0) s.presets[existing] = preset
        else s.presets.push(preset)
        this.markDirty()
        return { ok: true, presetId: id }
      }
      case 'loadPreset': {
        const p = s.presets.find((x) => x.id === op.id)
        if (!p) return { ok: false, error: 'preset not found' }
        s.layers = JSON.parse(JSON.stringify(p.snapshot))
        this.markDirty()
        return { ok: true }
      }
      case 'removePreset': {
        s.presets = s.presets.filter((x) => x.id !== op.id)
        this.markDirty()
        return { ok: true }
      }
      case 'replaceScene': {
        this.replace(op.scene)
        return { ok: true }
      }
      case 'forceSave': {
        this.save(true)
        return { ok: true }
      }
      case 'updateSoundpad': {
        // Replace one slot in the fixed 10-slot row. op.slotId is 0..9, op.slot
        // is the new slot object. Bound-checked so a bad id can't overflow the row.
        const id = Math.floor(op.slotId)
        if (id < 0 || id >= SOUNDPAD_SLOTS) return { ok: false, error: 'slot out of range' }
        if (!op.slot || typeof op.slot !== 'object') return { ok: false, error: 'bad slot' }
        if (!Array.isArray(s.soundpad) || s.soundpad.length !== SOUNDPAD_SLOTS) {
          s.soundpad = emptySoundpad()
        }
        s.soundpad[id] = { name: '', src: '', volume: 1, color: '#3b82f6', ...op.slot }
        this.markDirty()
        return { ok: true }
      }
      default:
        return { ok: false, error: 'unknown op kind: ' + op.kind }
    }
  }
}

export const store = new StateStore()
