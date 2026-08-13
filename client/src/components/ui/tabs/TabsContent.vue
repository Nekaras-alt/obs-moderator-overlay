<script setup>
import { TabsContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  value: { type: [String, Number], required: true },
  forceMount: { type: Boolean, default: undefined },
  class: { type: [String, Array, Object], default: undefined }
})
</script>

<template>
  <TabsContent
    :value="value"
    :force-mount="forceMount"
    :class="cn(
      'min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--fluent-accent)] data-[state=inactive]:hidden',
      props.class
    )"
  >
    <slot />
  </TabsContent>
</template>
