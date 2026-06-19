<!--
  TrashPanel.vue (M6)
  Shows deleted layers in the trash, with restore and purge controls.
  Opened via the Layers panel or Toolbar. Layers can be individually
  restored back to the scene or the trash can be purged entirely.
-->
<template>
  <div class="trash-panel" v-if="open">
    <div class="trash-head">
      <span class="trash-title">🗑 Trash</span>
      <span class="badge" v-if="scene.trash.length">{{ scene.trash.length }}</span>
      <span class="spacer"></span>
      <button v-if="scene.trash.length" class="btn-sm danger" @click="onPurge" title="Permanently delete all trash">Purge all</button>
      <button class="btn-sm muted" @click="$emit('close')" title="Close">✕</button>
    </div>

    <div class="trash-list" v-if="scene.trash.length">
      <div v-for="item in sortedTrash" :key="item.id" class="trash-item">
        <div class="trash-info">
          <div class="trash-name">{{ item.name || 'Untitled' }}</div>
          <div class="trash-meta">
            <span>{{ item.type }}</span>
            <span class="muted">deleted {{ fmtTime(item.deletedAt) }}</span>
          </div>
        </div>
        <div class="trash-actions">
          <button class="btn-sm ok" @click="onRestore(item)" title="Restore to scene">↩ Restore</button>
        </div>
      </div>
    </div>
    <div v-else class="trash-empty muted">
      Trash is empty. Deleted layers appear here for recovery.
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

defineProps({ open: { type: Boolean, default: true } })
defineEmits(['close'])

const scene = useSceneStore()

const sortedTrash = computed(() =>
  [...scene.trash].sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
)

function fmtTime(ts) {
  if (!ts) return ''
  const ago = Date.now() - ts
  if (ago < 60000) return 'just now'
  if (ago < 3600000) return Math.floor(ago / 60000) + 'm ago'
  if (ago < 86400000) return Math.floor(ago / 3600000) + 'h ago'
  return Math.floor(ago / 86400000) + 'd ago'
}

async function onRestore(item) { await scene.restoreLayer(item.id) }

async function onPurge() {
  if (!confirm(`Permanently delete ${scene.trash.length} item(s)? This cannot be undone.`)) return
  await scene.purgeTrash()
}
</script>

<style scoped>
.trash-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 340px;
  max-height: calc(100vh - 100px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 98;
  overflow: hidden;
}
.trash-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.trash-title { font-weight: 600; }
.badge {
  background: var(--text-dim);
  color: var(--panel);
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 10px;
}
.spacer { flex: 1; }
.trash-list {
  overflow-y: auto;
  flex: 1;
}
.trash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.trash-item:hover { background: var(--hover); }
.trash-info { flex: 1; min-width: 0; }
.trash-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trash-meta { font-size: 11px; color: var(--text-dim); display: flex; gap: 6px; margin-top: 2px; }
.trash-actions { flex-shrink: 0; }
.trash-empty { padding: 24px 16px; text-align: center; font-size: 12px; }
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
.btn-sm.ok { border-color: var(--ok); color: var(--ok); }
.btn-sm.ok:hover { background: rgba(34,197,94,0.15); }
.btn-sm.danger { border-color: var(--danger); color: var(--danger); }
.btn-sm.danger:hover { background: rgba(239,68,68,0.15); }
</style>
