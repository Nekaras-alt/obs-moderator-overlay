<!--
  PresetPanel.vue (M6)
  Save and load scene presets. Fluent chrome (Phase 2).
-->
<template>
  <div class="preset-panel" v-if="open">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <LayoutTemplate class="h-4 w-4" />
        Presets
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" title="Close" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>
    <div class="preset-save">
      <Input v-model="newName" placeholder="Preset name..." @keydown.enter="onSave" />
      <Button size="sm" :disabled="!newName.trim()" @click="onSave">Save current</Button>
    </div>
    <div class="preset-list list-stagger" v-if="scene.presets.length">
      <ContextMenu v-for="p in scene.presets" :key="p.id">
        <ContextMenuTrigger as-child>
          <div class="preset-item">
            <div class="preset-info">
              <span class="preset-name">{{ p.name }}</span>
              <span class="preset-meta muted">{{ (p.snapshot || []).length }} layers</span>
            </div>
            <div class="preset-actions">
              <Button size="sm" variant="secondary" title="Load this preset" @click="onLoad(p)">Load</Button>
              <Button size="icon" variant="destructive" class="h-7 w-7" title="Delete preset" @click="onDelete(p)">
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @select="onLoad(p)">
            <FolderOpen /> {{ t('ctx.load') }}
          </ContextMenuItem>
          <ContextMenuItem destructive @select="onDelete(p)">
            <Trash2 /> {{ t('ctx.delete') }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
    <div v-else class="preset-empty muted">
      No presets saved yet. Name the current arrangement and click Save.
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { LayoutTemplate, Trash2, X, FolderOpen } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'

defineProps({ open: { type: Boolean, default: true } })
defineEmits(['close'])

const scene = useSceneStore()
const { t } = useI18n()
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
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 99;
  overflow: hidden;
}
.preset-save {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--fluent-stroke);
}
.preset-list { overflow-y: auto; flex: 1; }
.preset-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--fluent-stroke);
  transition: background 0.15s;
}
.preset-item:hover { background: var(--fluent-reveal); }
.preset-info { flex: 1; min-width: 0; }
.preset-name { font-size: 13px; font-weight: 500; }
.preset-meta { font-size: 11px; }
.preset-actions { display: flex; gap: 4px; flex-shrink: 0; }
.preset-empty {
  padding: 24px 16px;
  text-align: center;
  font-size: 12px;
}
</style>
