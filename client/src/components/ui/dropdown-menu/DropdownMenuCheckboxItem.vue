<script setup>
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator } from 'reka-ui'
import { Check } from '@lucide/vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  class: { type: [String, Array, Object], default: undefined },
  /** Bound checked state (maps to Reka modelValue). */
  checked: { type: [Boolean, String], default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:checked', 'select'])

function onModelUpdate(v) {
  emit('update:checked', v)
}
</script>

<template>
  <DropdownMenuCheckboxItem
    :model-value="checked"
    :disabled="disabled"
    :class="cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[highlighted]:bg-[var(--fluent-reveal)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      props.class
    )"
    @update:model-value="onModelUpdate"
    @select="emit('select', $event)"
  >
    <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuItemIndicator>
        <Check class="h-3.5 w-3.5" />
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
