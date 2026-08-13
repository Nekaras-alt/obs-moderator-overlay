<script setup>
import { Separator as SeparatorPrimitive } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  orientation: { type: String, default: 'horizontal' },
  decorative: { type: Boolean, default: true }
})

const classes = computed(() => cn(
  'shrink-0 bg-[var(--border)]',
  props.orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
  props.class
))
</script>

<template>
  <SeparatorPrimitive
    :decorative="decorative"
    :orientation="orientation"
    :class="classes"
  />
</template>
