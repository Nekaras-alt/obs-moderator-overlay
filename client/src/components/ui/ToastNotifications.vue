<!--
  ToastNotifications.vue
  Transient toasts for WS connection events. Fluent-styled (Phase 2).
-->
<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', t.type]"
        @click="dismiss(t.id)"
      >
        <AlertTriangle v-if="t.type === 'error'" class="toast-icon h-4 w-4" />
        <CheckCircle2 v-else-if="t.type === 'ok'" class="toast-icon h-4 w-4" />
        <Info v-else class="toast-icon h-4 w-4" />
        <span class="toast-msg">{{ t.msg }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { AlertTriangle, CheckCircle2, Info } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'

const scene = useSceneStore()
const toasts = ref([])
let toastId = 0
let wasConnected = false

function push(type, msg, timeout = 0) {
  const id = ++toastId
  toasts.value.push({ id, type, msg })
  if (timeout > 0) {
    setTimeout(() => dismiss(id), timeout)
  }
  return id
}

function dismiss(id) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

watch(() => scene.connected, (connected) => {
  if (connected && !wasConnected) {
    push('ok', 'Reconnected to server', 3000)
  } else if (!connected && wasConnected) {
    push('error', 'Connection lost — reconnecting…')
  }
  wasConnected = connected
})

onUnmounted(() => {
  toasts.value = []
})
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 500;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--fluent-elevation);
  border: 1px solid transparent;
  backdrop-filter: blur(12px);
  cursor: pointer;
  pointer-events: auto;
  white-space: nowrap;
}
.toast.error {
  background: color-mix(in srgb, var(--danger) 88%, transparent);
  border-color: color-mix(in srgb, var(--danger) 50%, white);
  color: #fff;
}
.toast.ok {
  background: color-mix(in srgb, var(--ok) 88%, transparent);
  border-color: color-mix(in srgb, var(--ok) 50%, white);
  color: #fff;
}
.toast.info {
  background: color-mix(in srgb, var(--fluent-accent) 88%, transparent);
  border-color: color-mix(in srgb, var(--fluent-accent) 50%, white);
  color: #fff;
}
.toast-icon { flex-shrink: 0; }

.toast-enter-active, .toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}
</style>
