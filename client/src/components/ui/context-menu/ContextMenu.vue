<script setup>
import { ContextMenuRoot } from 'reka-ui'
defineProps({ open: { type: Boolean, default: undefined } })
defineEmits(['update:open'])
</script>

<template>
  <ContextMenuRoot :open="open" @update:open="$emit('update:open', $event)">
    <slot />
  </ContextMenuRoot>
</template>
