<script setup>
import { computed } from 'vue'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const props = defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'default' },
  class: { type: [String, Array, Object], default: undefined },
  disabled: { type: Boolean, default: false },
  type: { type: String, default: 'button' }
})

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-[background,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fluent-accent)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-[var(--fluent-accent)] text-white border border-transparent hover:bg-[var(--fluent-accent-hover)]',
        secondary: 'bg-[var(--bg-3)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--fluent-reveal)]',
        ghost: 'bg-transparent border border-transparent text-[var(--text)] hover:bg-[var(--fluent-reveal)]',
        outline: 'bg-transparent border border-[var(--border)] text-[var(--text)] hover:bg-[var(--fluent-reveal)]',
        destructive: 'bg-transparent text-[var(--danger)] border border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_15%,transparent)]',
        accent: 'bg-[var(--fluent-accent)] text-white border border-[var(--fluent-accent)]'
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 rounded px-2 text-xs',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8 p-0'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

const classes = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size }), props.class))
</script>

<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
