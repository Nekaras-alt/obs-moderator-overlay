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
      <input v-model="search" class="search" :placeholder="t('layers.search')" />
      <select v-model="folderFilter" class="folder-sel">
        <option value="">All folders</option>
        <option v-for="f in scene.folders" :key="f.id" :value="f.id">{{ f.name }}</option>
        <option value="__none">No folder</option>
      </select>
    </div>

    <div
      class="list list-stagger"
      role="listbox"
      aria-label="Layers"
      tabindex="0"
      @keydown="onListKey"
    >
      <LayerContextMenu
        v-for="(layer, idx) in visibleList"
        :key="layer.id"
        :layer="layer"
      >
        <div
          class="item"
          role="option"
          :aria-selected="layer.id === scene.selectedId"
          :tabindex="layer.id === scene.selectedId ? 0 : -1"
          :class="{ selected: layer.id === scene.selectedId, locked: layer.locked }"
          draggable="true"
          @click="scene.select(layer.id)"
          @keydown.enter.prevent="scene.select(layer.id)"
          @keydown.space.prevent="scene.select(layer.id)"
          @dragstart="onDragStart(idx, $event)"
          @dragover.prevent
          @drop.prevent="onDrop(idx)"
        >
        <span class="swatch" :style="{ background: labelColor(layer.colorLabel) }" :title="layer.colorLabel"></span>
        <div class="thumb" aria-hidden="true">
          <img v-if="thumbUrl(layer)" :src="thumbUrl(layer)" alt="" />
          <span v-else class="thumb-fallback">
            <component :is="typeIcon(layer.type)" class="h-3.5 w-3.5" />
          </span>
        </div>
        <button
          class="icon"
          :title="layer.visible === false ? 'Hidden in editor' : 'Visible in editor'"
          :aria-label="layer.visible === false ? 'Show in editor' : 'Hide in editor'"
          @click.stop="scene.updateLayer(layer.id, { visible: layer.visible === false })"
        >
          <EyeOff v-if="layer.visible === false" class="h-3.5 w-3.5" />
          <Eye v-else class="h-3.5 w-3.5" />
        </button>
        <button
          class="icon"
          :class="{ on: layer.audienceVisible }"
          :title="layer.audienceVisible ? 'Видно аудитории (OBS)' : 'Скрыто от аудитории — в OBS не видно'"
          :aria-label="layer.audienceVisible ? 'Скрыть от аудитории' : 'Показать аудитории'"
          @click.stop="scene.updateLayer(layer.id, { audienceVisible: !layer.audienceVisible })"
        >
          <Globe v-if="layer.audienceVisible" class="h-3.5 w-3.5" />
          <EyeOff v-else class="h-3.5 w-3.5" />
        </button>
        <span class="name" :title="layer.name">{{ layer.name }}</span>
        <span class="type muted">{{ layer.type }}</span>

        <div class="row-actions">
          <button class="icon" title="Move up" @click.stop="moveUp(idx)"><ChevronUp class="h-3.5 w-3.5" /></button>
          <button class="icon" title="Move down" @click.stop="moveDown(idx)"><ChevronDown class="h-3.5 w-3.5" /></button>
          <button class="icon" :title="layer.locked ? 'Unlock' : 'Lock'" @click.stop="scene.updateLayer(layer.id, { locked: !layer.locked })">
            <Lock v-if="layer.locked" class="h-3.5 w-3.5" />
            <Unlock v-else class="h-3.5 w-3.5" />
          </button>
          <button class="icon" title="Duplicate" @click.stop="scene.duplicateLayer(layer.id)"><Copy class="h-3.5 w-3.5" /></button>
          <input class="color-pick" type="color" :value="labelHex(layer.colorLabel)" title="Layer color label" @change="setColor(layer, $event.target.value)" />
          <button class="icon danger" title="Delete (to trash)" @click.stop="scene.deleteLayer(layer.id)"><Trash2 class="h-3.5 w-3.5" /></button>
        </div>
        </div>
      </LayerContextMenu>
      <EmptyState
        v-if="!scene.layers.length"
        variant="empty"
        :title="t('layers.empty')"
        class="!py-6"
      />
      <EmptyState
        v-else-if="!visibleList.length"
        variant="empty"
        :title="t('layers.noMatch')"
        class="!py-6"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Eye, EyeOff, Globe, Lock, Unlock, Copy, Trash2, ChevronUp, ChevronDown,
  Film, Music, TvMinimalPlay, Type, Globe2, MessageCircle, Megaphone, Smile, Box
} from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { COLOR_LABELS } from '@shared/schema.js'
import LayerContextMenu from '@/components/shell/LayerContextMenu.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useI18n } from '@/i18n'

const scene = useSceneStore()
const { t } = useI18n()
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

function thumbUrl(layer) {
  if (!layer) return ''
  if (['image', 'gif', 'emote'].includes(layer.type) && layer.src) return layer.src
  return ''
}
function typeIcon(type) {
  return ({
    video: Film,
    audio: Music,
    youtube: TvMinimalPlay,
    text: Type,
    browser: Globe2,
    chatis: MessageCircle,
    multiBrowser: Megaphone,
    emote: Smile
  })[type] || Box
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

function onListKey(e) {
  const list = visibleList.value
  if (!list.length) return
  const cur = list.findIndex((l) => l.id === scene.selectedId)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const next = e.key === 'ArrowDown'
      ? Math.min(list.length - 1, (cur < 0 ? 0 : cur + 1))
      : Math.max(0, (cur < 0 ? 0 : cur - 1))
    scene.select(list[next].id)
  } else if (e.key === 'Home') {
    e.preventDefault()
    scene.select(list[0].id)
  } else if (e.key === 'End') {
    e.preventDefault()
    scene.select(list[list.length - 1].id)
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (scene.selectedId) { e.preventDefault(); scene.deleteLayer(scene.selectedId) }
  }
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
.list {
  overflow-y: auto;
  flex: 1;
  scrollbar-width: none;
}
.list::-webkit-scrollbar { width: 0; height: 0; display: none; }
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
.item.selected {
  background: color-mix(in srgb, var(--fluent-accent) 16%, var(--bg-3));
  outline: 1px solid color-mix(in srgb, var(--fluent-accent) 40%, transparent);
}
.item:focus-visible {
  outline: 2px solid var(--fluent-accent);
  outline-offset: -2px;
}
.item.locked .name { opacity: .6; }
.swatch { width: 4px; align-self: stretch; border-radius: 2px; min-height: 18px; }
.thumb {
  width: 28px; height: 28px; border-radius: 4px; overflow: hidden;
  background: var(--bg-3); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb-fallback {
  font-size: 12px;
  opacity: .8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.name { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.type { font-size: 10px; text-transform: uppercase; }
.row-actions { display: none; gap: 2px; align-items: center; }
.item:hover .row-actions, .item.selected .row-actions { display: flex; }
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-dim);
  cursor: pointer;
}
.icon:hover { background: var(--fluent-reveal); color: var(--text); }
.icon.on { color: var(--ok); }
.icon.danger { color: var(--danger); }
.color-pick { width: 16px; height: 18px; padding: 0; border: none; background: none; cursor: pointer; }
.empty { padding: 16px; font-size: 13px; }
</style>
