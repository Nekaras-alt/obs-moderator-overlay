<script setup>
/**
 * Shared Fluent float window chrome (Phase 5B).
 * Draggable header + minimize/close; position via left/top style binding.
 * RMB on title → Reset / Minimize / Close. Drag only on primary button.
 */
import { Minus, Square, X, LocateFixed } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { isPrimaryButton } from '@/features/safeContextMenu.js'
import { useI18n } from '@/i18n'

defineProps({
  title: { type: String, default: '' },
  minimized: { type: Boolean, default: false },
  class: { type: [String, Array, Object], default: undefined },
  style: { type: [Object, String], default: undefined }
})
const emit = defineEmits(['close', 'toggle-minimize', 'drag-start', 'reset-position'])

const { t } = useI18n()

function onHeadMouseDown(e) {
  if (!isPrimaryButton(e)) return
  emit('drag-start', e)
}
</script>

<template>
  <div
    :class="cn('fluent-float', minimized && 'is-minimized', $props.class)"
    :style="style"
  >
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="fluent-float-head" @mousedown="onHeadMouseDown">
          <div class="fluent-float-title">
            <slot name="icon" />
            <slot name="title">{{ title }}</slot>
            <slot name="meta" />
          </div>
          <div class="fluent-float-actions" @mousedown.stop>
            <slot name="actions" />
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :title="minimized ? t('ctx.expand') : t('ctx.minimize')"
              @click.stop="emit('toggle-minimize')"
            >
              <Square v-if="minimized" class="h-3.5 w-3.5" />
              <Minus v-else class="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :title="t('ctx.close')"
              :aria-label="t('ctx.close')"
              @click.stop="emit('close')"
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem @select="emit('reset-position')">
          <LocateFixed /> {{ t('ctx.resetPosition') }}
        </ContextMenuItem>
        <ContextMenuItem @select="emit('toggle-minimize')">
          <Minus v-if="!minimized" />
          <Square v-else />
          {{ minimized ? t('ctx.expand') : t('ctx.minimize') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive @select="emit('close')">
          <X /> {{ t('ctx.close') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <div v-show="!minimized" class="fluent-float-body">
      <slot />
    </div>
    <slot name="resize" />
  </div>
</template>
