<script setup>
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  loop: { type: Boolean, default: true }
})
</script>

<template>
  <TabsList
    :loop="loop"
    :class="cn(
      'inline-flex w-full shrink-0 items-center gap-1 border-b border-[var(--fluent-stroke)] bg-transparent px-2.5 py-2',
      props.class
    )"
  >
    <slot />
  </TabsList>
</template>
