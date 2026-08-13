<script setup>
import { ContextMenuPortal, ContextMenuContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  sideOffset: { type: Number, default: 4 }
})
</script>

<template>
  <ContextMenuPortal>
    <ContextMenuContent
      :side-offset="sideOffset"
      :class="cn(
        'z-[220] min-w-[200px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-[var(--fluent-elevation)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1',
        props.class
      )"
    >
      <slot />
    </ContextMenuContent>
  </ContextMenuPortal>
</template>
