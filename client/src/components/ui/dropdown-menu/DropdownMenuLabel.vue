<script setup>
import { DropdownMenuLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined }
})
</script>

<template>
  <DropdownMenuLabel :class="cn('px-2 py-1.5 text-xs font-semibold text-[var(--text-dim)]', props.class)">
    <slot />
  </DropdownMenuLabel>
</template>
