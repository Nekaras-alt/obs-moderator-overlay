<script setup>
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  variant: { type: String, default: 'default' }
})

const classes = computed(() => cn(
  'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
  props.variant === 'secondary'
    ? 'border-transparent bg-[var(--bg-3)] text-[var(--text-dim)]'
    : 'border-[var(--border)] bg-[var(--bg-2)] text-[var(--text)]',
  props.class
))
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
