<!--
  Modal.vue
  Reusable confirmation / prompt dialog. Used by the preloading flow and chat
  add dialogs. Renders a centered card over a semi-transparent backdrop.
  Closes on Escape key or backdrop click.
-->
<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="$emit('cancel')">
      <div class="modal-card" @keydown.escape.stop="$emit('cancel')">
        <div v-if="title" class="modal-head">
          <span class="modal-title">{{ title }}</span>
        </div>
        <div class="modal-body">
          <slot>
            <p v-if="message">{{ message }}</p>
          </slot>
        </div>
        <div class="modal-footer">
          <slot name="footer">
            <button class="btn modal-cancel" @click="$emit('cancel')">{{ cancelLabel || 'Cancel' }}</button>
            <button class="btn modal-confirm" :class="confirmClass" @click="$emit('confirm')">{{ confirmLabel || 'OK' }}</button>
          </slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
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
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.modal-card {
  background: var(--panel, #1e1e2e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  min-width: 340px;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.2s ease;
}
@keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.modal-head {
  padding: 14px 18px 0;
  font-weight: 600;
  font-size: 15px;
}
.modal-title { color: var(--text, #eee); }
.modal-body {
  padding: 12px 18px;
  color: var(--text-dim, #aaa);
  font-size: 13px;
  line-height: 1.5;
}
.modal-body p { margin: 0; }
.modal-footer {
  padding: 0 18px 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  padding: 7px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--border, #333);
  background: var(--bg, #2a2a3a);
  color: var(--text, #eee);
  transition: background 0.15s;
}
.btn:hover { background: var(--hover, #3a3a4a); }
.btn.modal-cancel { background: transparent; }
.btn.modal-confirm.primary {
  background: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
  color: #fff;
}
.btn.modal-confirm.primary:hover { filter: brightness(1.1); }
.btn.modal-confirm.danger {
  background: var(--danger, #ef4444);
  border-color: var(--danger, #ef4444);
  color: #fff;
}
</style>
