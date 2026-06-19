<!--
  ObsView.vue
  The OBS Browser-Source target. Transparent background, renders only
  audience-visible layers at exactly 1920x1080 (set Browser Source to 1920x1080).
  Media transport (play/pause/seek) issued by the moderator mirrors here via the
  media-ctrl channel so the stream follows the editor.
-->
<template>
  <div class="obs-root">
    <StageRenderer :layers="scene.layers" mode="obs" :scale="1" :media-ctrl="scene.mediaCtrl" />
    <div v-if="!scene.connected" class="connecting">Connecting to server…</div>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import StageRenderer from '../StageRenderer.vue'

const scene = useSceneStore()

onMounted(async () => {
  const params = new URLSearchParams(location.search)
  let token = params.get('t')
  if (!token) {
    const r = await fetch('/api/viewer-token').then((x) => x.json()).catch(() => null)
    token = r?.token
  }
  if (token) scene.connect(token)
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
  background: rgba(0,0,0,.6);
  color: #fff;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
}
</style>
