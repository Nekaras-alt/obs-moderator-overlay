<!--
  Toolbar.vue
  Add media (drop zone, file picker, URL/YouTube paste), plus the global
  workspace toggles (grid, snap, theme) and quick actions. The overlay
  group opens the Presets / Trash / OBS / Settings panels (mutually
  exclusive, docked top-right by EditorView).
-->
<template>
  <div class="toolbar">
    <div class="brand">
      <span class="dot" :class="scene.connected ? 'on' : 'off'"></span>
      <span>OBS Overlay</span>
      <span v-if="scene.connected" class="muted small">{{ scene.layers.length }} layers</span>
    </div>

    <div class="group">
      <button @click="pickFiles" title="Add media files">＋ Add media</button>
      <input ref="fileInput" type="file" multiple accept="image/*,video/*,audio/*,.gif,.svg" hidden @change="onFiles" />
      <input
        v-model="urlInput"
        class="url"
        placeholder="Paste image / video / YouTube URL…"
        @keydown.enter="addFromUrl"
      />
      <button @click="addFromUrl">Add URL</button>
    </div>

    <!-- Layer-type shortcuts: text, stickers, temporary objects. -->
    <div class="group">
      <button @click="addText" title="Add a text layer">📝 Text</button>
      <button @click="$emit('toggle-panel', 'stickers')" title="Browse emotes from 7TV / BetterTTV / FrankerFaceZ">😀 Stickers</button>
      <button class="temp" @click="addTemporary" title="Add a temporary layer that auto-deletes">⏱ Temporary…</button>
    </div>

    <div class="group toggles">
      <button :class="{ active: s.gridEnabled }" @click="toggle('gridEnabled')" title="Grid">▦</button>
      <button :class="{ active: s.snapToGrid }" @click="toggle('snapToGrid')" title="Snap to grid">🧲 Grid</button>
      <button :class="{ active: s.snapToCenter }" @click="toggle('snapToCenter')" title="Snap to center">✛ Center</button>
      <button :class="{ active: s.snapToEdges }" @click="toggle('snapToEdges')" title="Snap to edges">⇄ Edges</button>
      <button :class="{ active: s.showDistances }" @click="toggle('showDistances')" title="Show distances">↔ Dist</button>
      <button :class="{ active: s.showRulers }" @click="toggle('showRulers')" title="Rulers">📏 Rulers</button>
      <button :class="{ active: s.showSafeArea }" @click="toggle('showSafeArea')" title="Safe area">▣ Safe</button>
      <button :class="{ active: s.showObsBounds }" @click="toggle('showObsBounds')" title="Show OBS source boundaries">⬚ OBS</button>
    </div>

    <!-- Overlay + workspace buttons -->
    <div class="group overlays">
      <button
        :class="{ active: panels.presets }"
        @click="$emit('toggle-panel', 'presets')"
        title="Save / load scene presets"
      >📋 Presets</button>
      <button
        :class="{ active: panels.trash }"
        @click="$emit('toggle-panel', 'trash')"
        title="Deleted layers (restore / purge)"
      >🗑 Trash<span v-if="trashCount" class="pill dim">{{ trashCount }}</span></button>
      <button
        :class="{ active: panels.obs }"
        @click="$emit('toggle-panel', 'obs')"
        title="OBS native sources & scenes (toggle visibility)"
      >⬚ OBS</button>
      <button
        :class="{ active: panels.settings }"
        @click="$emit('toggle-panel', 'settings')"
        title="OBS WebSocket & server settings"
      >⚙ Settings</button>
    </div>

    <div class="group right">
      <button @click="cycleTheme" :title="'Theme: ' + s.theme">{{ s.theme === 'dark' ? '🌙' : '☀' }}</button>
      <button @click="onSave" :disabled="saveBusy" :title="'Save scene to disk now'">
        {{ saveDone ? '✓ Saved' : '💾 Save' }}
      </button>
      <button class="danger" :disabled="!scene.layers.length" @click="clearAll" title="Clear workspace">Clear</button>
    </div>

    <div v-if="dnd.dragOver.value" class="drop-hint">Drop to add media</div>

    <!-- Temporary-object dialog: pick a TTL before staging the layer. -->
    <Modal
      :open="tempOpen"
      title="Add temporary layer"
      confirm-label="Add layer"
      :confirm-class="tempForm.ttl > 0 ? 'primary' : 'danger'"
      @confirm="commitTemporary"
      @cancel="tempOpen = false"
    >
      <div class="temp-form">
        <label>Type
          <select v-model="tempForm.type">
            <option value="text">Text</option>
            <option value="image">Image (drop URL after)</option>
          </select>
        </label>
        <div class="temp-presets">
          <button v-for="p in TTL_PRESETS" :key="p"
                  :class="{ active: tempForm.ttl === p }"
                  @click="tempForm.ttl = p">
            {{ p > 0 ? p + 's' : 'No limit' }}
          </button>
        </div>
        <label>Custom TTL (seconds, 0 = permanent)
          <input type="number" min="0" step="1" v-model.number="tempForm.ttl" />
        </label>
        <p class="hint muted small">
          The layer auto-deletes when its countdown hits zero. A red ⏱ badge on
          the stage shows the time left. You can cancel it any time from the
          layer's Properties panel.
        </p>
      </div>
    </Modal>

    <!-- Preloading confirmation: large uploads may stall a live stream. -->
    <Modal
      :open="dnd.preloadOpen.value"
      title="Large media — preload first?"
      :confirm-label="'Upload ' + dnd.humanSize(dnd.preloadTotal.value) + ' now'"
      confirm-class="primary"
      cancel-label="Skip these"
      @confirm="dnd.confirmPreload()"
      @cancel="dnd.cancelPreload()"
    >
      <div class="preload-form">
        <p>
          You're about to upload <strong>{{ dnd.preloadPending.value.length }}</strong>
          file(s) totalling <strong>{{ dnd.humanSize(dnd.preloadTotal.value) }}</strong>. Large
          files can briefly stall the OBS stream while they transfer.
        </p>
        <ul class="preload-list">
          <li v-for="(f, i) in dnd.preloadPending.value" :key="i">
            <span class="p-name">{{ f.name }}</span>
            <span class="p-size">{{ dnd.humanSize(f.size) }}</span>
          </li>
        </ul>
        <label class="row">
          <input type="checkbox" v-model="dnd.dontAskPreload.value" />
          <span>Don't warn me again this session</span>
        </label>
      </div>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, reactive, inject } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import Modal from '../ui/Modal.vue'

const props = defineProps({
  panels: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['toggle-panel'])

const scene = useSceneStore()
// Shared dnd instance owned by EditorView (covers the whole shell for drops).
// Toolbar still renders the preload confirmation Modal because it already owns
// Modal chrome and the file-picker button.
const dnd = inject('dnd')
const fileInput = ref(null)
const urlInput = ref('')
const saveDone = ref(false)
const saveBusy = ref(false)
let saveTimer = null

// Quick-pick layer adders.
async function addText() {
  await scene.addLayer({ type: 'text' })
}

// Temporary-object dialog state.
const tempOpen = ref(false)
const tempForm = reactive({ type: 'text', ttl: 30 })
const TTL_PRESETS = [10, 30, 60, 120, 0]
function addTemporary() {
  tempForm.type = 'text'
  tempForm.ttl = 30
  tempOpen.value = true
}
async function commitTemporary() {
  tempOpen.value = false
  const ttl = Math.max(0, Math.floor(tempForm.ttl || 0))
  await scene.addTemporaryLayer({ type: tempForm.type }, ttl)
}

const s = computed(() => scene.settings)
const trashCount = computed(() => scene.trash.length)

function pickFiles() { fileInput.value?.click() }

async function onFiles(e) {
  await dnd.addFilesFromInput(Array.from(e.target.files || []))
  e.target.value = ''
}

function addFromUrl() {
  const url = urlInput.value.trim()
  if (!url) return
  dnd.addUrl(url)
  urlInput.value = ''
}

function toggle(key) { scene.updateSettings({ [key]: !s.value[key] }) }
function cycleTheme() { scene.updateSettings({ theme: s.value.theme === 'dark' ? 'light' : 'dark' }) }

async function onSave() {
  if (saveBusy.value) return
  saveBusy.value = true
  try {
    const res = await scene.forceSave()
    if (res?.ok) {
      saveDone.value = true
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => (saveDone.value = false), 1500)
    }
  } finally {
    saveBusy.value = false
  }
}

async function clearAll() {
  if (!confirm('Move all layers to trash? You can restore them later.')) return
  await scene.clearWorkspace()
}
</script>

<style scoped>
.toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.dot.on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.dot.off { background: var(--danger); }
.small { font-size: 11px; font-weight: 400; }
.group { display: flex; gap: 6px; align-items: center; }
.group.right { margin-left: auto; }
.url { width: 240px; }
.toggles button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.overlays button { position: relative; }
.overlays button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.overlays button.active .pill { background: #fff; color: var(--accent); }
.pill {
  margin-left: 5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.pill.dim { background: var(--text-dim); color: var(--panel); }
.drop-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(59,130,246,.18);
  border: 2px dashed var(--accent);
  color: var(--text);
  font-weight: 600;
  pointer-events: none;
  z-index: 10;
}
.group button.temp {
  border-color: rgba(239, 68, 68, .5);
  color: #fca5a5;
}
.group button.temp:hover { background: rgba(239, 68, 68, .15); }

/* Temporary-object dialog form */
.temp-form { display: flex; flex-direction: column; gap: 12px; }
.temp-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.temp-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.temp-presets button {
  padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); cursor: pointer; font-size: 12px;
}
.temp-presets button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.temp-form .hint { margin: 0; line-height: 1.4; }
.temp-form .small { font-size: 11px; }

/* Preloading confirmation dialog */
.preload-form { display: flex; flex-direction: column; gap: 10px; }
.preload-form p { margin: 0; }
.preload-list {
  margin: 0; padding: 0; list-style: none;
  max-height: 140px; overflow-y: auto;
  border: 1px solid var(--border); border-radius: 6px;
}
.preload-list li {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 5px 10px; font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.preload-list li:last-child { border-bottom: none; }
.p-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p-size { flex: none; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.preload-form label.row { flex-direction: row; align-items: center; gap: 8px; font-size: 12px; }
</style>
