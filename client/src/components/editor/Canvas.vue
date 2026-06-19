<!--
  Canvas.vue (M1 + M2)
  The moderator's viewport onto the 1920x1080 stage. Renders the shared
  StageRenderer, then overlays editor-only chrome: selection box with 8 resize
  handles + a rotate handle, grid, safe-area, center crosshair, snap guides,
  rulers, and a minimap. Supports wheel-zoom and middle-mouse panning.

  All coordinates the moderator manipulates are logical stage px; the editor
  just scales them for display, so OBS (1:1) always matches.
-->
<template>
  <div
    class="canvas"
    :class="{ dragging: dragging }"
    ref="root"
    @mousedown="onCanvasMouseDown"
    @wheel.prevent="onWheel"
    @mousedown.middle.prevent="onPanStart"
  >
    <!-- Rulers (top + left), drawn in screen space -->
    <div v-if="s.showRulers" class="ruler ruler-h" :style="rulerHStyle"></div>
    <div v-if="s.showRulers" class="ruler ruler-v" :style="rulerVStyle"></div>

    <!-- Pannable/zoomable scroll area. The stage viewport sits inside. -->
    <div class="scroll" ref="scroll" :style="{ cursor: panning ? 'grabbing' : 'default' }">
      <div class="viewport" :style="viewportStyle">
        <div class="stage-frame" ref="frameEl" :style="frameStyle">
          <!-- Grid overlay -->
          <div v-if="s.gridEnabled" class="grid" :style="gridStyle"></div>
          <!-- Safe area (title-safe 90% + action-safe 95%) -->
          <template v-if="s.showSafeArea">
            <div class="safe action-safe"></div>
            <div class="safe title-safe"></div>
          </template>
          <!-- Center crosshair (snap target hint) -->
          <div v-if="s.snapToCenter" class="center-cross"></div>

          <!-- The shared renderer (transparent; pointer-events none) -->
          <StageRenderer
            :layers="scene.layers"
            mode="editor"
            :scale="1"
            :ttl-map="ttlMap"
            :media-ctrl="scene.mediaCtrl"
            @select="scene.select"
            @edit-text="startEditText"
            @fit-aspect="onFitAspect"
            @media-state="onMediaState"
            @audio-ctrl="onAudioCtrl"
          />

          <!-- Inline text editor (double-click on a text layer) -->
          <textarea
            v-if="editingText"
            ref="textEditor"
            class="inline-text-editor"
            :style="editTextStyle"
            :value="editingTextValue"
            @input="editingTextValue = $event.target.value"
            @blur="commitEditText"
            @keydown.enter.exact.prevent="commitEditText"
            @keydown.escape.prevent="cancelEditText"
          ></textarea>

          <!-- Native OBS source boundaries (editor-only overlay, toggled) -->
          <template v-if="s.showObsBounds && scene.obsSources.length">
            <div
              v-for="src in scene.obsSources"
              :key="'obs-' + src.name"
              class="obs-bound"
              :class="{ hidden: !src.visible }"
              :style="{ left: src.x + 'px', top: src.y + 'px', width: src.w + 'px', height: src.h + 'px' }"
            >
              <span class="obs-label">{{ src.name }}</span>
            </div>
          </template>
          <div v-else-if="s.showObsBounds && !scene.obsConnected" class="obs-hint">
            OBS not connected. Enable Tools → WebSocket Server in OBS (port 4455).
          </div>

          <!-- Active snap guide lines -->
          <div v-for="g in snapGuides" :key="g.id" class="guide" :style="g.style"></div>

          <!-- Selection box + handles -->
          <div v-if="selected" class="selection" :style="selStyle">
            <div class="sel-body" @mousedown.stop="onMoveStart" @dblclick.stop="onSelDblClick"></div>
            <!-- 8 resize handles -->
            <div
              v-for="h in handles"
              :key="h"
              class="handle"
              :class="'h-' + h"
              @mousedown.stop="onResizeStart(h, $event)"
            ></div>
            <!-- rotate handle -->
            <div class="handle rotate" @mousedown.stop="onRotateStart"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Zoom controls + minimap -->
    <div class="hud">
      <div class="zoom-ctrl">
        <button @click="zoomBy(1/1.2)">−</button>
        <span>{{ Math.round(scale * 100) }}%</span>
        <button @click="zoomBy(1.2)">+</button>
        <button @click="zoomFit" title="Fit">⤢</button>
      </div>
    </div>
    <Minimap v-if="showMinimap" :scale="scale" :scroll="scrollEl" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { STAGE } from '@shared/schema.js'
import StageRenderer from '../StageRenderer.vue'
import Minimap from './Minimap.vue'
import { resizeFree, resizeAspect } from '../../features/transforms.js'
import { snapMove } from '../../features/snap.js'

const scene = useSceneStore()
const root = ref(null)
const scroll = ref(null)
const scrollEl = computed(() => scroll.value)

const scale = ref(1)
const panning = ref(false)
// True while a layer is being moved/resized/rotated. Drives a grabbing cursor
// and the workspace's user-select:none guard so the browser never starts its
// native text-selection / image-drag highlight during a drag.
const dragging = ref(false)

const s = computed(() => scene.settings)
const selected = computed(() => scene.selected)
const showMinimap = computed(() => scale.value < 0.85)

// TTL countdown map (id -> seconds remaining) is owned by the store; we just
// pass it through to StageRenderer for the on-stage badges.
const ttlMap = computed(() => scene.ttlRemaining || {})

// --- inline text editing (double-click a text layer) -----------------------
const editingText = ref(false)       // is the inline editor open?
const editingTextId = ref(null)      // layer being edited
const editingTextValue = ref('')     // live buffer
const textEditor = ref(null)
const editTextStyle = computed(() => {
  const l = scene.layers.find((x) => x.id === editingTextId.value)
  if (!l) return { display: 'none' }
  const t = l.transform
  const tx = l.text || {}
  return {
    left: t.x + 'px',
    top: t.y + 'px',
    width: t.w + 'px',
    height: t.h + 'px',
    transform: `rotate(${t.rotation || 0}deg)`,
    transformOrigin: 'center center',
    fontFamily: tx.fontFamily || 'Arial, sans-serif',
    fontSize: (tx.fontSize || 48) + 'px',
    color: tx.fontColor || '#fff',
    fontWeight: tx.bold ? '700' : '400',
    fontStyle: tx.italic ? 'italic' : 'normal',
    textAlign: tx.textAlign || 'center',
    lineHeight: '1.2'
  }
})
function startEditText(id) {
  const l = scene.layers.find((x) => x.id === id)
  if (!l || l.type !== 'text') return
  editingTextId.value = id
  editingTextValue.value = l.text?.content || ''
  editingText.value = true
  nextTick(() => { textEditor.value?.focus(); textEditor.value?.select() })
}
function onSelDblClick() {
  const l = selected.value
  if (l?.type === 'text') startEditText(l.id)
}
function commitEditText() {
  if (!editingText.value) return
  const l = scene.layers.find((x) => x.id === editingTextId.value)
  if (l) scene.updateLayer(l.id, { text: { ...l.text, content: editingTextValue.value } })
  editingText.value = false
  editingTextId.value = null
}
function cancelEditText() {
  editingText.value = false
  editingTextId.value = null
}

// --- aspect-fit on first media load -----------------------------------------
// When an image/gif/video first loads its natural dimensions, snap the layer's
// box to the native aspect ratio so it is never squashed. Scaled to a sensible
// size on stage, centered on the box's current center. Fires once per layer.
function onFitAspect({ id, natW, natH }) {
  const l = scene.layers.find((x) => x.id === id)
  if (!l || l._aspectFit) return
  const t = l.transform
  const ratio = natW / natH
  // Target a box ~40% of stage width, capped so neither side dominates the
  // stage; tall media keys off height instead.
  const maxW = STAGE.W * 0.4
  const maxH = STAGE.H * 0.6
  let w = maxW
  let h = w / ratio
  if (h > maxH) { h = maxH; w = h * ratio }
  w = Math.round(w)
  h = Math.round(h)
  // Keep the box's current CENTER fixed so it doesn't jump around.
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  const x = Math.round(cx - w / 2)
  const y = Math.round(cy - h / 2)
  scene.updateLayer(id, {
    transform: { ...t, x, y, w, h },
    // Transient flag: prevent re-fitting after a manual resize. Not persisted
    // by the server (generic Object.assign keeps it for the session, which is
    // fine; a reload re-runs the fit harmlessly on a layer that already matches).
    _aspectFit: true
  })
}

// --- media transport plumbing ---------------------------------------------
// The renderer emits live readouts (current/duration/playing) for the editor's
// transport bars, and asks us to fan transport commands out to OBS. Both route
// through the store: mediaState is editor-local; sendMediaCtrl broadcasts.
function onMediaState({ id, ...partial }) {
  scene.setMediaState(id, partial)
}
function onAudioCtrl({ id, patch }) {
  scene.sendMediaCtrl(id, patch)
}

// --- sizing: fit stage into the scroll area --------------------------------
// Use ResizeObserver instead of onMounted + window.resize so zoomFit fires
// after CSS Grid finishes layout (prevents a square canvas when the 1fr
// track hasn't settled on first paint).
let resizeObs = null
onMounted(() => {
  if (scroll.value) {
    resizeObs = new ResizeObserver(() => zoomFit())
    resizeObs.observe(scroll.value)
  }
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  resizeObs?.disconnect()
  resizeObs = null
  window.removeEventListener('keydown', onKey)
})

// Shared zoom bounds so every entry point (Fit, +/- buttons, wheel) agrees.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
function clampZoom(v) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) }

function zoomFit() {
  const el = scroll.value
  if (!el) return
  const pad = 64
  const fit = Math.min((el.clientWidth - pad) / STAGE.W, (el.clientHeight - pad) / STAGE.H)
  scale.value = clampZoom(fit)
  centerStage()
}
function centerStage() {
  const el = scroll.value
  if (!el) return
  // With margin:auto centering on the viewport, the browser already centers
  // the stage when it fits. Reset scroll to 0 so that natural centering wins;
  // when zoomed in (content larger than scroll area), 0 scrolls from origin,
  // and middle-mouse panning reaches everything from there.
  el.scrollLeft = 0
  el.scrollTop = 0
}
function zoomBy(factor) {
  scale.value = clampZoom(scale.value * factor)
}
function onWheel(e) {
  // Ctrl/cmd+wheel zooms; plain wheel zooms too (common in design tools).
  zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
}

// --- panning with middle mouse ---------------------------------------------
function onPanStart(e) {
  panning.value = true
  const el = scroll.value
  const start = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
  const move = (ev) => { el.scrollLeft = start.sl - (ev.clientX - start.x); el.scrollTop = start.st - (ev.clientY - start.y) }
  const up = () => { panning.value = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// --- viewport / frame styles -----------------------------------------------
// Layout/scale invariant that keeps the stage truly centered:
//
// The frame is laid out at its NATIVE 1920x1080 and scaled with transform.
// To avoid the visible content drifting into the lower-right corner, the
// transform-origin is TOP LEFT so the scaled content's layout box coincides
// with its visible box. The viewport wraps the frame and is sized exactly to
// the scaled content + padding, then centered within the scroll area via
// `margin: auto`. That combination:
//   - centers the stage when zoomed out (viewport narrower than scroll → auto
//     margins push it to the middle), and
//   - becomes scrollable when zoomed in (viewport wider than scroll → margins
//     collapse to 0 and the content scrolls from its origin).
// Earlier this used `margin: auto` + `transform-origin: center center`, but
// the frame's 1920px layout box was wider than the scaled viewport, so the
// auto margins computed to 0 and the content pinned to the corner.
const VIEW_PAD = 24 // breathing room around the stage on all sides
const viewportStyle = computed(() => ({
  width: STAGE.W * scale.value + VIEW_PAD * 2 + 'px',
  height: STAGE.H * scale.value + VIEW_PAD * 2 + 'px'
}))
const frameStyle = computed(() => ({
  width: STAGE.W + 'px',
  height: STAGE.H + 'px',
  left: VIEW_PAD + 'px',
  top: VIEW_PAD + 'px',
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
  position: 'absolute'
}))
const gridStyle = computed(() => {
  const g = s.value.gridSize || 40
  return {
    backgroundImage: `linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)`,
    backgroundSize: `${g}px ${g}px`
  }
})

// Rulers: simple ticks in stage px along top/left, shown at current zoom.
const rulerHStyle = computed(() => ({ width: STAGE.W * scale.value + 'px' }))
const rulerVStyle = computed(() => ({ height: STAGE.H * scale.value + 'px' }))

const selStyle = computed(() => {
  const t = selected.value?.transform
  if (!t) return {}
  return {
    left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px',
    transform: `rotate(${t.rotation || 0}deg)`
  }
})

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// --- snap guide lines currently being shown --------------------------------
const snapGuides = ref([])
function clearGuides() { snapGuides.value = [] }

// --- MOVE ------------------------------------------------------------------
function onMoveStart(e) {
  const l = selected.value
  if (!l || l.locked) return
  // Prevent the browser from kicking off its native text-selection / image-drag
  // gesture on mousedown — that's what paints the Windows-style blue highlight
  // over content while dragging a layer. We drive the move ourselves.
  e.preventDefault()
  dragging.value = true
  const start = { sx: e.clientX, sy: e.clientY, ox: l.transform.x, oy: l.transform.y }
  const move = (ev) => {
    let dx = (ev.clientX - start.sx) / scale.value
    let dy = (ev.clientY - start.sy) / scale.value
    let nx = start.ox + dx
    let ny = start.oy + dy
    // Apply snapping; it returns adjusted coords + any guide lines to draw.
    const snapped = snapMove(nx, ny, l.transform.w, l.transform.h, s.value, scene.layers, l.id)
    snapGuides.value = snapped.guides
    scene.updateLayer(l.id, { transform: { ...l.transform, x: Math.round(snapped.x), y: Math.round(snapped.y) } })
  }
  const up = () => {
    dragging.value = false
    clearGuides()
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// --- RESIZE ----------------------------------------------------------------
function onResizeStart(handle, e) {
  const l = selected.value
  if (!l || l.locked) return
  e.preventDefault()
  dragging.value = true
  // Aspect-lock when shift is held OR the layer's maintainRatio flag is on
  // (default true for image/gif/video, so resizing keeps the native ratio).
  const aspectLock = e.shiftKey || (l.maintainRatio !== false && ['image', 'gif', 'video', 'emote'].includes(l.type))
  const start = { sx: e.clientX, sy: e.clientY, t: { ...l.transform } }
  const move = (ev) => {
    const dx = (ev.clientX - start.sx) / scale.value
    const dy = (ev.clientY - start.sy) / scale.value
    const nt = aspectLock
      ? resizeAspect(start.t, handle, dx, dy)
      : resizeFree(start.t, handle, dx, dy)
    scene.updateLayer(l.id, { transform: { ...l.transform, ...nt } })
  }
  const up = () => { dragging.value = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// --- ROTATE ----------------------------------------------------------------
// The selection box rotates around the layer's CENTER. We compute that center
// in screen (client) space from the stage-frame's bounding rect + the layer's
// logical position, then take the angle from the center to the mouse. The +90
// offset accounts for the rotate handle sitting directly ABOVE the box (12
// o'clock), where atan2 returns -90° — we want that to read as 0° rotation.
//
// Previously this used scroll.getBoundingClientRect() + a +20 fudge, which was
// only correct when the frame happened to sit flush at the scroll origin; with
// transform-origin: center center and a centered workspace, the pivot was off,
// so dragging left/right flipped the rotation direction. Using the frame's own
// rect makes the pivot exact regardless of pan/zoom.
const frameEl = ref(null)
function onRotateStart(e) {
  const l = selected.value
  if (!l || l.locked) return
  e.preventDefault()
  dragging.value = true
  const frame = frameEl.value?.getBoundingClientRect()
  if (!frame) return
  // Center of the layer in screen space. The frame's top-left corresponds to
  // stage coordinate (0,0); logical stage px are scaled by `scale`.
  const cxScreen = frame.left + (l.transform.x + l.transform.w / 2) * scale.value
  const cyScreen = frame.top + (l.transform.y + l.transform.h / 2) * scale.value
  const move = (ev) => {
    const ang = Math.atan2(ev.clientY - cyScreen, ev.clientX - cxScreen) * 180 / Math.PI
    // +90 so the handle (which points straight up) reads as 0° rotation.
    // Dragging the handle clockwise then increases the stored angle, matching
    // the visual (CSS rotate is clockwise-positive).
    let deg = ang + 90
    if (e.shiftKey) deg = Math.round(deg / 15) * 15
    scene.updateLayer(l.id, { transform: { ...l.transform, rotation: Math.round(deg) } })
  }
  const up = () => { dragging.value = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

function onCanvasMouseDown(e) {
  if (e.target === root.value || e.target.classList.contains('scroll') || e.target.classList.contains('viewport')) {
    scene.select(null)
  }
}

// --- keyboard: delete, arrows nudge, escape deselect -----------------------
function onKey(e) {
  const l = selected.value
  if (!l) return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowLeft') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, x: l.transform.x - step } }) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, x: l.transform.x + step } }) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, y: l.transform.y - step } }) }
  else if (e.key === 'ArrowDown') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, y: l.transform.y + step } }) }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); scene.deleteLayer(l.id) }
  else if (e.key === 'Escape') { scene.select(null) }
}

// Re-fit when the panel is first shown.
watch(() => scene.selectedId, () => clearGuides())
</script>

<style scoped>
.canvas {
  position: relative;
  flex: 1;
  background: var(--bg);
  overflow: hidden;
  display: flex;
  /* The workspace never hosts selectable text — labels are display-only. This
     keeps stray drags from painting a blue text-selection highlight over the
     stage. The inline text editor re-enables selection on itself below. */
  user-select: none;
  -webkit-user-select: none;
}
/* While a layer drag is in flight: lock the cursor and hard-disable native
   selection/image-drag across the whole canvas so no highlight can appear. */
.canvas.dragging,
.canvas.dragging * {
  cursor: grabbing !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
.scroll {
  position: relative;
  flex: 1;
  overflow: auto;
  /* display:flex + margin:auto on the viewport is the SAFE way to center a
     scrollable child: when the child fits, the auto margins absorb the slack
     and center it; when it overflows, the auto margins collapse to 0 and the
     content scrolls from its origin (no unreachable negative offset, which is
     the trap that justify/align-content:center falls into). */
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  /* Hide native scrollbars: panning is done via middle-mouse + wheel-zoom,
     so the chrome bars only clutter the editor. Scroll still works. */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
.viewport {
  position: relative;
  /* margin:auto inside a flex (.scroll) parent centers the stage on BOTH axes
     when it fits, and collapses to 0 when zoomed in so panning reaches all. */
  margin: auto;
}
.stage-frame {
  background: #000;
  outline: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.grid { position: absolute; inset: 0; pointer-events: none; }
.safe { position: absolute; border: 1px dashed rgba(255,235,59,.5); pointer-events: none; }
.action-safe { inset: 2.5%; }
.title-safe { inset: 5%; border-color: rgba(255,235,59,.8); }
.center-cross {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px;
  transform: translate(-50%,-50%); pointer-events: none;
  background:
    linear-gradient(rgba(255,255,255,.3), rgba(255,255,255,.3)) center/100% 1px no-repeat,
    linear-gradient(90deg, rgba(255,255,255,.3), rgba(255,255,255,.3)) center/1px 100% no-repeat;
}
.selection {
  position: absolute;
  pointer-events: auto;
  outline: 1.5px solid var(--accent);
  box-shadow: 0 0 0 1px rgba(0,0,0,.5);
}
.sel-body { position: absolute; inset: 0; cursor: grab; }
.sel-body:active { cursor: grabbing; }
.handle {
  position: absolute;
  width: 10px; height: 10px;
  background: #fff;
  border: 1.5px solid var(--accent);
  border-radius: 2px;
  z-index: 2;
}
.handle.h-nw { left: -5px; top: -5px; cursor: nwse-resize; }
.handle.h-n  { left: 50%; top: -5px; margin-left: -5px; cursor: ns-resize; }
.handle.h-ne { right: -5px; top: -5px; cursor: nesw-resize; }
.handle.h-e  { right: -5px; top: 50%; margin-top: -5px; cursor: ew-resize; }
.handle.h-se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.handle.h-s  { left: 50%; bottom: -5px; margin-left: -5px; cursor: ns-resize; }
.handle.h-sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.handle.h-w  { left: -5px; top: 50%; margin-top: -5px; cursor: ew-resize; }
.handle.rotate { left: 50%; top: -26px; margin-left: -7px; width: 14px; height: 14px; border-radius: 50%; cursor: grab; }
.guide { position: absolute; background: #ff4dff; pointer-events: none; z-index: 5; }
.guide.v { width: 1px; top: 0; bottom: 0; }
.guide.h { height: 1px; left: 0; right: 0; }
.obs-bound {
  position: absolute;
  border: 1.5px dashed rgba(255, 165, 0, .9);
  background: rgba(255, 165, 0, .08);
  pointer-events: none;
  z-index: 4;
}
.obs-bound.hidden { border-style: dotted; opacity: .4; }
.obs-label {
  position: absolute; top: 2px; left: 4px;
  font-size: 10px; color: #ffb74d;
  background: rgba(0,0,0,.6); padding: 1px 4px; border-radius: 2px;
  white-space: nowrap;
}
.obs-hint {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(255,165,0,.9); color: #000;
  font-size: 11px; padding: 4px 10px; border-radius: 4px;
  z-index: 6; pointer-events: none;
}
.ruler { position: absolute; background: var(--bg-2); border: 1px solid var(--border); z-index: 10; opacity: .8; pointer-events: none; }
.ruler-h { top: 0; left: 0; height: 14px; }
.ruler-v { top: 0; left: 0; width: 14px; }
.hud { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; }
.zoom-ctrl {
  display: flex; align-items: center; gap: 4px;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 4px 8px; font-size: 12px;
}
.zoom-ctrl button { padding: 2px 8px; }
.inline-text-editor {
  position: absolute;
  z-index: 50;
  background: rgba(59, 130, 246, 0.12);
  border: 2px solid var(--accent);
  border-radius: 4px;
  padding: 0 8px;
  box-sizing: border-box;
  resize: none;
  outline: none;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  /* Re-enable selection inside the editor — the workspace disables it to kill
     the drag-highlight, but real text editing needs it back here. */
  user-select: text;
  -webkit-user-select: text;
}
</style>
