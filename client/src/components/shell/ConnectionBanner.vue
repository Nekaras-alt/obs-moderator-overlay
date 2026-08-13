<script setup>
import { WifiOff } from '@lucide/vue'
import { useSceneStore } from '@/stores/scene.js'
import { useI18n } from '@/i18n'

defineProps({
  serverOk: { type: Boolean, default: true }
})

const scene = useSceneStore()
const { t } = useI18n()
</script>

<template>
  <div
    v-if="!scene.connected || !serverOk"
    class="connection-banner"
    role="alert"
  >
    <WifiOff class="h-3.5 w-3.5 shrink-0" />
    <span>{{ !serverOk ? t('status.offline') : t('status.reconnecting') }}</span>
  </div>
</template>

<style scoped>
.connection-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: color-mix(in srgb, var(--danger) 88%, #000);
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 60%, transparent);
  flex-shrink: 0;
  z-index: 50;
}
</style>
