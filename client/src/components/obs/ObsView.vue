<!--
  ObsView.vue
  The OBS Browser-Source target. Transparent background, renders only
  audience-visible layers at exactly 1920x1080 (set Browser Source to 1920x1080).
  Media transport (play/pause/seek) issued by the moderator mirrors here via the
  media-ctrl / yt-timeline channels so the stream follows the editor.
-->
<template>
  <div class="obs-root">
    <StageRenderer :layers="scene.orderedLayers" mode="obs" :scale="1" :media-ctrl="scene.mediaCtrl" />
    <SoundPlayer />
    <div v-if="hud" class="hud" :class="hud.kind">{{ hud.text }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import StageRenderer from '../StageRenderer.vue'
import SoundPlayer from '../editor/SoundPlayer.vue'

const scene = useSceneStore()

const audienceOn = computed(() => scene.layers.filter((l) => l.audienceVisible).length)
const total = computed(() => scene.layers.length)

const hud = computed(() => {
  if (scene.lastError === 'Unauthorized') {
    return {
      kind: 'err',
      text: 'OMO: Unauthorized — в URL устаревший или чужой ?t=. Модератор: Connector → скопировать overlay заново → вставить в плагин → Refresh.'
    }
  }
  if (!scene.connected) {
    return {
      kind: 'warn',
      text: 'OMO: нет WebSocket. Проверьте Tailscale, Harden off, полный URL с ?t=.'
    }
  }
  if (total.value === 0) {
    return {
      kind: 'info',
      text: 'OMO: связь OK · сцена пустая.'
    }
  }
  if (audienceOn.value === 0) {
    return {
      kind: 'warn',
      text: `OMO: связь OK · слоёв ${total.value}, для аудитории 0 (зелёная рамка / «Показать аудитории»).`
    }
  }
  return null
})

onMounted(async () => {
  document.documentElement.classList.add('omo-obs-transparent')
  const params = new URLSearchParams(location.search)
  let token = params.get('t')
  if (!token) {
    const r = await fetch('/api/viewer-token').then((x) => x.json()).catch(() => null)
    token = r?.token
  }
  if (!token) {
    scene.lastError = 'Unauthorized'
    return
  }
  scene.connect(token)
})

onUnmounted(() => {
  document.documentElement.classList.remove('omo-obs-transparent')
})
</script>

<style scoped>
.obs-root {
  position: fixed;
  inset: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: transparent;
}
.hud {
  position: fixed;
  top: 12px;
  left: 12px;
  max-width: 980px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font: 600 18px/1.35 system-ui, Segoe UI, sans-serif;
  padding: 10px 14px;
  border-radius: 6px;
  pointer-events: none;
  z-index: 9999;
  white-space: pre-wrap;
}
.hud.err { border-left: 4px solid #ef4444; }
.hud.warn { border-left: 4px solid #febc2e; }
.hud.info { border-left: 4px solid #28c840; }
</style>
