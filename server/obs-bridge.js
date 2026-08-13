/**
 * OBS Studio connector (obs-websocket 5.x).
 *
 * Reads live scene-item layout for the moderator canvas overlay, supports
 * visibility / scene switching, Program vs Preview (Studio Mode), and
 * low-rate source screenshots for the MJPEG preview panel.
 *
 * Config: OBS_HOST (default localhost:4455), OBS_PASSWORD.
 * Connection is user-driven via Settings / ObsSourcesPanel (obsEnabled).
 */

import './config/env.js'
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'
import { STAGE } from '../shared/schema.js'

const HOST = process.env.OBS_HOST || 'localhost:4455'
const PASSWORD = process.env.OBS_PASSWORD || ''
const SAFETY_POLL_MS = 8000
const RETRY_MS = 5000
const PATCH_COALESCE_MS = 40

/** Bitmask: everything useful + high-volume transform events. */
const SUBSCRIPTIONS =
  EventSubscription.All | EventSubscription.SceneItemTransformChanged

/**
 * Convert OBS sceneItemTransform → axis-aligned box in OBS canvas pixels,
 * plus rotation degrees for CSS overlay.
 */
export function transformToBox(t = {}) {
  const cropW = Math.max(0,
    (t.sourceWidth != null
      ? (t.sourceWidth - (t.cropLeft || 0) - (t.cropRight || 0))
      : (t.width || 0)))
  const cropH = Math.max(0,
    (t.sourceHeight != null
      ? (t.sourceHeight - (t.cropTop || 0) - (t.cropBottom || 0))
      : (t.height || 0)))
  const boundsType = t.boundsType || 'OBS_BOUNDS_NONE'
  let w, h
  if (boundsType && boundsType !== 'OBS_BOUNDS_NONE' && (t.boundsWidth || t.boundsHeight)) {
    w = Math.abs(t.boundsWidth || 0)
    h = Math.abs(t.boundsHeight || 0)
  } else {
    const baseW = t.width != null ? t.width : cropW
    const baseH = t.height != null ? t.height : cropH
    w = Math.abs((t.scaleX ?? 1) * baseW)
    h = Math.abs((t.scaleY ?? 1) * baseH)
  }
  const align = t.alignment ?? 5
  let x = t.positionX || 0
  let y = t.positionY || 0
  const left = !!(align & 1)
  const right = !!(align & 2)
  const top = !!(align & 4)
  const bottom = !!(align & 8)
  if (!left && !right) x -= w / 2
  else if (right) x -= w
  if (!top && !bottom) y -= h / 2
  else if (bottom) y -= h

  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    rotation: Number(t.rotation) || 0
  }
}

function scaleItemToStage(item, canvas) {
  const cw = canvas?.w || STAGE.W
  const ch = canvas?.h || STAGE.H
  const sx = STAGE.W / (cw || STAGE.W)
  const sy = STAGE.H / (ch || STAGE.H)
  return {
    ...item,
    x: Math.round(item.x * sx),
    y: Math.round(item.y * sy),
    w: Math.round(item.w * sx),
    h: Math.round(item.h * sy)
  }
}

class ObsBridge {
  constructor() {
    this.obs = new OBSWebSocket()
    this.connected = false
    this.started = false
    this.sources = []
    this.layoutRev = 0
    this.canvas = { w: STAGE.W, h: STAGE.H }
    this.programScene = ''
    this.previewScene = ''
    this.studioMode = false
    /** 'program' | 'preview' — which scene layout we track */
    this.layoutTarget = 'program'
    this.timer = null
    this._retry = null
    this._patchTimer = null
    this._pendingPatches = new Map()
    this._handlersBound = false
    this.onUpdate = null
    this.onSceneChange = null
    this.onLayoutPatch = null
  }

  start() {
    if (this.started) return
    this.started = true
    this._connect()
  }

  stop() {
    this.started = false
    if (this._retry) { clearTimeout(this._retry); this._retry = null }
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this._patchTimer) { clearTimeout(this._patchTimer); this._patchTimer = null }
    this._pendingPatches.clear()
    this.connected = false
    this.sources = []
    this.layoutRev++
    try { this.obs.disconnect() } catch (_) { /* already closed */ }
    this._emitFull()
  }

  async _connect() {
    if (!this.started) return
    try {
      await this.obs.connect(`ws://${HOST}`, PASSWORD, {
        eventSubscriptions: SUBSCRIPTIONS
      })
      this.connected = true
      console.log(`[obs-bridge] connected to OBS at ${HOST}`)
      this._bindEvents()
      await this._refreshCanvas()
      await this._pollFull()
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => this._pollFull(), SAFETY_POLL_MS)
    } catch (e) {
      this.connected = false
      if (this.started) this._scheduleRetry()
    }
  }

  _bindEvents() {
    if (this._handlersBound) return
    this._handlersBound = true

    this.obs.on('ConnectionClosed', () => {
      this.connected = false
      console.log('[obs-bridge] disconnected')
      if (this.timer) { clearInterval(this.timer); this.timer = null }
      this.sources = []
      this.layoutRev++
      this._emitFull()
      if (this.started) this._scheduleRetry()
    })

    this.obs.on('SceneItemTransformChanged', (ev) => {
      this._queueTransformPatch(ev)
    })

    this.obs.on('SceneItemEnableStateChanged', (ev) => {
      const id = ev.sceneItemId
      const src = this.sources.find((s) => s.id === id)
      if (src && this._sceneMatches(ev.sceneName)) {
        src.visible = !!ev.sceneItemEnabled
        this._queueUpsert(src)
      } else {
        this._pollFull()
      }
    })

    this.obs.on('SceneItemCreated', () => this._pollFull())
    this.obs.on('SceneItemRemoved', (ev) => {
      if (!this._sceneMatches(ev.sceneName)) return
      this.sources = this.sources.filter((s) => s.id !== ev.sceneItemId)
      this.layoutRev++
      if (this.onLayoutPatch) {
        this.onLayoutPatch({
          rev: this.layoutRev,
          removes: [ev.sceneItemId],
          upserts: [],
          scene: this._activeSceneName(),
          canvas: this.canvas,
          target: this.layoutTarget
        })
      }
      this._emitFull()
    })
    this.obs.on('SceneItemListReindexed', () => this._pollFull())

    this.obs.on('CurrentProgramSceneChanged', () => {
      console.log('[obs-bridge] program scene changed')
      this._pollFull()
      if (this.onSceneChange) this.onSceneChange()
    })
    this.obs.on('CurrentPreviewSceneChanged', () => {
      if (this.layoutTarget === 'preview') this._pollFull()
      else this._refreshSceneNames()
    })
    this.obs.on('StudioModeStateChanged', (ev) => {
      this.studioMode = !!ev.studioModeEnabled
      this._pollFull()
    })
  }

  _scheduleRetry() {
    if (this._retry || !this.started) return
    this._retry = setTimeout(() => { this._retry = null; this._connect() }, RETRY_MS)
  }

  _activeSceneName() {
    return this.layoutTarget === 'preview' && this.previewScene
      ? this.previewScene
      : this.programScene
  }

  _sceneMatches(name) {
    return name === this._activeSceneName()
  }

  async setLayoutTarget(target) {
    const next = target === 'preview' ? 'preview' : 'program'
    if (next === this.layoutTarget) return { ok: true, target: next }
    this.layoutTarget = next
    await this._pollFull()
    return { ok: true, target: this.layoutTarget }
  }

  async _refreshCanvas() {
    try {
      const v = await this.obs.call('GetVideoSettings')
      this.canvas = {
        w: Number(v.baseWidth) || STAGE.W,
        h: Number(v.baseHeight) || STAGE.H
      }
    } catch (_) {
      this.canvas = { w: STAGE.W, h: STAGE.H }
    }
  }

  async _refreshSceneNames() {
    try {
      const program = await this.obs.call('GetCurrentProgramScene')
      this.programScene = program?.currentProgramSceneName || ''
    } catch (_) { /* ignore */ }
    try {
      const st = await this.obs.call('GetStudioModeEnabled')
      this.studioMode = !!st?.studioModeEnabled
    } catch (_) {
      this.studioMode = false
    }
    if (this.studioMode) {
      try {
        const preview = await this.obs.call('GetCurrentPreviewScene')
        this.previewScene = preview?.currentPreviewSceneName || ''
      } catch (_) {
        this.previewScene = ''
      }
    } else {
      this.previewScene = ''
      if (this.layoutTarget === 'preview') this.layoutTarget = 'program'
    }
  }

  async _collectItems(sceneName, indexOffset = 0, parentGroupId = null) {
    if (!sceneName) return []
    let list
    try {
      list = await this.obs.call('GetSceneItemList', { sceneName })
    } catch (_) {
      return []
    }
    const raw = []
    const items = list.sceneItems || []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.sceneItemTransform) continue
      const box = transformToBox(it.sceneItemTransform)
      const entry = {
        id: it.sceneItemId,
        sourceUuid: it.sourceUuid || '',
        name: it.sourceName,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        rotation: box.rotation,
        visible: it.sceneItemEnabled !== false,
        locked: !!it.sceneItemLocked,
        index: indexOffset + i,
        scene: sceneName,
        kind: it.inputKind || it.sourceType || '',
        isGroup: !!it.isGroup,
        parentGroupId
      }
      raw.push(entry)
      if (it.isGroup) {
        try {
          const group = await this.obs.call('GetGroupSceneItemList', { sceneName: it.sourceName })
          const nested = group.sceneItems || []
          for (let j = 0; j < nested.length; j++) {
            const nit = nested[j]
            if (!nit.sceneItemTransform) continue
            const nbox = transformToBox(nit.sceneItemTransform)
            raw.push({
              id: nit.sceneItemId,
              sourceUuid: nit.sourceUuid || '',
              name: nit.sourceName,
              x: entry.x + nbox.x,
              y: entry.y + nbox.y,
              w: nbox.w,
              h: nbox.h,
              rotation: (entry.rotation || 0) + (nbox.rotation || 0),
              visible: entry.visible && nit.sceneItemEnabled !== false,
              locked: !!nit.sceneItemLocked,
              index: indexOffset + i + 0.01 * (j + 1),
              scene: sceneName,
              kind: nit.inputKind || nit.sourceType || '',
              isGroup: false,
              parentGroupId: it.sceneItemId
            })
          }
        } catch (_) { /* group expand failed */ }
      }
    }
    return raw.map((item) => scaleItemToStage(item, this.canvas))
  }

  async _pollFull() {
    if (!this.connected) return
    try {
      await this._refreshCanvas()
      await this._refreshSceneNames()
      const sceneName = this._activeSceneName()
      if (!sceneName) return
      this.sources = await this._collectItems(sceneName)
      this.layoutRev++
      this._emitFull()
    } catch (_) { /* transient */ }
  }

  _queueTransformPatch(ev) {
    if (!this._sceneMatches(ev.sceneName)) return
    const box = transformToBox(ev.sceneItemTransform || {})
    const existing = this.sources.find((s) => s.id === ev.sceneItemId)
    const scaled = scaleItemToStage({
      id: ev.sceneItemId,
      name: existing?.name || `#${ev.sceneItemId}`,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotation: box.rotation,
      visible: existing?.visible !== false,
      locked: existing?.locked || false,
      index: existing?.index ?? 0,
      scene: ev.sceneName,
      kind: existing?.kind || '',
      isGroup: existing?.isGroup || false,
      parentGroupId: existing?.parentGroupId ?? null,
      sourceUuid: existing?.sourceUuid || ''
    }, this.canvas)

    if (existing) Object.assign(existing, scaled)
    else this.sources.push(scaled)

    this._pendingPatches.set(scaled.id, scaled)
    if (this._patchTimer) return
    this._patchTimer = setTimeout(() => {
      this._patchTimer = null
      this._flushPatches()
    }, PATCH_COALESCE_MS)
  }

  _queueUpsert(item) {
    this._pendingPatches.set(item.id, item)
    if (this._patchTimer) return
    this._patchTimer = setTimeout(() => {
      this._patchTimer = null
      this._flushPatches()
    }, PATCH_COALESCE_MS)
  }

  _flushPatches() {
    if (!this._pendingPatches.size) return
    const upserts = [...this._pendingPatches.values()]
    this._pendingPatches.clear()
    this.layoutRev++
    if (this.onLayoutPatch) {
      this.onLayoutPatch({
        rev: this.layoutRev,
        upserts,
        removes: [],
        scene: this._activeSceneName(),
        canvas: this.canvas,
        target: this.layoutTarget,
        studioMode: this.studioMode,
        programScene: this.programScene,
        previewScene: this.previewScene
      })
    }
  }

  _emitFull() {
    if (this.onUpdate) this.onUpdate(this.sources)
  }

  snapshot() {
    return {
      connected: this.connected,
      host: HOST,
      sources: this.sources,
      layoutRev: this.layoutRev,
      canvas: this.canvas,
      target: this.layoutTarget,
      studioMode: this.studioMode,
      programScene: this.programScene,
      previewScene: this.previewScene
    }
  }

  layoutMessage(type = 'obs-layout') {
    const snap = this.snapshot()
    return {
      type,
      sources: snap.sources,
      obsConnected: snap.connected,
      rev: snap.layoutRev,
      canvas: snap.canvas,
      target: snap.target,
      studioMode: snap.studioMode,
      programScene: snap.programScene,
      previewScene: snap.previewScene
    }
  }

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
      await this._pollFull()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  async switchScene(sceneName) {
    if (!this.connected) return { ok: false, error: 'OBS not connected' }
    try {
      await this.obs.call('SetCurrentProgramScene', { sceneName })
      await this._pollFull()
      return { ok: true }
    } catch (e) {
      // Older builds used SwitchToProgramScene
      try {
        await this.obs.call('SwitchToProgramScene', { sceneName })
        await this._pollFull()
        return { ok: true }
      } catch (e2) {
        return { ok: false, error: e2.message || e.message }
      }
    }
  }

  async setPreviewScene(sceneName) {
    if (!this.connected) return { ok: false, error: 'OBS not connected' }
    try {
      await this.obs.call('SetCurrentPreviewScene', { sceneName })
      await this._pollFull()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  async listScenes() {
    if (!this.connected) return { scenes: [], studioMode: false }
    try {
      const res = await this.obs.call('GetSceneList')
      const current = res?.currentProgramSceneName
      const preview = res?.currentPreviewSceneName
      return {
        studioMode: this.studioMode,
        scenes: (res?.scenes || []).map((s) => ({
          name: s.sceneName,
          active: s.sceneName === current,
          preview: s.sceneName === preview
        }))
      }
    } catch (_) {
      return { scenes: [], studioMode: false }
    }
  }

  /**
   * JPEG screenshot of program or preview scene (or a named source).
   * Heavy — call sparingly (preview module gates subscribers).
   */
  async getScreenshot({ sourceName, width = 960, height, quality = 40 } = {}) {
    if (!this.connected) return { ok: false, error: 'OBS not connected' }
    await this._refreshSceneNames()
    const name = sourceName
      || (this.layoutTarget === 'preview' && this.previewScene
        ? this.previewScene
        : this.programScene)
    if (!name) return { ok: false, error: 'no scene' }
    const h = height || Math.round(width * ((this.canvas.h || 1080) / (this.canvas.w || 1920)))
    try {
      const res = await this.obs.call('GetSourceScreenshot', {
        sourceName: name,
        imageFormat: 'jpg',
        imageWidth: Math.max(160, Math.min(1920, Number(width) || 960)),
        imageHeight: Math.max(90, Math.min(1080, h)),
        imageCompressionQuality: Math.max(1, Math.min(100, Number(quality) || 40))
      })
      const dataUrl = res?.imageData || ''
      // imageData is often "data:image/jpeg;base64,...."
      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      return { ok: true, base64: b64, mime: 'image/jpeg', sourceName: name }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }
}

export const bridge = new ObsBridge()
