<script setup>
import { computed } from 'vue'
import {
  Copy, Trash2, Lock, Unlock, Eye, EyeOff, Globe,
  ArrowUpToLine, ArrowDownToLine, Pencil, ClipboardCopy, Maximize2, Ratio
} from '@lucide/vue'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuCheckboxItem, ContextMenuSeparator
} from '@/components/ui/context-menu'
import { useSceneStore } from '@/stores/scene.js'
import { useI18n } from '@/i18n'

const props = defineProps({
  layer: { type: Object, required: true },
  /** Optional: fit media to natural aspect (Canvas wires this). */
  onFitAspect: { type: Function, default: null },
  /** When true, render slot only (OBS / non-interactive). */
  disabled: { type: Boolean, default: false }
})

const scene = useSceneStore()
const { t } = useI18n()

const locked = computed(() => !!props.layer?.locked)
const canFit = computed(() => {
  const ty = props.layer?.type
  return ty === 'image' || ty === 'gif' || ty === 'emote' || ty === 'video' || ty === 'youtube'
})
const canAspect = computed(() => canFit.value)
const aspectOn = computed(() => props.layer?.maintainRatio !== false)

function bringFront() {
  const ids = [...scene.layers].sort((a, b) => (a.order || 0) - (b.order || 0)).map((l) => l.id)
  const i = ids.indexOf(props.layer.id)
  if (i < 0) return
  ids.splice(i, 1)
  ids.push(props.layer.id)
  scene.reorder(ids)
}

function sendBack() {
  const ids = [...scene.layers].sort((a, b) => (a.order || 0) - (b.order || 0)).map((l) => l.id)
  const i = ids.indexOf(props.layer.id)
  if (i < 0) return
  ids.splice(i, 1)
  ids.unshift(props.layer.id)
  scene.reorder(ids)
}

function rename() {
  const cur = props.layer.name || ''
  const next = window.prompt(t('ctx.renamePrompt'), cur)
  if (next == null) return
  const name = String(next).trim()
  if (!name || name === cur) return
  scene.updateLayer(props.layer.id, { name })
}

async function copyId() {
  try {
    await navigator.clipboard.writeText(String(props.layer.id || ''))
  } catch (_) { /* ignore */ }
}

function fitAspect() {
  if (typeof props.onFitAspect === 'function') props.onFitAspect(props.layer)
}

async function setAspectRatio(on) {
  const next = !!on
  await scene.updateLayer(props.layer.id, { maintainRatio: next })
  // When enabling, snap the box to natural media aspect so the frame matches.
  if (next && typeof props.onFitAspect === 'function') {
    props.onFitAspect(props.layer)
  }
}
</script>

<template>
  <slot v-if="disabled" />
  <ContextMenu v-else>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @select="scene.select(layer.id); rename()">
        <Pencil /> {{ t('ctx.rename') }}
      </ContextMenuItem>
      <ContextMenuItem @select="scene.select(layer.id); scene.duplicateLayer(layer.id)">
        <Copy /> {{ t('ctx.duplicate') }}
      </ContextMenuItem>
      <ContextMenuItem @select="copyId">
        <ClipboardCopy /> {{ t('ctx.copyId') }}
      </ContextMenuItem>
      <ContextMenuCheckboxItem
        v-if="canAspect"
        :checked="aspectOn"
        @update:checked="(v) => { scene.select(layer.id); setAspectRatio(v) }"
      >
        <Ratio /> {{ t('ctx.aspectRatio') }}
      </ContextMenuCheckboxItem>
      <ContextMenuItem v-if="canFit && onFitAspect" @select="scene.select(layer.id); fitAspect()">
        <Maximize2 /> {{ t('ctx.fitAspect') }}
      </ContextMenuItem>
      <ContextMenuItem @select="scene.updateLayer(layer.id, { locked: !locked })">
        <Lock v-if="!locked" />
        <Unlock v-else />
        {{ locked ? t('ctx.unlock') : t('ctx.lock') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="scene.updateLayer(layer.id, { visible: layer.visible === false })">
        <Eye v-if="layer.visible === false" />
        <EyeOff v-else />
        {{ layer.visible === false ? t('ctx.showEditor') : t('ctx.hideEditor') }}
      </ContextMenuItem>
      <ContextMenuItem @select="scene.updateLayer(layer.id, { audienceVisible: !layer.audienceVisible })">
        <Globe />
        {{ layer.audienceVisible ? t('ctx.hideAudience') : t('ctx.showAudience') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="bringFront">
        <ArrowUpToLine /> {{ t('ctx.bringFront') }}
      </ContextMenuItem>
      <ContextMenuItem @select="sendBack">
        <ArrowDownToLine /> {{ t('ctx.sendBack') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem destructive @select="scene.deleteLayer(layer.id)">
        <Trash2 /> {{ t('ctx.delete') }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
