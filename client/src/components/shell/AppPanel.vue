<script setup>
import { X, Pin } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  class: { type: [String, Array, Object], default: undefined },
  width: { type: String, default: '320px' },
  bodyClass: { type: [String, Array, Object], default: undefined },
  padded: { type: Boolean, default: true },
  closable: { type: Boolean, default: true },
  /** Optional panel id for pin prefs */
  panelId: { type: String, default: '' },
  pinned: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'toggle-pin'])

const { t } = useI18n()
</script>

<template>
  <Transition name="fluent-panel">
    <div
      v-if="open"
      role="dialog"
      :aria-label="title || 'Panel'"
      :class="cn(
        'fixed top-14 right-3 z-[99] flex max-h-[calc(100vh-100px)] flex-col overflow-hidden rounded-lg border border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] shadow-[var(--fluent-elevation)] backdrop-blur-xl',
        $props.class
      )"
      :style="{ width }"
    >
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <div
            v-if="title || $slots.title || $slots.actions"
            class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold text-[var(--text)]">
              <slot name="icon" />
              <slot name="title">{{ title }}</slot>
            </div>
            <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
              <slot name="actions" />
            </div>
            <Button v-if="closable" variant="ghost" size="icon" class="h-7 w-7 shrink-0" aria-label="Close" @click="emit('close')">
              <X class="h-4 w-4" />
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem v-if="panelId" @select="emit('toggle-pin')">
            <Pin /> {{ pinned ? t('ctx.unpin') : t('ctx.pin') }}
          </ContextMenuItem>
          <ContextMenuItem v-if="closable" @select="emit('close')">
            <X /> {{ t('ctx.close') }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div v-if="$slots.default" :class="cn('min-h-0 flex-1 overflow-auto', padded && 'p-3', bodyClass)">
        <slot />
      </div>
      <div v-if="$slots.footer" class="border-t border-[var(--border)] px-3 py-2">
        <slot name="footer" />
      </div>
    </div>
  </Transition>
</template>
