<script setup>
import { DropdownMenuSeparator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined }
})
</script>

<template>
  <DropdownMenuSeparator :class="cn('-mx-1 my-1 h-px bg-[var(--border)]', props.class)" />
</template>
