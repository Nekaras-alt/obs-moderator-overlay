<script setup>
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner
} from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  type: { type: String, default: 'hover' },
  dir: { type: String, default: undefined },
  scrollHideDelay: { type: Number, default: 600 }
})
</script>

<template>
  <ScrollAreaRoot
    :type="type"
    :dir="dir"
    :scroll-hide-delay="scrollHideDelay"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <ScrollAreaViewport class="h-full w-full rounded-[inherit]">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      orientation="vertical"
      class="flex touch-none select-none transition-colors h-full w-2 border-l border-l-transparent p-px"
    >
      <ScrollAreaThumb class="relative flex-1 rounded-full bg-[var(--fluent-stroke)]" />
    </ScrollAreaScrollbar>
    <ScrollAreaScrollbar
      orientation="horizontal"
      class="flex touch-none select-none transition-colors h-2 flex-col border-t border-t-transparent p-px"
    >
      <ScrollAreaThumb class="relative flex-1 rounded-full bg-[var(--fluent-stroke)]" />
    </ScrollAreaScrollbar>
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
