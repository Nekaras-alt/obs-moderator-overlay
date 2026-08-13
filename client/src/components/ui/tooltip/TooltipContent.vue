<script setup>
import { TooltipPortal, TooltipContent, TooltipArrow } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  sideOffset: { type: Number, default: 4 },
  side: { type: String, default: 'top' },
  align: { type: String, default: 'center' },
  showArrow: { type: Boolean, default: true }
})
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      :side-offset="sideOffset"
      :side="side"
      :align="align"
      :class="cn(
        'z-[220] overflow-hidden rounded-md border border-[var(--fluent-stroke)] bg-[var(--bg-2)] px-2.5 py-1.5 text-xs text-[var(--text)] shadow-[var(--fluent-elevation)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        props.class
      )"
    >
      <slot />
      <TooltipArrow
        v-if="showArrow"
        class="fill-[var(--bg-2)] stroke-[var(--fluent-stroke)]"
        :width="10"
        :height="5"
      />
    </TooltipContent>
  </TooltipPortal>
</template>
