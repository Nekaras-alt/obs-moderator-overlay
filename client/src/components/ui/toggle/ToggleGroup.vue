<script setup>
import { ToggleGroupRoot } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  type: { type: String, default: 'single' },
  modelValue: { type: [String, Number, Array], default: undefined },
  defaultValue: { type: [String, Number, Array], default: undefined },
  disabled: { type: Boolean, default: false },
  orientation: { type: String, default: 'horizontal' },
  rovingFocus: { type: Boolean, default: true },
  loop: { type: Boolean, default: true },
  class: { type: [String, Array, Object], default: undefined }
})
defineEmits(['update:modelValue'])
</script>

<template>
  <ToggleGroupRoot
    :type="type"
    :model-value="modelValue"
    :default-value="defaultValue"
    :disabled="disabled"
    :orientation="orientation"
    :roving-focus="rovingFocus"
    :loop="loop"
    :class="cn('inline-flex items-center gap-1', props.class)"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <slot />
  </ToggleGroupRoot>
</template>
