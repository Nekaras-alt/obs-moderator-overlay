<script setup>
import { computed } from 'vue'
import { useSceneStore } from '@/stores/scene.js'
import { useI18n } from '@/i18n'

const props = defineProps({
  buildStamp: { type: String, default: '' }
})

const scene = useSceneStore()
const { t } = useI18n()

const isElectron = computed(() => {
  if (typeof navigator === 'undefined') return false
  return /Electron/i.test(navigator.userAgent)
})

const title = computed(() => {
  const base = t('app.title')
  return props.buildStamp ? `${base} · ${props.buildStamp}` : base
})
</script>

<template>
  <header
    v-if="isElectron"
    class="app-titlebar"
    role="banner"
    aria-label="Window title"
  >
    <div class="app-titlebar-drag">
      <span
        class="app-titlebar-dot"
        :class="scene.connected ? 'on' : 'off'"
        aria-hidden="true"
      />
      <span class="app-titlebar-title">{{ title }}</span>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  height: var(--titlebar-h, 36px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--fluent-acrylic);
  border-bottom: 1px solid var(--fluent-stroke);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  /* Leave room for Windows titleBarOverlay caption buttons */
  padding-right: 140px;
}
.app-titlebar-drag {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}
.app-titlebar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.app-titlebar-dot.on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.app-titlebar-dot.off { background: var(--danger); }
.app-titlebar-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
