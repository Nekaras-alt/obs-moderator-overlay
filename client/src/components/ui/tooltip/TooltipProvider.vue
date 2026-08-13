<script setup>
import { TooltipProvider } from 'reka-ui'

defineProps({
  delayDuration: { type: Number, default: 300 },
  skipDelayDuration: { type: Number, default: 100 },
  disableHoverableContent: { type: Boolean, default: false }
})
</script>

<template>
  <TooltipProvider
    :delay-duration="delayDuration"
    :skip-delay-duration="skipDelayDuration"
    :disable-hoverable-content="disableHoverableContent"
  >
    <slot />
  </TooltipProvider>
</template>
