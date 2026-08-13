<script setup>
import { DropdownMenuItem } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  disabled: { type: Boolean, default: false },
  inset: { type: Boolean, default: false }
})
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    :class="cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-[var(--fluent-reveal)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
      inset && 'pl-8',
      props.class
    )"
  >
    <slot />
  </DropdownMenuItem>
</template>
