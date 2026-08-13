<!--
  YoutubeManager.vue
  One floating, draggable, minimizable control window per YouTube layer on the
  stage. Unlike the PropertiesPanel controls (which follow the *selected*
  layer), every YouTube video gets its own always-visible transport window so
  the moderator can juggle several clips at once without re-selecting each.

  The window list is derived straight from the scene's youtube layers, so when
  a video is deleted from the workspace its window disappears automatically,
  and each newly added video spawns its own window. Each window can be:
    - dragged anywhere on screen (grab its header),
    - minimized to a compact transport bar (and expanded back),
    - collapsed in bulk via the master toolbar (handy with many videos).
-->
<template>
  <div v-if="youtubeLayers.length" class="yt-manager">
    <AppPanel
      :open="true"
      title="YouTube"
      width="220px"
      class="ym-master"
      :padded="false"
      :closable="false"
    >
      <template #icon><TvMinimalPlay class="h-3.5 w-3.5" /></template>
      <template #title>
        <span class="ym-title-row">YouTube <span class="ym-count">{{ youtubeLayers.length }}</span></span>
      </template>
      <template #actions>
        <Button size="icon" variant="ghost" class="h-7 w-7" :title="allCollapsed ? 'Expand all' : 'Collapse all'" @click="toggleAll">
          <Maximize2 v-if="allCollapsed" class="h-3.5 w-3.5" />
          <Minimize2 v-else class="h-3.5 w-3.5" />
        </Button>
      </template>
    </AppPanel>

    <div
      v-for="(l, i) in youtubeLayers"
      :key="l.id"
      class="yt-win fluent-float"
      :class="{ selected: l.id === scene.selectedId, 'is-minimized': isCollapsed(l.id) }"
      :style="winStyle(l.id, i)"
    >
      <!-- Header: drag handle + title + live indicator + collapse/close -->
      <div class="yt-head" @mousedown="onDragStart($event, l.id)" @dblclick="toggleCollapse(l.id)">
        <GripVertical class="yt-drag h-3.5 w-3.5" title="Drag" />
        <button class="yt-play-dot" :class="{ on: playing(l.id) }" :title="playing(l.id) ? 'Playing' : 'Paused'"
                @mousedown.stop @click="quickToggle(l.id)">
          <Pause v-if="playing(l.id)" class="h-3 w-3" />
          <Play v-else class="h-3 w-3" />
        </button>
        <span class="yt-name" :title="l.name">{{ l.name }}</span>
        <span class="yt-time muted">{{ fmt(current(l.id)) }} / {{ fmt(duration(l.id)) }}</span>
        <span class="yt-head-spacer"></span>
        <button class="yt-icon" title="Focus on stage" @mousedown.stop @click="scene.select(l.id)">
          <Crosshair class="h-3.5 w-3.5" />
        </button>
        <button class="yt-icon" :title="isCollapsed(l.id) ? 'Expand' : 'Minimize'" @mousedown.stop @click="toggleCollapse(l.id)">
          <Square v-if="isCollapsed(l.id)" class="h-3 w-3" />
          <Minus v-else class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Collapsed: a slim live progress strip (click to expand, drag via head). -->
      <div v-if="isCollapsed(l.id)" class="yt-collapsed" @click="toggleCollapse(l.id)" title="Click to expand">
        <div class="yt-strip"><div class="yt-strip-fill" :style="{ width: pct(l.id) + '%' }"></div></div>
      </div>

      <!-- Expanded: full transport (new YoutubePlayer). -->
      <div v-else class="yt-body">
        <YoutubePlayer :layer="l" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { TvMinimalPlay, Maximize2, Minimize2, GripVertical, Play, Pause, Crosshair, Square, Minus } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import YoutubePlayer from './YoutubePlayer.vue'
import { expectedTime, normalizeSyncMode } from '../../features/ytTimeline.js'
import { Button } from '@/components/ui/button'
import AppPanel from '@/components/shell/AppPanel.vue'

const scene = useSceneStore()

// Source of truth: every youtube layer on the stage.
const youtubeLayers = computed(() => scene.layers.filter((l) => l.type === 'youtube'))

// Reactive viewport height so window positions recompute on browser resize
// (fromBottom depends on it). Otherwise a resized window would leave dropped
// windows floating at stale coordinates.
const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)
function onResize() { viewportH.value = window.innerHeight }
// --- live transport readout (timeline-aware) -------------------------------
const uiTick = ref(0)
let uiTickTimer = null
onMounted(() => {
  window.addEventListener('resize', onResize)
  uiTickTimer = setInterval(() => { uiTick.value++ }, 250)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (uiTickTimer) clearInterval(uiTickTimer)
})

function stateOf(id) { return scene.mediaState[id] || {} }
function timelineOf(id) { return scene.ytTimeline[id] || null }
function isLegacy(id) {
  const l = youtubeLayers.value.find((x) => x.id === id)
  return normalizeSyncMode(l?.youtube?.syncMode) === 'legacy'
}
function current(id) {
  void uiTick.value
  const tl = timelineOf(id)
  if (!isLegacy(id) && tl) return expectedTime(tl)
  return stateOf(id).current || 0
}
function duration(id) { return stateOf(id).duration || 0 }
function playing(id) {
  const tl = timelineOf(id)
  if (!isLegacy(id) && tl) return !!tl.playing && !tl.stop
  return !!stateOf(id).playing
}
function pct(id) { const d = duration(id); return d ? Math.max(0, Math.min(100, (current(id) / d) * 100)) : 0 }

function quickToggle(id) {
  const l = youtubeLayers.value.find((x) => x.id === id)
  const patch = { playing: !playing(id) }
  if (normalizeSyncMode(l?.youtube?.syncMode) === 'legacy') scene.sendMediaCtrl(id, patch)
  else scene.sendYtTransport(id, patch)
}

// Per-window UI state: collapse flag + drag offset. Kept local (not persisted)
// since it's pure moderator chrome — it has nothing to do with the scene or OBS.
const collapsed = reactive({})   // id -> boolean
const pos = reactive({})         // id -> { x, y } offset from the dock

// All window positions are stored as viewport pixel coords from the bottom-left
// (x = distance from the left edge, y = distance from the bottom edge). The
// .yt-manager is a full-viewport transparent positioning context, so we convert
// bottom-distance to a CSS top offset at render time. This keeps dragging
// intuitive (windows stick where dropped) and survives resize without drift.
const DOCK_LEFT = 16
const DOCK_BOTTOM = 44           // leaves room for the StatusBar
const WIN_GAP = 40               // cascade gap between undragged windows

// Position one window. Dragged windows keep their stored offset; undragged ones
// cascade upward from the dock so a freshly added batch doesn't perfectly stack.
function winStyle(id, index) {
  const p = pos[id]
  if (p) return { left: p.x + 'px', top: fromBottom(p.y) + 'px' }
  return { left: DOCK_LEFT + 'px', top: fromBottom(DOCK_BOTTOM + index * WIN_GAP) + 'px' }
}
// Convert a "distance from the bottom of the viewport" into a CSS `top` value.
// Uses the reactive viewportH so windows re-anchor on resize.
function fromBottom(bottomPx) {
  return Math.max(8, viewportH.value - bottomPx)
}

function isCollapsed(id) { return !!collapsed[id] }
function toggleCollapse(id) { collapsed[id] = !collapsed[id] }

const allCollapsed = computed(() => youtubeLayers.value.length > 0 && youtubeLayers.value.every((l) => collapsed[l.id]))
function toggleAll() {
  const target = !allCollapsed.value
  for (const l of youtubeLayers.value) collapsed[l.id] = target
}

// --- drag (header grab) ----------------------------------------------------
// Tracks the in-progress drag for one window. Offset is measured from the
// bottom-left so it composes with the CSS `bottom` anchoring.
const drag = reactive({ id: null, startX: 0, startY: 0, baseX: 0, baseY: 0 })
function onDragStart(e, id) {
  // Don't start a drag from the buttons inside the header.
  if (e.button !== 0) return
  const cur = pos[id] || { x: DOCK_LEFT, y: DOCK_BOTTOM }
  drag.id = id
  drag.startX = e.clientX
  drag.startY = e.clientY
  drag.baseX = cur.x
  drag.baseY = cur.y
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
  document.body.style.userSelect = 'none'
}
function onDragMove(e) {
  if (!drag.id) return
  const dx = e.clientX - drag.startX
  // Invert dy because we anchor with `bottom`: dragging up (clientY down) should
  // raise the window (increase bottom).
  const dy = drag.startY - e.clientY
  pos[drag.id] = {
    x: Math.max(4, drag.baseX + dx),
    y: Math.max(4, drag.baseY + dy)
  }
}
function onDragEnd() {
  drag.id = null
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  document.body.style.userSelect = ''
}

// Drop per-window UI state for videos no longer on the stage (deleted) so the
// reactive maps don't grow without bound across a long session.
watch(youtubeLayers, (list) => {
  const ids = new Set(list.map((l) => l.id))
  for (const k of Object.keys(collapsed)) if (!ids.has(k)) delete collapsed[k]
  for (const k of Object.keys(pos)) if (!ids.has(k)) delete pos[k]
}, { flush: 'post' })

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
</script>

<style scoped>
.yt-manager {
  position: fixed;
  inset: 0;
  z-index: 80;
  pointer-events: none;
}
.yt-manager > * { pointer-events: auto; }

.ym-master {
  position: absolute !important;
  left: 16px !important;
  right: auto !important;
  top: auto !important;
  bottom: 6px !important;
  max-height: none !important;
  width: 220px !important;
}
.ym-title-row { display: inline-flex; align-items: center; gap: 6px; }
.ym-count {
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px;
  background: var(--fluent-accent);
  color: #fff;
  font-size: 10px; font-weight: 700; line-height: 18px; text-align: center;
}

.yt-win {
  position: absolute;
  width: 300px;
  z-index: 80;
}
.yt-win.selected { border-color: var(--fluent-accent) !important; box-shadow: 0 0 0 1px var(--fluent-accent), var(--fluent-elevation) !important; }
.yt-win.is-minimized { width: 260px; }

.yt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--bg-2) 80%, transparent);
  border-bottom: 1px solid var(--fluent-stroke);
  cursor: grab;
  user-select: none;
}
.yt-head:active { cursor: grabbing; }
.yt-win.is-minimized .yt-head { border-bottom: none; }
.yt-drag { color: var(--text-dim); flex-shrink: 0; }
.yt-play-dot {
  flex: none;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: none;
  background: var(--bg-3);
  color: var(--text);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.yt-play-dot:hover { background: var(--fluent-accent); color: #fff; }
.yt-play-dot.on { background: var(--fluent-accent); color: #fff; }
.yt-name {
  font-size: 12px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 90px;
}
.yt-time { font-size: 10px; font-variant-numeric: tabular-nums; }
.yt-head-spacer { flex: 1; }
.yt-icon {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--fluent-stroke);
  background: transparent;
  color: var(--text);
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.yt-icon:hover { background: var(--fluent-accent); color: #fff; border-color: var(--fluent-accent); }

.yt-collapsed { padding: 6px 8px 8px; cursor: pointer; }
.yt-strip {
  height: 6px;
  background: var(--bg-3);
  border-radius: 3px;
  overflow: hidden;
}
.yt-strip-fill {
  height: 100%;
  background: var(--fluent-accent);
  border-radius: 3px;
  transition: width 0.2s linear;
}

.yt-body { padding: 8px; max-height: 60vh; overflow-y: auto; }
</style>
