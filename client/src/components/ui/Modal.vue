<!--
  Modal.vue — Fluent confirmation / prompt dialog (Phase 2).
  Closes on Escape or backdrop via Dialog.
-->
<template>
  <Dialog
    :open="open"
    :title="title"
    @update:open="(v) => { if (!v) $emit('cancel') }"
  >
    <slot>
      <p v-if="message" class="msg">{{ message }}</p>
    </slot>
    <template #footer>
      <slot name="footer">
        <Button variant="secondary" @click="$emit('cancel')">{{ cancelLabel || 'Cancel' }}</Button>
        <Button
          :variant="confirmClass === 'danger' ? 'destructive' : 'default'"
          @click="$emit('confirm')"
        >{{ confirmLabel || 'OK' }}</Button>
      </slot>
    </template>
  </Dialog>
</template>

<script setup>
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'OK' },
  cancelLabel: { type: String, default: 'Cancel' },
  confirmClass: { type: String, default: 'primary' }
})
defineEmits(['confirm', 'cancel'])
</script>

<style scoped>
.msg { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-dim); }
</style>
