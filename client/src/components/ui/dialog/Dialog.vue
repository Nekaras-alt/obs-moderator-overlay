<script setup>
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose
} from 'reka-ui'
import { X } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  class: { type: [String, Array, Object], default: undefined },
  showClose: { type: Boolean, default: true }
})
defineEmits(['update:open'])
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[200] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        :class="cn(
          'fixed left-1/2 top-1/2 z-[210] flex w-[min(520px,92vw)] max-h-[min(90vh,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] shadow-[var(--fluent-elevation)] backdrop-blur-xl outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          $props.class
        )"
      >
        <div
          v-if="title || description || showClose || $slots.title"
          class="flex items-start gap-2 border-b border-[var(--border)] px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <DialogTitle v-if="title || $slots.title" class="text-sm font-semibold text-[var(--text)]">
              <slot name="title">{{ title }}</slot>
            </DialogTitle>
            <DialogDescription
              v-if="description || $slots.description"
              class="mt-0.5 text-xs text-[var(--text-dim)]"
            >
              <slot name="description">{{ description }}</slot>
            </DialogDescription>
          </div>
          <DialogClose v-if="showClose" as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" aria-label="Close">
              <X class="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>
        <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
          <slot />
        </div>
        <div v-if="$slots.footer" class="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
