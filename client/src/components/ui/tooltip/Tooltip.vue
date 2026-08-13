<script setup>
import { TooltipRoot } from 'reka-ui'

defineProps({
  open: { type: Boolean, default: undefined },
  defaultOpen: { type: Boolean, default: false },
  delayDuration: { type: Number, default: undefined },
  disableHoverableContent: { type: Boolean, default: undefined }
})
defineEmits(['update:open'])
</script>

<template>
  <TooltipRoot
    :open="open"
    :default-open="defaultOpen"
    :delay-duration="delayDuration"
    :disable-hoverable-content="disableHoverableContent"
    @update:open="$emit('update:open', $event)"
  >
    <slot />
  </TooltipRoot>
</template>
