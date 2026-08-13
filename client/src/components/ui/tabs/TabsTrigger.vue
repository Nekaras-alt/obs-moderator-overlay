<script setup>
import { TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  value: { type: [String, Number], required: true },
  disabled: { type: Boolean, default: false },
  class: { type: [String, Array, Object], default: undefined }
})
</script>

<template>
  <TabsTrigger
    :value="value"
    :disabled="disabled"
    :class="cn(
      'inline-flex flex-none items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2 py-1.5 text-xs font-medium text-[var(--text-dim)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fluent-accent)] disabled:pointer-events-none disabled:opacity-50 hover:bg-[var(--fluent-reveal)] hover:text-[var(--text)] data-[state=active]:border-[color-mix(in_srgb,var(--fluent-accent)_40%,transparent)] data-[state=active]:bg-[color-mix(in_srgb,var(--fluent-accent)_18%,transparent)] data-[state=active]:text-[var(--text)]',
      props.class
    )"
  >
    <slot />
  </TabsTrigger>
</template>
