<script setup>
import { Toggle } from 'reka-ui'
import { cva } from 'class-variance-authority'
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: [Boolean, null], default: undefined },
  defaultValue: { type: Boolean, default: undefined },
  disabled: { type: Boolean, default: false },
  pressed: { type: Boolean, default: undefined },
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'default' },
  class: { type: [String, Array, Object], default: undefined }
})
defineEmits(['update:modelValue', 'update:pressed'])

const toggleVariants = cva(
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
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

const classes = computed(() => cn(toggleVariants({ variant: props.variant, size: props.size }), props.class))
</script>

<template>
  <Toggle
    :pressed="pressed ?? modelValue"
    :default-value="defaultValue"
    :disabled="disabled"
    :class="classes"
    @update:pressed="(v) => { $emit('update:pressed', v); $emit('update:modelValue', v) }"
  >
    <slot />
  </Toggle>
</template>
