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
    <!-- Hidden SoundPad audio pool: plays reaction sounds on the stream
         when the moderator triggers a slot. -->
    <SoundPlayer />
    <div v-if="!scene.connected" class="connecting">Connecting to server…</div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import StageRenderer from '../StageRenderer.vue'
import SoundPlayer from '../editor/SoundPlayer.vue'

const scene = useSceneStore()

onMounted(async () => {
  document.documentElement.classList.add('omo-obs-transparent')
  const params = new URLSearchParams(location.search)
  let token = params.get('t')
  if (!token) {
    const r = await fetch('/api/viewer-token').then((x) => x.json()).catch(() => null)
    token = r?.token
  }
  if (token) scene.connect(token)
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
  background: transparent; /* critical: OBS composites this over the scene */
}
.connecting {
  position: fixed;
  top: 8px; left: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  pointer-events: none;
  opacity: 0.7;
}
</style>
