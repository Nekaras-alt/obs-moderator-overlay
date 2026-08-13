<!--
  TrashPanel.vue (M6)
  Deleted layers with restore/purge. Fluent chrome (Phase 2).
-->
<template>
  <div class="trash-panel" v-if="open">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Trash2 class="h-4 w-4" />
        {{ t('panel.trash') }}
      </span>
      <Badge v-if="scene.trash.length" variant="secondary">{{ scene.trash.length }}</Badge>
      <span class="spacer"></span>
      <Button
        v-if="scene.trash.length"
        size="sm"
        variant="destructive"
        title="Permanently delete all trash"
        @click="onPurge"
      >Purge all</Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('common.close')" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="trash-list" v-if="scene.trash.length">
      <ContextMenu v-for="item in sortedTrash" :key="item.id">
        <ContextMenuTrigger as-child>
          <div class="trash-item">
            <div class="trash-info">
              <div class="trash-name">{{ item.name || 'Untitled' }}</div>
              <div class="trash-meta">
                <span>{{ item.type }}</span>
                <span class="muted">deleted {{ fmtTime(item.deletedAt) }}</span>
              </div>
            </div>
            <div class="trash-actions">
              <Button size="sm" variant="secondary" title="Restore to scene" @click="onRestore(item)">
                <RotateCcw class="h-3.5 w-3.5" />
                Restore
              </Button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @select="onRestore(item)">
            <RotateCcw /> {{ t('ctx.restore') }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
    <div v-else class="trash-empty muted">
      Trash is empty. Deleted layers appear here for recovery.
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Trash2, X, RotateCcw } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'

const { t } = useI18n()

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
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 98;
  overflow: hidden;
}
.trash-list { overflow-y: auto; flex: 1; }
.trash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--fluent-stroke);
  transition: background 0.15s;
}
.trash-item:hover { background: var(--fluent-reveal); }
.trash-info { flex: 1; min-width: 0; }
.trash-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trash-meta {
  font-size: 11px;
  color: var(--text-dim);
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.trash-actions { flex-shrink: 0; }
.trash-empty { padding: 24px 16px; text-align: center; font-size: 12px; }
</style>
