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
    id="editor-canvas"
    class="canvas"
    :class="{ dragging: dragging, panning: panning, 'space-ready': spaceHeld }"
    ref="root"
    tabindex="-1"
    role="application"
    aria-label="Scene canvas"
    @mousedown.capture="onCanvasMouseDownCapture"
    @mousedown="onCanvasMouseDown"
    @mousemove="onCanvasPointerMove"
    @wheel.prevent="onWheel"
    @mousedown.middle.prevent="onPanStart"
    @auxclick.middle.prevent
  >
    <!-- Rulers in logical stage px, origin = scene (0,0) -->
    <template v-if="s.showRulers">
      <div class="ruler ruler-h" :style="rulerHBoxStyle">
        <span
          v-for="tk in rulerHTicks"
          :key="'rh-' + tk.px"
          class="ruler-tick"
          :class="{ major: tk.major }"
          :style="{ left: tk.px * scale + 'px' }"
        >
          <span v-if="tk.major" class="ruler-lbl">{{ tk.px }}</span>
        </span>
        <div class="ruler-cursor" :style="{ left: cursorStage.x * scale + 'px' }"></div>
      </div>
      <div class="ruler ruler-v" :style="rulerVBoxStyle">
        <span
          v-for="tk in rulerVTicks"
          :key="'rv-' + tk.px"
          class="ruler-tick"
          :class="{ major: tk.major }"
          :style="{ top: tk.px * scale + 'px' }"
        >
          <span v-if="tk.major" class="ruler-lbl">{{ tk.px }}</span>
        </span>
        <div class="ruler-cursor v" :style="{ top: cursorStage.y * scale + 'px' }"></div>
      </div>
      <div class="ruler-corner" aria-hidden="true"></div>
    </template>

    <!-- Pannable/zoomable scroll area. The stage viewport sits inside. -->
    <div class="scroll" ref="scroll" :class="{ 'is-fitted': contentFits }" :style="{ cursor: panning ? 'grabbing' : 'default' }">
      <div class="viewport" :style="viewportStyle">
          <ContextMenu :open="emptyMenuOpen" @update:open="onEmptyMenuOpenChange">
            <ContextMenuTrigger as-child>
              <div class="workspace-frame" :style="frameStyle">
                <!-- Translucent grey veil outside the 1920×1080 stage (pointer-events none) -->
                <div class="stage-veil stage-veil-t" :style="veilTopStyle" aria-hidden="true"></div>
                <div class="stage-veil stage-veil-b" :style="veilBottomStyle" aria-hidden="true"></div>
                <div class="stage-veil stage-veil-l" :style="veilLeftStyle" aria-hidden="true"></div>
                <div class="stage-veil stage-veil-r" :style="veilRightStyle" aria-hidden="true"></div>

                <!-- Solid stage screen -->
                <div class="stage-bg" :style="stageBgStyle" aria-hidden="true"></div>

                <!-- Stage content in logical 0..1920 / 0..1080 coords (overflow visible).
                     ref=frameEl is the stage origin for rotate pivot math. -->
                <div class="stage-content" ref="frameEl" :style="stageContentStyle">
          <!-- Grid overlay -->
          <div v-if="s.gridEnabled" class="grid" :style="gridStyle"></div>
          <!-- Safe area (title-safe 90% + action-safe 95%) -->
          <template v-if="s.showSafeArea">
            <div class="safe action-safe"></div>
            <div class="safe title-safe"></div>
          </template>
          <!-- Center crosshair (snap target hint) -->
          <div v-if="s.snapToCenter" class="center-cross"></div>

          <StageRenderer
            :layers="scene.orderedLayers"
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
            <ContextMenu v-for="src in clippedObsSources" :key="'obs-' + (src.id || src.name)">
              <ContextMenuTrigger as-child>
                <div
                  class="obs-bound"
                  :class="{
                    hidden: !src.visible,
                    selected: scene.obsSelectedId === src.id,
                    group: !!src.isGroup
                  }"
                  :style="obsBoundStyle(src)"
                  @mousedown.stop.prevent="onObsBoundClick(src)"
                >
                  <span class="obs-label">{{ src.name }}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem @select="onObsBoundClick(src)">
                  {{ t('ctx.selectSource') }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </template>
          <div v-else-if="s.showObsBounds && !scene.obsConnected" class="obs-hint">
            OBS not connected. Enable Tools → WebSocket Server in OBS (port 4455).
          </div>

          <!-- Active snap guide lines -->
          <div
            v-for="g in snapGuides"
            :key="g.id"
            class="guide"
            :class="g.style?.width === '1px' || g.style?.class === 'v' ? 'guide-v' : 'guide-h'"
            :style="g.style"
          ></div>

          <!-- Distance labels between the selected layer and its neighbors -->
          <div
            v-for="(lbl, i) in distLabels"
            :key="'dist-' + i"
            class="dist-label"
            :style="{ left: lbl.x + 'px', top: lbl.y + 'px' }"
          >{{ lbl.text }}</div>

          <!-- Edge pixel distances (View → By pixels) -->
          <template v-if="s.showEdgePixels && selected">
            <div
              v-for="(lbl, i) in edgePixelLabels"
              :key="'edge-' + i"
              class="edge-px-label"
              :class="lbl.cls"
              :style="{ left: lbl.x + 'px', top: lbl.y + 'px' }"
            >{{ lbl.text }}</div>
          </template>

          <!-- Audience visibility frames (dim when idle, bright when selected) -->
          <div
            v-for="layer in audienceOutlines"
            :key="'aud-' + layer.id"
            class="audience-outline"
            :class="layer.audienceVisible ? 'audience-on' : 'audience-off'"
            :style="audienceBoxStyle(layer)"
            aria-hidden="true"
          ></div>

          <!-- Selection box + Fluent handles -->
          <LayerContextMenu v-if="selected" :layer="selected" :on-fit-aspect="menuFitSelected">
            <div
              class="selection"
              :class="selected.audienceVisible ? 'audience-on' : 'audience-off'"
              :style="selStyle"
              aria-hidden="true"
            >
              <div class="sel-body" @mousedown.stop="onMoveStart" @dblclick.stop="onSelDblClick"></div>
              <div
                v-for="h in handles"
                :key="h"
                class="handle"
                :class="'h-' + h"
                @mousedown.stop="onResizeStart(h, $event)"
              ></div>
              <div class="rotate-stem" aria-hidden="true"></div>
              <div class="handle rotate" title="Rotate" @mousedown.stop="onRotateStart"></div>
              <div class="sel-badge sel-name">{{ selected.name }}</div>
              <div v-if="dragging && transformKind" class="sel-badge sel-metrics">{{ selMetricsText }}</div>
            </div>
          </LayerContextMenu>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="onCanvasPaste">
                <ClipboardPaste /> {{ t('ctx.paste') }}
              </ContextMenuItem>
              <ContextMenuItem @select="onCanvasAddText">
                <Type /> {{ t('ctx.addText') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @select="zoomFit">
                <Maximize2 /> {{ t('ctx.fitView') }}
              </ContextMenuItem>
              <ContextMenuItem @select="toggleGrid">
                <Grid3x3 /> {{ t('ctx.toggleGrid') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <div
            v-for="h in offstageHatchesScreen"
            :key="h.id"
            class="offstage-hatch-layer"
            :style="{ left: h.left + 'px', top: h.top + 'px', width: h.width + 'px', height: h.height + 'px' }"
            aria-hidden="true"
          ></div>
      </div>
    </div>
    <!-- Screen-space hatch over the whole editor scrollport, hole = 1920×1080 stage. -->
    <div
      v-if="showOffstageHatch"
      class="offstage-hatch-screen"
      :style="hatchOverlayStyle"
      aria-hidden="true"
    ></div>

    <!-- Zoom controls + minimap -->
    <div class="hud" role="toolbar" :aria-label="t('canvas.zoom')">
      <div class="zoom-ctrl">
        <button type="button" @click="zoomBy(1/1.2)" :aria-label="t('canvas.zoomOut')">−</button>
        <button
          v-if="!zoomEditing"
          type="button"
          class="zoom-pct"
          :aria-label="t('canvas.zoom')"
          @click="startZoomEdit"
        >{{ Math.round(scale * 100) }}%</button>
        <input
          v-else
          ref="zoomInputEl"
          class="zoom-pct-input"
          v-model="zoomInput"
          inputmode="numeric"
          @keydown.enter.prevent="commitZoomInput"
          @keydown.escape.prevent="cancelZoomEdit"
          @blur="commitZoomInput"
        />
        <button type="button" @click="zoomBy(1.2)" :aria-label="t('canvas.zoomIn')">+</button>
        <button type="button" @click="zoom100" :title="t('canvas.zoom100')" :aria-label="t('canvas.zoom100')">100%</button>
        <button type="button" @click="zoomFit" :title="t('ctx.fitView')" :aria-label="t('ctx.fitView')">{{ t('canvas.fit') }}</button>
      </div>
      <span v-if="showPanHint" class="hud-hint muted">{{ t('canvas.mmbPan') }}</span>
    </div>
    <Minimap v-if="showMinimap" :scale="scale" :scroll="scrollEl" :stage-margin="STAGE_MARGIN" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, inject } from 'vue'
import { ClipboardPaste, Type, Maximize2, Grid3x3 } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { STAGE } from '@shared/schema.js'
import StageRenderer from '../StageRenderer.vue'
import Minimap from './Minimap.vue'
import LayerContextMenu from '@/components/shell/LayerContextMenu.vue'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator
} from '@/components/ui/context-menu'
import { resizeFree, resizeAspect } from '../../features/transforms.js'
import { snapMove, distanceLabels } from '../../features/snap.js'
import { isPrimaryButton, useSafeContextMenu } from '@/features/safeContextMenu.js'
import { useI18n } from '@/i18n'

const scene = useSceneStore()
const { t } = useI18n()
const dnd = inject('dnd', null)
const root = ref(null)
const scroll = ref(null)
const hatchOverlayStyle = ref({})
const scrollEl = computed(() => scroll.value)

const scale = ref(1)
const fitScale = ref(1)
const panning = ref(false)
const spaceHeld = ref(false)
const transformKind = ref(null) // 'move' | 'resize' | 'rotate' | null
const cursorStage = ref({ x: 0, y: 0 })
const rulerTick = ref(0)
const zoomEditing = ref(false)
const zoomInput = ref('')
const zoomInputEl = ref(null)
const frameEl = ref(null)
const PAN_HINT_KEY = 'omo_canvas_pan_hint_hidden'
const showPanHint = ref(true)
try { showPanHint.value = sessionStorage.getItem(PAN_HINT_KEY) !== '1' } catch { /* ignore */ }
// True while a layer is being moved/resized/rotated. Drives a grabbing cursor
// and the workspace's user-select:none guard so the browser never starts its
// native text-selection / image-drag highlight during a drag.
const dragging = ref(false)
const emptyMenuOpen = ref(false)
const { onOpenChange: safeEmptyMenuOpen } = useSafeContextMenu({ dragging, panning })

const s = computed(() => scene.settings)
const selected = computed(() => scene.selected)
const showOffstageHatch = computed(() => s.value.showOffstageHatch !== false)
const scrollSize = ref({ w: 0, h: 0 })
const contentFits = computed(() => (
  workspaceW * scale.value <= scrollSize.value.w &&
  workspaceH * scale.value <= scrollSize.value.h
))
/** Minimap when zoomed in past fit (stage no longer fully in view). */
const showMinimap = computed(() => scale.value > fitScale.value * 1.02)

/** Clamp OBS bound rects to the logical stage so overlays never paint outside. */
const clippedObsSources = computed(() => {
  return (scene.obsSources || []).map((src) => {
    let x = Number(src.x) || 0
    let y = Number(src.y) || 0
    let w = Math.max(0, Number(src.w) || 0)
    let h = Math.max(0, Number(src.h) || 0)
    // Soft-clamp: keep label visible even if partially off-canvas
    if (x + w < 0 || y + h < 0 || x > STAGE.W || y > STAGE.H) {
      return { ...src, x, y, w: 0, h: 0 }
    }
    return { ...src, x: Math.round(x), y: Math.round(y), w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) }
  }).filter((s) => s.w > 0 && s.h > 0)
})

function obsBoundStyle(src) {
  const rot = Number(src.rotation) || 0
  return {
    left: src.x + 'px',
    top: src.y + 'px',
    width: src.w + 'px',
    height: src.h + 'px',
    transform: rot ? `rotate(${rot}deg)` : undefined,
    transformOrigin: 'center center',
    zIndex: 20 + Math.round((src.index || 0) * 10)
  }
}

function onObsBoundClick(src) {
  scene.selectObsSource(src.id)
  // Open OBS panel if closed so the matching row is obvious
  // (panel open is owned by EditorView — emit via custom event)
  window.dispatchEvent(new CustomEvent('omo-obs-select', { detail: { id: src.id, name: src.name } }))
}

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
function onFitAspect({ id, natW, natH, force }) {
  if (natW && natH) lastNat.set(id, { w: natW, h: natH })
  const l = scene.layers.find((x) => x.id === id)
  if (!l || (l._aspectFit && !force)) return
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

const lastNat = new Map()

function menuFitSelected(layer) {
  if (!layer?.id) return
  const n = lastNat.get(layer.id)
  if (!n?.w || !n?.h) return
  onFitAspect({ id: layer.id, natW: n.w, natH: n.h, force: true })
}

function onEmptyMenuOpenChange(open) {
  safeEmptyMenuOpen(open, (v) => { emptyMenuOpen.value = v })
}

async function onCanvasPaste() {
  try {
    const text = (await navigator.clipboard.readText())?.trim()
    if (text && dnd?.addUrl) dnd.addUrl(text)
  } catch (_) { /* permission / empty */ }
}

async function onCanvasAddText() {
  await scene.addLayer({ type: 'text' })
}

function toggleGrid() {
  scene.updateSettings({ gridEnabled: !s.value.gridEnabled })
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
// ResizeObserver updates fitScale for the minimap. It only auto-fits once
// on first layout so later panel resizes don't steal the user's zoom.
let resizeObs = null
let didInitialFit = false
let onScrollRulers = null
onMounted(() => {
  if (scroll.value) {
    resizeObs = new ResizeObserver(() => {
      updateFitScale()
      const el = scroll.value
      if (!didInitialFit && el && el.clientWidth > 32 && el.clientHeight > 32) {
        didInitialFit = true
        zoomFit()
      }
      rulerTick.value++
    })
    resizeObs.observe(scroll.value)
    onScrollRulers = () => { rulerTick.value++ }
    scroll.value.addEventListener('scroll', onScrollRulers, { passive: true })
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  nextTick(() => updateHatchOverlay())
})
onBeforeUnmount(() => {
  resizeObs?.disconnect()
  resizeObs = null
  scroll.value?.removeEventListener?.('scroll', onScrollRulers)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

// Shared zoom bounds so every entry point (Fit, +/- buttons, wheel) agrees.
const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
function clampZoom(v) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) }

function updateFitScale() {
  const el = scroll.value
  if (!el) return
  const pad = 64
  const fit = Math.min((el.clientWidth - pad) / STAGE.W, (el.clientHeight - pad) / STAGE.H)
  fitScale.value = clampZoom(fit)
  scrollSize.value = { w: el.clientWidth, h: el.clientHeight }
}

function updateHatchOverlay() {
  const scrollNode = scroll.value
  const canvas = root.value
  const stage = frameEl.value
  if (!scrollNode || !canvas) return
  const cr = canvas.getBoundingClientRect()
  const sr = scrollNode.getBoundingClientRect()
  const left = sr.left - cr.left
  const top = sr.top - cr.top
  let clipPath = 'none'
  if (stage) {
    const br = stage.getBoundingClientRect()
    const x = br.left - sr.left
    const y = br.top - sr.top
    const w = br.width
    const h = br.height
    const ow = sr.width
    const oh = sr.height
    // Two closed subpaths: full scrollport minus the 1920×1080 stage.
    clipPath = `path(evenodd, "M0,0 H${ow} V${oh} H0 Z M${x},${y} H${x + w} V${y + h} H${x} Z")`
  }
  hatchOverlayStyle.value = {
    left: left + 'px',
    top: top + 'px',
    width: Math.round(sr.width) + 'px',
    height: Math.round(sr.height) + 'px',
    clipPath
  }
}

watch([scale, scrollSize, showOffstageHatch], () => {
  nextTick(() => updateHatchOverlay())
})
watch(rulerTick, () => {
  nextTick(() => updateHatchOverlay())
})

async function zoomFit() {
  updateFitScale()
  scale.value = fitScale.value
  // Wait for viewport CSS size to match the new scale before scrolling —
  // otherwise scrollLeft/Top are applied against the old content box and the
  // stage jumps to the top-left until a second Fit.
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))
  centerStage()
}
function centerStage() {
  const el = scroll.value
  if (!el) return
  const vw = workspaceW * scale.value
  const vh = workspaceH * scale.value
  // When the whole workspace fits, flex margin:auto centers it — keep scroll at 0.
  if (vw <= el.clientWidth && vh <= el.clientHeight) {
    el.scrollLeft = 0
    el.scrollTop = 0
    return
  }
  // Center the 1920×1080 stage rect in the scrollport (margin stays reachable by pan).
  const stageX = STAGE_MARGIN * scale.value
  const stageY = STAGE_MARGIN * scale.value
  const stageW = STAGE.W * scale.value
  const stageH = STAGE.H * scale.value
  el.scrollLeft = Math.max(0, stageX - (el.clientWidth - stageW) / 2)
  el.scrollTop = Math.max(0, stageY - (el.clientHeight - stageH) / 2)
}

/** Offset of workspace origin inside the scrollport when margin:auto is centering. */
function workspaceOriginPad(el, s) {
  const w = workspaceW * s
  const h = workspaceH * s
  return {
    ox: Math.max(0, (el.clientWidth - w) / 2),
    oy: Math.max(0, (el.clientHeight - h) / 2)
  }
}

/**
 * Zoom while keeping a screen point fixed over the same workspace coordinate.
 * Pass clientX/Y for cursor-anchored zoom; omit for viewport-center anchor.
 */
async function zoomAt(factor, clientX, clientY) {
  const el = scroll.value
  if (!el) return
  const oldScale = scale.value
  const newScale = clampZoom(oldScale * factor)
  if (Math.abs(newScale - oldScale) < 1e-9) return

  const rect = el.getBoundingClientRect()
  const ax = clientX != null ? clientX - rect.left : el.clientWidth / 2
  const ay = clientY != null ? clientY - rect.top : el.clientHeight / 2

  const { ox, oy } = workspaceOriginPad(el, oldScale)
  const worldX = (el.scrollLeft + ax - ox) / oldScale
  const worldY = (el.scrollTop + ay - oy) / oldScale

  scale.value = newScale
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))

  const zoomingOut = newScale < oldScale
  const stageW = STAGE.W * newScale
  const stageH = STAGE.H * newScale
  if (zoomingOut && stageW <= el.clientWidth && stageH <= el.clientHeight) {
    centerStage()
    return
  }

  const newW = workspaceW * newScale
  const newH = workspaceH * newScale
  if (newW <= el.clientWidth && newH <= el.clientHeight) {
    el.scrollLeft = 0
    el.scrollTop = 0
    return
  }

  const { ox: ox2, oy: oy2 } = workspaceOriginPad(el, newScale)
  el.scrollLeft = Math.max(0, worldX * newScale - ax + ox2)
  el.scrollTop = Math.max(0, worldY * newScale - ay + oy2)
}

function zoomBy(factor) {
  // HUD +/- : zoom toward viewport center; zooming out recenters the stage.
  zoomAt(factor, null, null).then(() => {
    if (factor < 1) centerStage()
  })
}
function onWheel(e) {
  zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY)
}
async function zoom100() {
  scale.value = clampZoom(1)
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r))
  centerStage()
}
function startZoomEdit() {
  zoomInput.value = String(Math.round(scale.value * 100))
  zoomEditing.value = true
  nextTick(() => { zoomInputEl.value?.focus(); zoomInputEl.value?.select() })
}
function cancelZoomEdit() { zoomEditing.value = false }
async function commitZoomInput() {
  if (!zoomEditing.value) return
  zoomEditing.value = false
  const n = parseFloat(String(zoomInput.value).replace(',', '.').replace('%', ''))
  if (!Number.isFinite(n)) return
  const target = clampZoom(n / 100)
  const old = scale.value
  if (Math.abs(target - old) < 1e-9) return
  await zoomAt(target / old, null, null)
}

function markPanUsed() {
  if (!showPanHint.value) return
  showPanHint.value = false
  try { sessionStorage.setItem(PAN_HINT_KEY, '1') } catch { /* ignore */ }
}

// --- panning: middle mouse or Space+LMB ------------------------------------
function beginPan(e) {
  e.preventDefault()
  const el = scroll.value
  if (!el) return
  panning.value = true
  markPanUsed()
  const start = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
  const move = (ev) => {
    el.scrollLeft = start.sl - (ev.clientX - start.x)
    el.scrollTop = start.st - (ev.clientY - start.y)
  }
  const up = () => {
    panning.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
function onPanStart(e) {
  if (e.button !== 1) return
  beginPan(e)
}
function onCanvasMouseDownCapture(e) {
  if (spaceHeld.value && isPrimaryButton(e)) {
    e.stopPropagation()
    beginPan(e)
  }
}

// --- viewport / workspace styles -------------------------------------------
// Expanded workspace around the 1920×1080 stage so off-stage layers stay
// visible and draggable. STAGE_MARGIN is in logical stage pixels.
const STAGE_MARGIN = 480
const workspaceW = STAGE.W + STAGE_MARGIN * 2
const workspaceH = STAGE.H + STAGE_MARGIN * 2

const viewportStyle = computed(() => ({
  width: workspaceW * scale.value + 'px',
  height: workspaceH * scale.value + 'px'
}))
const frameStyle = computed(() => {
  const s = scale.value || 1
  return {
    width: workspaceW + 'px',
    height: workspaceH + 'px',
    left: '0px',
    top: '0px',
    transform: `scale(${s})`,
    transformOrigin: 'top left',
    position: 'absolute'
  }
})
const stageBgStyle = computed(() => ({
  left: STAGE_MARGIN + 'px',
  top: STAGE_MARGIN + 'px',
  width: STAGE.W + 'px',
  height: STAGE.H + 'px'
}))
const stageContentStyle = computed(() => {
  // Counter-scale editor chrome so it stays usable on screen:
  // zoom out → larger handles/labels, zoom in → cap so they don't explode.
  const s = scale.value || 1
  const inv = Math.min(3.5, Math.max(0.35, 1 / s))
  const handleInv = Math.min(10, Math.max(0.65, 1 / s))
  return {
    left: STAGE_MARGIN + 'px',
    top: STAGE_MARGIN + 'px',
    width: STAGE.W + 'px',
    height: STAGE.H + 'px',
    '--chrome-inv': String(inv),
    '--handle-inv': String(handleInv)
  }
})
const veilTopStyle = computed(() => ({
  left: '0px', top: '0px', width: workspaceW + 'px', height: STAGE_MARGIN + 'px'
}))
const veilBottomStyle = computed(() => ({
  left: '0px', top: (STAGE_MARGIN + STAGE.H) + 'px', width: workspaceW + 'px', height: STAGE_MARGIN + 'px'
}))
const veilLeftStyle = computed(() => ({
  left: '0px', top: STAGE_MARGIN + 'px', width: STAGE_MARGIN + 'px', height: STAGE.H + 'px'
}))
const veilRightStyle = computed(() => ({
  left: (STAGE_MARGIN + STAGE.W) + 'px', top: STAGE_MARGIN + 'px', width: STAGE_MARGIN + 'px', height: STAGE.H + 'px'
}))
const gridStyle = computed(() => {
  const g = s.value.gridSize || 40
  return {
    backgroundImage: `linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)`,
    backgroundSize: `${g}px ${g}px`
  }
})

// Rulers: simple ticks in stage px along top/left, shown at current zoom.
const rulerOrigin = computed(() => {
  void rulerTick.value
  void scale.value
  const canvas = root.value
  const frame = frameEl.value
  if (!canvas || !frame) return { x: 20, y: 20 }
  const cr = canvas.getBoundingClientRect()
  const fr = frame.getBoundingClientRect()
  return { x: fr.left - cr.left, y: fr.top - cr.top }
})
const rulerHBoxStyle = computed(() => ({
  left: rulerOrigin.value.x + 'px',
  width: STAGE.W * scale.value + 'px'
}))
const rulerVBoxStyle = computed(() => ({
  top: rulerOrigin.value.y + 'px',
  height: STAGE.H * scale.value + 'px'
}))
function rulerStep(s) {
  if (s < 0.35) return 200
  if (s < 0.7) return 100
  if (s < 1.4) return 50
  return 25
}
function ticksAlong(max, step) {
  const ticks = []
  for (let px = 0; px <= max + 0.5; px += step) {
    ticks.push({ px, major: px % (step * 2) === 0 || px === 0 })
  }
  return ticks
}
const rulerHTicks = computed(() => ticksAlong(STAGE.W, rulerStep(scale.value)))
const rulerVTicks = computed(() => ticksAlong(STAGE.H, rulerStep(scale.value)))

const selStyle = computed(() => {
  const t = selected.value?.transform
  if (!t) return {}
  return {
    left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px',
    transform: `rotate(${t.rotation || 0}deg)`
  }
})

function audienceBoxStyle(layer) {
  const t = layer?.transform
  if (!t) return {}
  return {
    left: t.x + 'px',
    top: t.y + 'px',
    width: t.w + 'px',
    height: t.h + 'px',
    transform: `rotate(${t.rotation || 0}deg)`
  }
}

const audienceOutlines = computed(() => {
  const selId = selected.value?.id
  return (scene.orderedLayers || []).filter((layer) => (
    layer.visible !== false &&
    layer.id !== selId &&
    layer.transform
  ))
})

/** AABB ∩ outside-stage strips for hatch overlays. */
function offstageStrips(t, id) {
  if (!t) return []
  const L = t.x
  const T = t.y
  const R = t.x + t.w
  const B = t.y + t.h
  const out = []
  if (L < 0 && R > L) {
    const w = Math.min(R, 0) - L
    if (w > 0.5) out.push({ id: id + '-L', x: L, y: T, w, h: B - T })
  }
  if (R > STAGE.W) {
    const x = Math.max(L, STAGE.W)
    const w = R - x
    if (w > 0.5) out.push({ id: id + '-R', x, y: T, w, h: B - T })
  }
  if (T < 0) {
    const x0 = Math.max(L, 0)
    const x1 = Math.min(R, STAGE.W)
    const h = Math.min(B, 0) - T
    if (x1 > x0 && h > 0.5) out.push({ id: id + '-T', x: x0, y: T, w: x1 - x0, h })
  }
  if (B > STAGE.H) {
    const x0 = Math.max(L, 0)
    const x1 = Math.min(R, STAGE.W)
    const y = Math.max(T, STAGE.H)
    const h = B - y
    if (x1 > x0 && h > 0.5) out.push({ id: id + '-B', x: x0, y, w: x1 - x0, h })
  }
  return out
}

const offstageHatchesScreen = computed(() => {
  if (s.value.showOffstageHatch === false) return []
  const z = scale.value || 1
  const list = []
  for (const layer of scene.orderedLayers || []) {
    if (layer.visible === false) continue
    for (const h of offstageStrips(layer.transform, layer.id)) {
      list.push({
        id: h.id,
        left: (STAGE_MARGIN + h.x) * z,
        top: (STAGE_MARGIN + h.y) * z,
        width: h.w * z,
        height: h.h * z
      })
    }
  }
  return list
})

/** Distances from selected layer box to stage edges (logical px). */
const edgePixelLabels = computed(() => {
  const t = selected.value?.transform
  if (!t) return []
  const left = Math.round(t.x)
  const top = Math.round(t.y)
  const right = Math.round(STAGE.W - (t.x + t.w))
  const bottom = Math.round(STAGE.H - (t.y + t.h))
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  return [
    { cls: 'edge-l', x: Math.min(t.x, 0) - 4, y: cy, text: left + 'px' },
    { cls: 'edge-r', x: Math.max(t.x + t.w, STAGE.W) + 4, y: cy, text: right + 'px' },
    { cls: 'edge-t', x: cx, y: Math.min(t.y, 0) - 4, text: top + 'px' },
    { cls: 'edge-b', x: cx, y: Math.max(t.y + t.h, STAGE.H) + 4, text: bottom + 'px' }
  ]
})

const selMetricsText = computed(() => {
  const t = selected.value?.transform
  if (!t) return ''
  const size = Math.round(t.w) + '×' + Math.round(t.h)
  if (transformKind.value === 'move') return size + '  ' + Math.round(t.x) + ', ' + Math.round(t.y)
  return size
})

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// --- snap guide lines currently being shown --------------------------------
const snapGuides = ref([])
function clearGuides() { snapGuides.value = [] }

// --- distance labels (showDistances overlay) --------------------------------
// Computed from the selected layer's bbox against every other layer. Only
// meaningful when something is selected; otherwise empty.
const distLabels = computed(() => {
  if (!s.value.showDistances || !selected.value) return []
  const t = selected.value.transform
  return distanceLabels(
    { x: t.x, y: t.y, w: t.w, h: t.h },
    scene.layers,
    selected.value.id
  )
})

// --- MOVE ------------------------------------------------------------------
function onMoveStart(e) {
  if (!isPrimaryButton(e)) return
  const l = selected.value
  if (!l || l.locked) return
  // Prevent the browser from kicking off its native text-selection / image-drag
  // gesture on mousedown — that's what paints the Windows-style blue highlight
  // over content while dragging a layer. We drive the move ourselves.
  e.preventDefault()
  dragging.value = true
  transformKind.value = 'move'
  const start = { sx: e.clientX, sy: e.clientY, ox: l.transform.x, oy: l.transform.y }
  let lastSent = 0
  const move = (ev) => {
    let dx = (ev.clientX - start.sx) / scale.value
    let dy = (ev.clientY - start.sy) / scale.value
    if (ev.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    let nx = start.ox + dx
    let ny = start.oy + dy
    let x = nx
    let y = ny
    if (ev.altKey) {
      snapGuides.value = []
    } else {
      const snapped = snapMove(nx, ny, l.transform.w, l.transform.h, s.value, scene.layers, l.id, scene.obsSources)
      snapGuides.value = snapped.guides
      x = snapped.x
      y = snapped.y
    }
    const patch = { transform: { ...l.transform, x: Math.round(x), y: Math.round(y) } }
    const now = Date.now()
    // Optimistic local + throttled WS (S1).
    if (now - lastSent > 40) {
      lastSent = now
      scene.updateLayer(l.id, patch, { optimistic: true })
    } else {
      scene._applyOpLocally({ kind: 'updateLayer', id: l.id, patch })
    }
  }
  const up = () => {
    dragging.value = false
    transformKind.value = null
    clearGuides()
    // Final commit
    const l2 = selected.value
    if (l2) scene.updateLayer(l2.id, { transform: { ...l2.transform } }, { optimistic: true })
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// --- RESIZE ----------------------------------------------------------------
const ASPECT_MEDIA = new Set(['image', 'gif', 'video', 'emote', 'youtube'])
const EDGE_HANDLES = new Set(['n', 'e', 's', 'w'])

function onResizeStart(handle, e) {
  if (!isPrimaryButton(e)) return
  const l = selected.value
  if (!l || l.locked) return
  e.preventDefault()
  dragging.value = true
  transformKind.value = 'resize'
  const start = { sx: e.clientX, sy: e.clientY, t: { ...l.transform } }
  const isMedia = ASPECT_MEDIA.has(l.type)
  const maintain = isMedia && l.maintainRatio !== false
  const isEdge = EDGE_HANDLES.has(handle)

  const move = (ev) => {
    const dx = (ev.clientX - start.sx) / scale.value
    const dy = (ev.clientY - start.sy) / scale.value
    const shift = ev.shiftKey
    // Edges + Shift: axis-only (even with Aspect Ratio on).
    // Corners: Aspect Ratio on → lock; off + Shift → temporary lock.
    const useAspect = isEdge
      ? (maintain && !shift)
      : (maintain || shift)
    const nt = useAspect
      ? resizeAspect(start.t, handle, dx, dy)
      : resizeFree(start.t, handle, dx, dy)
    scene.updateLayer(l.id, { transform: { ...l.transform, ...nt } })
  }
  const up = () => {
    dragging.value = false
    transformKind.value = null
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
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
function onRotateStart(e) {
  if (!isPrimaryButton(e)) return
  const l = selected.value
  if (!l || l.locked) return
  e.preventDefault()
  const frame = frameEl.value?.getBoundingClientRect()
  if (!frame) return
  dragging.value = true
  transformKind.value = 'rotate'
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
  const up = () => {
    dragging.value = false
    transformKind.value = null
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

const EMPTY_DESLECT = new Set([
  'scroll', 'viewport', 'workspace-frame', 'stage-veil', 'stage-bg',
  'stage-content', 'grid', 'canvas', 'stage-veil-t', 'stage-veil-b',
  'stage-veil-l', 'stage-veil-r', 'offstage-hatch-screen', 'offstage-hatch-layer'
])
function onCanvasMouseDown(e) {
  if (panning.value || spaceHeld.value) return
  if (e.target === root.value) { scene.select(null); return }
  const cls = e.target?.classList
  if (!cls) return
  for (const name of EMPTY_DESLECT) {
    if (cls.contains(name)) { scene.select(null); return }
  }
}

function onCanvasPointerMove(e) {
  const frame = frameEl.value
  if (!frame) return
  const r = frame.getBoundingClientRect()
  const s = scale.value || 1
  cursorStage.value = {
    x: (e.clientX - r.left) / s,
    y: (e.clientY - r.top) / s
  }
}

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

function bringSelected(front) {
  const l = selected.value
  if (!l) return
  const ids = [...scene.layers].sort((a, b) => (a.order || 0) - (b.order || 0)).map((x) => x.id)
  const i = ids.indexOf(l.id)
  if (i < 0) return
  ids.splice(i, 1)
  if (front) ids.push(l.id)
  else ids.unshift(l.id)
  scene.reorder(ids)
}

function onKeyDown(e) {
  if (isTypingTarget(e.target)) return
  if (e.code === 'Space') {
    const tag = e.target?.tagName
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return
    e.preventDefault()
    spaceHeld.value = true
    return
  }
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && e.key === '0') { e.preventDefault(); zoomFit(); return }
  if (ctrl && e.key === '1') { e.preventDefault(); zoom100(); return }
  if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(1.2); return }
  if (ctrl && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(1 / 1.2); return }

  const l = selected.value
  if (!l) return
  if (ctrl && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    scene.duplicateLayer(l.id)
    return
  }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === 'a' && ASPECT_MEDIA.has(l.type)) {
    e.preventDefault()
    const next = l.maintainRatio === false
    scene.updateLayer(l.id, { maintainRatio: next })
    if (next) menuFitSelected(l)
    return
  }
  if (e.key === ']') { e.preventDefault(); bringSelected(true); return }
  if (e.key === '[') { e.preventDefault(); bringSelected(false); return }
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowLeft') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, x: l.transform.x - step } }) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, x: l.transform.x + step } }) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, y: l.transform.y - step } }) }
  else if (e.key === 'ArrowDown') { e.preventDefault(); scene.updateLayer(l.id, { transform: { ...l.transform, y: l.transform.y + step } }) }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); scene.deleteLayer(l.id) }
  else if (e.key === 'Escape') { scene.select(null) }
}
function onKeyUp(e) {
  if (e.code === 'Space') spaceHeld.value = false
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
.canvas.panning,
.canvas.panning * {
  cursor: grabbing !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
.canvas.space-ready { cursor: grab; }
.canvas.space-ready.panning,
.canvas.space-ready.panning * { cursor: grabbing !important; }
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
.scroll.is-fitted {
  align-items: center;
  justify-content: center;
}
.viewport {
  position: relative;
  /* margin:auto inside a flex (.scroll) parent centers the stage on BOTH axes
     when it fits, and collapses to 0 when zoomed in so panning reaches all. */
  margin: auto;
}
.workspace-frame {
  position: relative;
  background: transparent;
  overflow: visible;
}
.stage-bg {
  position: absolute;
  background: #000;
  outline: 1px solid var(--fluent-stroke);
  box-shadow: var(--fluent-elevation);
  pointer-events: none;
  z-index: 0;
}
.stage-veil {
  position: absolute;
  pointer-events: none;
  z-index: 1;
  background-color: color-mix(in srgb, var(--bg) 55%, transparent);
}
.offstage-hatch-screen,
.offstage-hatch-layer {
  position: absolute;
  pointer-events: none;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent 0,
    transparent 6px,
    color-mix(in srgb, var(--text) 14%, transparent) 6px,
    color-mix(in srgb, var(--text) 14%, transparent) 7px
  );
}
.offstage-hatch-screen {
  z-index: 3;
}
.offstage-hatch-layer {
  z-index: 4;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent 0,
    transparent 6px,
    color-mix(in srgb, var(--text) 18%, transparent) 6px,
    color-mix(in srgb, var(--text) 18%, transparent) 7px
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent);
}
.stage-content {
  position: absolute;
  overflow: visible;
  z-index: 2;
}
.edge-px-label {
  position: absolute;
  transform: translate(-50%, -50%) scale(var(--chrome-inv, 1));
  transform-origin: center center;
  background: color-mix(in srgb, var(--fluent-acrylic) 94%, var(--fluent-accent));
  color: var(--text);
  border: 1px solid var(--fluent-stroke);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-sans);
  padding: 2px 7px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.edge-px-label.edge-l {
  transform: translate(-100%, -50%) scale(var(--chrome-inv, 1));
  transform-origin: right center;
}
.edge-px-label.edge-r {
  transform: translate(0, -50%) scale(var(--chrome-inv, 1));
  transform-origin: left center;
}
.edge-px-label.edge-t {
  transform: translate(-50%, -100%) scale(var(--chrome-inv, 1));
  transform-origin: center bottom;
}
.edge-px-label.edge-b {
  transform: translate(-50%, 0) scale(var(--chrome-inv, 1));
  transform-origin: center top;
}
.grid { position: absolute; inset: 0; pointer-events: none; }
.safe { position: absolute; border: 1px dashed color-mix(in srgb, var(--fluent-accent) 45%, #fbbf24); pointer-events: none; }
.action-safe { inset: 2.5%; }
.title-safe { inset: 5%; border-color: color-mix(in srgb, var(--fluent-accent) 30%, #fbbf24); opacity: 0.9; }
.center-cross {
  position: absolute; left: 50%; top: 50%; width: 24px; height: 24px;
  transform: translate(-50%,-50%); pointer-events: none;
  background:
    linear-gradient(var(--fluent-accent), var(--fluent-accent)) center/100% 1px no-repeat,
    linear-gradient(90deg, var(--fluent-accent), var(--fluent-accent)) center/1px 100% no-repeat;
  opacity: 0.55;
}
.selection {
  position: absolute;
  pointer-events: auto;
  --sel-line: var(--fluent-accent);
  outline: calc(2.5px * var(--handle-inv, 1)) solid var(--sel-line);
  outline-offset: 0;
  box-shadow:
    0 0 0 calc(2px * var(--handle-inv, 1)) color-mix(in srgb, var(--sel-line) 55%, transparent),
    0 0 calc(10px * var(--handle-inv, 1)) color-mix(in srgb, var(--sel-line) 70%, transparent),
    inset 0 0 0 1px color-mix(in srgb, #fff 30%, transparent);
}
.selection.audience-on { --sel-line: var(--ok, #22c55e); }
.selection.audience-off { --sel-line: var(--danger, #ef4444); }
.audience-outline {
  position: absolute;
  pointer-events: none;
  z-index: 5;
  box-sizing: border-box;
  --sel-line: var(--ok, #22c55e);
  outline: calc(2px * var(--handle-inv, 1)) solid var(--sel-line);
  outline-offset: 0;
  opacity: 0.42;
}
.audience-outline.audience-on { --sel-line: var(--ok, #22c55e); }
.audience-outline.audience-off { --sel-line: var(--danger, #ef4444); }
.sel-body { position: absolute; inset: 0; cursor: grab; }
.sel-body:active { cursor: grabbing; }
.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--card, #fff);
  border: 2px solid var(--sel-line, var(--fluent-accent));
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  z-index: 2;
  box-sizing: border-box;
  transform: scale(var(--handle-inv, 1));
  transform-origin: center center;
}
/* Invisible hit pad for easier grabs when zoomed out */
.handle::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}
.handle.h-nw { left: -6px; top: -6px; cursor: nwse-resize; }
.handle.h-n  {
  left: 50%; top: -6px; margin-left: -8px;
  width: 16px; height: 10px;
  cursor: ns-resize;
}
.handle.h-ne { right: -6px; top: -6px; cursor: nesw-resize; }
.handle.h-e  {
  right: -6px; top: 50%; margin-top: -8px;
  width: 10px; height: 16px;
  cursor: ew-resize;
}
.handle.h-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.handle.h-s  {
  left: 50%; bottom: -6px; margin-left: -8px;
  width: 16px; height: 10px;
  cursor: ns-resize;
}
.handle.h-sw { left: -6px; bottom: -6px; cursor: nesw-resize; }
.handle.h-w  {
  left: -6px; top: 50%; margin-top: -8px;
  width: 10px; height: 16px;
  cursor: ew-resize;
}
.rotate-stem {
  position: absolute;
  left: 50%;
  top: -22px;
  width: 1.5px;
  height: 14px;
  margin-left: -0.75px;
  background: var(--sel-line, var(--fluent-accent));
  pointer-events: none;
  z-index: 1;
  transform: scale(var(--handle-inv, 1));
  transform-origin: bottom center;
}
.handle.rotate {
  left: 50%;
  top: -30px;
  margin-left: -6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  cursor: grab;
  background: var(--sel-line, var(--fluent-accent));
  border-color: color-mix(in srgb, #fff 70%, var(--sel-line, var(--fluent-accent)));
  transform: scale(var(--handle-inv, 1));
  transform-origin: center center;
}
.sel-badge {
  position: absolute;
  left: 0;
  transform: scale(var(--chrome-inv, 1));
  transform-origin: top left;
  background: color-mix(in srgb, var(--fluent-acrylic) 94%, var(--fluent-accent));
  color: var(--text);
  border: 1px solid var(--fluent-stroke);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-sans);
  padding: 3px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  max-width: min(280px, 70vw);
  overflow: hidden;
  text-overflow: ellipsis;
}
.sel-name { top: 6px; left: 6px; }
.sel-metrics {
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%) scale(var(--chrome-inv, 1));
  transform-origin: bottom center;
}
.guide {
  position: absolute;
  background: var(--fluent-accent);
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--fluent-accent) 40%, transparent);
  opacity: 0.92;
}
.guide-v, .guide.v { width: 1px; top: 0; bottom: 0; }
.guide-h, .guide.h { height: 1px; left: 0; right: 0; }
/* Distance badges sit on the gap midpoint; the -50% transform centers them on it. */
.dist-label {
  position: absolute;
  transform: translate(-50%, -50%) scale(var(--chrome-inv, 1));
  transform-origin: center center;
  background: color-mix(in srgb, var(--fluent-acrylic) 94%, var(--fluent-accent));
  color: var(--text);
  border: 1px solid var(--fluent-stroke);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-sans);
  padding: 2px 7px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 5;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.obs-bound {
  position: absolute;
  border: 1.5px dashed rgba(255, 165, 0, .9);
  background: rgba(255, 165, 0, .08);
  pointer-events: auto;
  cursor: pointer;
  box-sizing: border-box;
  z-index: 4;
}
.obs-bound.hidden { border-style: dotted; opacity: .4; }
.obs-bound.group { border-color: rgba(255, 200, 100, .95); }
.obs-bound.selected {
  border-style: solid;
  border-color: #ff9800;
  background: rgba(255, 152, 0, .18);
  box-shadow: 0 0 0 1px rgba(255, 152, 0, .5);
}
.obs-label {
  position: absolute; top: 2px; left: 4px;
  font-size: 10px; color: #ffb74d;
  background: rgba(0,0,0,.6); padding: 1px 4px; border-radius: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 8px);
  pointer-events: none;
}
.obs-hint {
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(255,165,0,.9); color: #000;
  font-size: 11px; padding: 4px 10px; border-radius: 4px;
  z-index: 6; pointer-events: none;
}
.ruler {
  position: absolute;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  overflow: hidden;
}
.ruler-h { top: 0; height: 20px; }
.ruler-v { left: 0; width: 20px; }
.ruler-corner {
  position: absolute;
  top: 0; left: 0;
  width: 20px; height: 20px;
  z-index: 11;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  pointer-events: none;
}
.ruler-tick {
  position: absolute;
  background: color-mix(in srgb, var(--fluent-accent) 45%, var(--border));
}
.ruler-h .ruler-tick { top: 12px; width: 1px; height: 8px; }
.ruler-h .ruler-tick.major { top: 0; height: 20px; }
.ruler-v .ruler-tick { left: 12px; height: 1px; width: 8px; }
.ruler-v .ruler-tick.major { left: 0; width: 20px; }
.ruler-lbl {
  position: absolute;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--muted, var(--text));
  opacity: 0.85;
  line-height: 1;
}
.ruler-h .ruler-lbl { top: 2px; left: 3px; }
.ruler-v .ruler-lbl { top: 3px; left: 2px; writing-mode: horizontal-tb; }
.ruler-cursor {
  position: absolute;
  background: var(--fluent-accent);
  z-index: 2;
  pointer-events: none;
}
.ruler-h .ruler-cursor { top: 0; width: 1px; height: 20px; }
.ruler-v .ruler-cursor { left: 0; height: 1px; width: 20px; }
.hud { position: absolute; right: 12px; bottom: 12px; display: flex; align-items: center; gap: 8px; z-index: 20; }
.hud-hint {
  font-size: 11px;
  padding: 4px 8px;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  white-space: nowrap;
}
.zoom-ctrl {
  display: flex; align-items: center; gap: 4px;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  box-shadow: var(--fluent-elevation);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--text);
}
.zoom-ctrl button {
  padding: 2px 8px;
  min-width: 28px;
  border-color: var(--fluent-stroke);
  background: var(--bg-3);
}
.zoom-ctrl button:hover { background: var(--fluent-reveal); }
.zoom-pct {
  min-width: 48px;
  font-variant-numeric: tabular-nums;
  cursor: text;
  border: none;
  background: transparent;
  color: inherit;
}
.zoom-pct-input {
  width: 52px;
  height: 22px;
  font-size: 12px;
  text-align: center;
  border: 1px solid var(--fluent-accent);
  border-radius: 4px;
  background: var(--bg-3);
  color: var(--text);
}
.inline-text-editor {
  position: absolute;
  z-index: 50;
  background: color-mix(in srgb, var(--fluent-accent) 12%, transparent);
  border: 2px solid var(--fluent-accent);
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
