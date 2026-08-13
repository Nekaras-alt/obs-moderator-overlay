<script setup>
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  checked: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  name: { type: String, default: undefined },
  id: { type: String, default: undefined },
  class: { type: [String, Array, Object], default: undefined }
})
defineEmits(['update:checked'])
</script>

<template>
  <SwitchRoot
    :id="id"
    :model-value="checked"
    :disabled="disabled"
    :required="required"
    :name="name"
    :class="cn(
      'peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border border-[var(--fluent-stroke)] bg-[var(--bg-3)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fluent-accent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--fluent-accent)] data-[state=checked]:bg-[var(--fluent-accent)]',
      props.class
    )"
    @update:model-value="$emit('update:checked', $event === true)"
  >
    <SwitchThumb
      class="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
