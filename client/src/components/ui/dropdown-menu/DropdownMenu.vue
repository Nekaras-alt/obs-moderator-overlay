<script setup>
import { DropdownMenuRoot } from 'reka-ui'

defineProps({
  open: { type: Boolean, default: undefined }
})
defineEmits(['update:open'])
</script>

<template>
  <DropdownMenuRoot :open="open" @update:open="$emit('update:open', $event)">
    <slot />
  </DropdownMenuRoot>
</template>
