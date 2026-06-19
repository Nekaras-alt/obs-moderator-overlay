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
    <!-- Master toolbar: count + collapse/expand all. -->
    <div class="ym-bar">
      <span class="ym-title">▶ YouTube</span>
      <span class="ym-count">{{ youtubeLayers.length }}</span>
      <span class="ym-spacer"></span>
      <button class="ym-mini" :title="allCollapsed ? 'Expand all' : 'Collapse all'" @click="toggleAll">
        {{ allCollapsed ? '⊞' : '⊟' }}
      </button>
    </div>

    <div
      v-for="(l, i) in youtubeLayers"
      :key="l.id"
      class="yt-win"
      :class="{ selected: l.id === scene.selectedId, collapsed: isCollapsed(l.id) }"
      :style="winStyle(l.id, i)"
    >
      <!-- Header: drag handle + title + live indicator + collapse/close -->
      <div class="yt-head" @mousedown="onDragStart($event, l.id)" @dblclick="toggleCollapse(l.id)">
        <span class="yt-drag" title="Drag">⋮⋮</span>
        <button class="yt-play-dot" :class="{ on: playing(l.id) }" :title="playing(l.id) ? 'Playing' : 'Paused'"
                @mousedown.stop @click="quickToggle(l.id)">{{ playing(l.id) ? '❚❚' : '▶' }}</button>
        <span class="yt-name" :title="l.name">{{ l.name }}</span>
        <span class="yt-time muted">{{ fmt(current(l.id)) }} / {{ fmt(duration(l.id)) }}</span>
        <span class="yt-head-spacer"></span>
        <button class="yt-icon" title="Focus on stage" @mousedown.stop @click="scene.select(l.id)">◎</button>
        <button class="yt-icon" :title="isCollapsed(l.id) ? 'Expand' : 'Minimize'" @mousedown.stop @click="toggleCollapse(l.id)">
          {{ isCollapsed(l.id) ? '▢' : '—' }}
        </button>
      </div>

      <!-- Collapsed: a slim live progress strip (click to expand, drag via head). -->
      <div v-if="isCollapsed(l.id)" class="yt-collapsed" @click="toggleCollapse(l.id)" title="Click to expand">
        <div class="yt-strip"><div class="yt-strip-fill" :style="{ width: pct(l.id) + '%' }"></div></div>
      </div>

      <!-- Expanded: full transport (delegates to YoutubeControls). -->
      <div v-else class="yt-body">
        <YoutubeControls :layer="l" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed, watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import YoutubeControls from './YoutubeControls.vue'

const scene = useSceneStore()

// Reactive viewport height so window positions recompute on browser resize
// (fromBottom depends on it). Otherwise a resized window would leave dropped
// windows floating at stale coordinates.
const viewportH = ref(typeof window !== 'undefined' ? window.innerHeight : 1080)
function onResize() { viewportH.value = window.innerHeight }
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// Source of truth: every youtube layer on the stage. Derived from the store, so
// adding/deleting a video automatically grows/shrinks the window set.
const youtubeLayers = computed(() => scene.layers.filter((l) => l.type === 'youtube'))

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

// --- live transport readout (from the store's mediaState, editor-only) -----
function stateOf(id) { return scene.mediaState[id] || {} }
function current(id) { return stateOf(id).current || 0 }
function duration(id) { return stateOf(id).duration || 0 }
function playing(id) { return !!stateOf(id).playing }
function pct(id) { const d = duration(id); return d ? Math.max(0, Math.min(100, (current(id) / d) * 100)) : 0 }

function quickToggle(id) {
  scene.sendMediaCtrl(id, { playing: !playing(id) })
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
  inset: 0;               /* full-viewport transparent positioning context */
  z-index: 80;
  pointer-events: none;   /* windows + bar re-enable pointer events */
}
.yt-manager > * { pointer-events: auto; }

/* Master toolbar: anchored bottom-left, above the StatusBar. */
.ym-bar {
  position: absolute;
  left: 16px;
  /* top computed to sit DOCK_BOTTOM-ish above the bottom; mirror of winStyle's
     fromBottom. Kept slightly under the first window's cascade baseline. */
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 300px;
  padding: 5px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
  font-size: 12px;
  box-sizing: border-box;
}
.ym-title { font-weight: 600; }
.ym-count {
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 10px; font-weight: 700; line-height: 18px; text-align: center;
}
.ym-spacer { flex: 1; }
.ym-mini {
  padding: 2px 7px; font-size: 12px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  border-radius: 5px;
}

/* Each floating window */
.yt-win {
  position: absolute; /* within the .yt-manager container */
  width: 300px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
  z-index: 80;
}
.yt-win.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }
.yt-win.collapsed { width: 260px; }

.yt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
}
.yt-head:active { cursor: grabbing; }
.yt-win.collapsed .yt-head { border-bottom: none; }
.yt-drag { color: var(--text-dim); font-size: 11px; letter-spacing: -2px; }
.yt-play-dot {
  flex: none;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: none;
  background: var(--bg-3);
  color: var(--text);
  font-size: 10px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.yt-play-dot:hover { background: var(--accent); color: #fff; }
.yt-play-dot.on { background: var(--accent); color: #fff; }
.yt-name {
  font-size: 12px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 90px;
}
.yt-time { font-size: 10px; font-variant-numeric: tabular-nums; }
.yt-head-spacer { flex: 1; }
.yt-icon {
  flex: none;
  width: 22px; height: 22px;
  padding: 0;
  font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 5px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.yt-icon:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

/* Collapsed body: a clickable slim progress strip */
.yt-collapsed { padding: 6px 8px 8px; cursor: pointer; }
.yt-strip {
  height: 6px;
  background: var(--bg-3);
  border-radius: 3px;
  overflow: hidden;
}
.yt-strip-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s linear;
}

/* Expanded body: the shared controls. YoutubeControls renders its own fieldset. */
.yt-body { padding: 8px; max-height: 60vh; overflow-y: auto; }
.yt-body :deep(fieldset) { border-color: var(--border); }
</style>
