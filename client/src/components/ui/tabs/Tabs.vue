<script setup>
import { TabsRoot } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  modelValue: { type: [String, Number], default: undefined },
  defaultValue: { type: [String, Number], default: undefined },
  orientation: { type: String, default: 'horizontal' },
  activationMode: { type: String, default: 'automatic' },
  class: { type: [String, Array, Object], default: undefined }
})
defineEmits(['update:modelValue'])
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    :default-value="defaultValue"
    :orientation="orientation"
    :activation-mode="activationMode"
    :class="cn('flex flex-col', props.class)"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <slot />
  </TabsRoot>
</template>
