<!--
  PresetPanel.vue (M6)
  Save and load scene presets. The moderator can snapshot the current layer
  arrangement under a name, then restore it later. A quick way to switch
  between pre-built setups (e.g. "Starting Soon", "BRB", "Ending").
-->
<template>
  <div class="preset-panel" v-if="open">
    <div class="preset-head">
      <span class="preset-title">📋 Presets</span>
      <span class="spacer"></span>
      <button class="btn-sm" @click="$emit('close')" title="Close">✕</button>
    </div>
    <div class="preset-save">
      <input v-model="newName" placeholder="Preset name..." @keydown.enter="onSave" />
      <button class="btn-sm primary" @click="onSave" :disabled="!newName.trim()">Save current</button>
    </div>
    <div class="preset-list" v-if="scene.presets.length">
      <div v-for="p in scene.presets" :key="p.id" class="preset-item">
        <div class="preset-info">
          <span class="preset-name">{{ p.name }}</span>
          <span class="preset-meta muted">{{ (p.snapshot || []).length }} layers</span>
        </div>
        <div class="preset-actions">
          <button class="btn-sm primary" @click="onLoad(p)" title="Load this preset">Load</button>
          <button class="btn-sm danger" @click="onDelete(p)" title="Delete preset">🗑</button>
        </div>
      </div>
    </div>
    <div v-else class="preset-empty muted">
      No presets saved yet. Name the current arrangement and click Save.
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

defineProps({ open: { type: Boolean, default: true } })
defineEmits(['close'])

const scene = useSceneStore()
const newName = ref('')

async function onSave() {
  const name = newName.value.trim()
  if (!name) return
  await scene.savePreset(name)
  newName.value = ''
}

async function onLoad(p) {
  if (!confirm(`Load preset "${p.name}"? This replaces all current layers (they stay in trash).`)) return
  await scene.loadPreset(p.id)
}

async function onDelete(p) {
  if (!confirm(`Delete preset "${p.name}"?`)) return
  await scene.removePreset(p.id)
}
</script>

<style scoped>
.preset-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 320px;
  max-height: calc(100vh - 100px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 99;
  overflow: hidden;
}
.preset-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.preset-title { font-weight: 600; }
.spacer { flex: 1; }
.preset-save {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.preset-save input {
  flex: 1;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
.preset-list {
  overflow-y: auto;
  flex: 1;
}
.preset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.preset-item:hover { background: var(--hover); }
.preset-info { flex: 1; min-width: 0; }
.preset-name { font-size: 13px; font-weight: 500; }
.preset-meta { font-size: 11px; }
.preset-actions { display: flex; gap: 4px; flex-shrink: 0; }
.preset-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
}
.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.btn-sm:hover { background: var(--hover); }
.btn-sm.primary { border-color: var(--accent); color: var(--accent); }
.btn-sm.primary:hover { background: rgba(59,130,246,0.15); }
.btn-sm.danger { border-color: var(--danger); color: var(--danger); }
.btn-sm.danger:hover { background: rgba(239,68,68,0.15); }
</style>
