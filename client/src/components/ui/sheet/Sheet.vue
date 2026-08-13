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
  side: { type: String, default: 'right' }
})
defineEmits(['update:open'])
</script>

<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[180] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogContent
        :class="cn(
          'fixed z-[190] flex flex-col border border-[var(--border)] bg-[var(--fluent-acrylic)] backdrop-blur-xl shadow-[var(--fluent-elevation)] outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          side === 'right'
            ? 'inset-y-0 right-0 h-full w-[min(360px,92vw)] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
            : 'inset-y-0 left-0 h-full w-[min(320px,92vw)] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left'
        )"
      >
        <div class="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <div class="min-w-0">
            <DialogTitle class="truncate text-sm font-semibold">{{ title }}</DialogTitle>
            <DialogDescription v-if="description" class="text-xs text-[var(--text-dim)]">
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
