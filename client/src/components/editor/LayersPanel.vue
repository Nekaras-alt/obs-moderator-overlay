<!--
  LayersPanel.vue (M1)
  Stacking list with folders, color labels, search, reorder (up/down), lock,
  and the two visibility toggles:
    - eye   : editor-only visibility (hidden from the canvas, not the stream)
    - globe : audienceVisible (the "reveal to stream" toggle for OBS)
-->
<template>
  <div class="layers">
    <div class="head">
      <span>Layers</span>
      <span class="muted">{{ scene.layers.length }}</span>
    </div>

    <div class="controls">
      <input v-model="search" class="search" placeholder="Search layers…" />
      <select v-model="folderFilter" class="folder-sel">
        <option value="">All folders</option>
        <option v-for="f in scene.folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        <option value="__none">No folder</option>
      </select>
    </div>

    <div class="list">
      <div
        v-for="(layer, idx) in visibleList"
        :key="layer.id"
        class="item"
        :class="{ selected: layer.id === scene.selectedId, locked: layer.locked }"
        draggable="true"
        @click="scene.select(layer.id)"
        @dragstart="onDragStart(idx, $event)"
        @dragover.prevent
        @drop.prevent="onDrop(idx)"
      >
        <span class="swatch" :style="{ background: labelColor(layer.colorLabel) }" :title="layer.colorLabel"></span>
        <button
          class="icon"
          :title="layer.visible === false ? 'Hidden in editor' : 'Visible in editor'"
          @click.stop="scene.updateLayer(layer.id, { visible: layer.visible === false })"
        >{{ layer.visible === false ? '∘' : '👁' }}</button>
        <button
          class="icon"
          :class="{ on: layer.audienceVisible }"
          :title="layer.audienceVisible ? 'Shown to audience (on OBS)' : 'Hidden from audience'"
          @click.stop="scene.updateLayer(layer.id, { audienceVisible: !layer.audienceVisible })"
        >{{ layer.audienceVisible ? '🌍' : '🚫' }}</button>
        <span class="name" :title="layer.name">{{ layer.name }}</span>
        <span class="type muted">{{ layer.type }}</span>

        <div class="row-actions">
          <button class="icon" title="Move up" @click.stop="moveUp(idx)">▲</button>
          <button class="icon" title="Move down" @click.stop="moveDown(idx)">▼</button>
          <button class="icon" :title="layer.locked ? 'Unlock' : 'Lock'" @click.stop="scene.updateLayer(layer.id, { locked: !layer.locked })">{{ layer.locked ? '🔒' : '🔓' }}</button>
          <button class="icon" title="Duplicate" @click.stop="scene.duplicateLayer(layer.id)">⧉</button>
          <input class="color-pick" type="color" :value="labelHex(layer.colorLabel)" title="Layer color label" @change="setColor(layer, $event.target.value)" />
          <button class="icon danger" title="Delete (to trash)" @click.stop="scene.deleteLayer(layer.id)">🗑</button>
        </div>
      </div>
      <div v-if="!scene.layers.length" class="empty muted">
        No layers yet. Drag files here, use “Add media”, or paste a URL.
      </div>
      <div v-else-if="!visibleList.length" class="empty muted">No layers match the filter.</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { COLOR_LABELS } from '@shared/schema.js'

const scene = useSceneStore()
const search = ref('')
const folderFilter = ref('')
const dragFromIdx = ref(null)

const visibleList = computed(() => {
  // Top of list = front (highest order), like most layer panels.
  let list = [...scene.layers].sort((a, b) => (b.order || 0) - (a.order || 0))
  if (folderFilter.value) {
    list = list.filter((l) => folderFilter.value === '__none' ? !l.folder : l.folder === folderFilter.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter((l) => l.name.toLowerCase().includes(q) || l.type.includes(q))
  return list
})

function labelColor(id) {
  const c = COLOR_LABELS.find((x) => x.id === id)
  return c && c.color !== 'transparent' ? c.color : 'transparent'
}
function labelHex(id) {
  // <input type=color> needs a hex value; map label id -> hex.
  const c = COLOR_LABELS.find((x) => x.id === id)
  return c && /^#/.test(c.color) ? c.color : '#888888'
}
function setColor(layer, hex) {
  const match = COLOR_LABELS.find((x) => x.color.toLowerCase() === hex.toLowerCase())
  scene.updateLayer(layer.id, { colorLabel: match ? match.id : 'none' })
}

// Reorder via up/down buttons (reliable) + drag-and-drop (fast).
function orderIdsAfter() {
  return [...scene.layers].sort((a, b) => (a.order || 0) - (b.order || 0)).map((l) => l.id)
}
function moveUp(idx) {
  // visibleList is front-first; up = towards front = higher index in orderIds.
  const ids = visibleList.value.map((l) => l.id)
  if (idx <= 0) return
  ;[ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
  scene.reorder(ids)
}
function moveDown(idx) {
  const ids = visibleList.value.map((l) => l.id)
  if (idx >= ids.length - 1) return
  ;[ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]]
  scene.reorder(ids)
}
function onDragStart(idx) { dragFromIdx.value = idx }
function onDrop(targetIdx) {
  const from = dragFromIdx.value
  dragFromIdx.value = null
  if (from === null || from === targetIdx) return
  const ids = visibleList.value.map((l) => l.id)
  const [moved] = ids.splice(from, 1)
  ids.splice(targetIdx, 0, moved)
  scene.reorder(ids)
}
</script>

<style scoped>
.layers {
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  padding: 8px 12px;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}
.controls { padding: 8px; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); }
.search, .folder-sel { width: 100%; font-size: 12px; }
.list { overflow-y: auto; flex: 1; }
.item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  position: relative;
}
.item:hover { background: var(--bg-2); }
.item.selected { background: var(--bg-3); }
.item.locked .name { opacity: .6; }
.swatch { width: 4px; align-self: stretch; border-radius: 2px; min-height: 18px; }
.name { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.type { font-size: 10px; text-transform: uppercase; }
.row-actions { display: none; gap: 2px; align-items: center; }
.item:hover .row-actions, .item.selected .row-actions { display: flex; }
.icon {
  padding: 2px 4px; font-size: 12px;
  background: transparent; border: none; border-radius: 4px;
}
.icon:hover { background: var(--bg-3); }
.icon.on { color: var(--ok); }
.color-pick { width: 16px; height: 18px; padding: 0; border: none; background: none; cursor: pointer; }
.empty { padding: 16px; font-size: 13px; }
</style>
