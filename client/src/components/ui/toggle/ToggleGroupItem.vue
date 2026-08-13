<script setup>
import { ToggleGroupItem } from 'reka-ui'
import { cva } from 'class-variance-authority'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  value: { type: [String, Number], required: true },
  disabled: { type: Boolean, default: false },
  variant: { type: String, default: 'outline' },
  size: { type: String, default: 'sm' },
  class: { type: [String, Array, Object], default: undefined }
})

const itemVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fluent-accent)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent text-[var(--text)] hover:bg-[var(--fluent-reveal)] data-[state=on]:bg-[color-mix(in_srgb,var(--fluent-accent)_18%,transparent)] data-[state=on]:text-[var(--fluent-accent)]',
        outline: 'border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--fluent-reveal)] data-[state=on]:border-[var(--fluent-accent)] data-[state=on]:bg-[color-mix(in_srgb,var(--fluent-accent)_18%,transparent)] data-[state=on]:text-[var(--fluent-accent)]'
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2 text-xs',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8 p-0'
      }
    },
    defaultVariants: { variant: 'outline', size: 'sm' }
  }
)

const classes = computed(() => cn(itemVariants({ variant: props.variant, size: props.size }), props.class))
</script>

<template>
  <ToggleGroupItem :value="value" :disabled="disabled" :class="classes">
    <slot />
  </ToggleGroupItem>
</template>
