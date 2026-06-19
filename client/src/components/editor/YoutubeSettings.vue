<!--
  YoutubeSettings.vue
  Non-transport settings for a YouTube layer — the things you set up once when
  adding a clip, not while running it. Lives on the Properties panel (follows
  the selected layer), as opposed to YoutubeControls.vue which is the always-on
  transport surface living in the floating YoutubeManager windows.

  All fields patch the layer's `youtube` sub-object (or src / video.muted) and
  are persisted into scene.json. Transport is handled elsewhere.
-->
<template>
  <fieldset v-if="layer?.type === 'youtube'">
    <legend>YouTube</legend>

    <label>Video URL / ID
      <input :value="layer.src" @change="scene.updateLayer(layer.id, { src: $event.target.value })" />
    </label>

    <div class="grid2">
      <label>Start at (seconds)
        <input type="number" :value="yt.startAt" min="0" step="1"
               @change="setYt('startAt', +$event.target.value)" />
      </label>
      <label class="row keep-row">
        <input type="checkbox" :checked="layer.video?.muted"
               @change="scene.updateLayer(layer.id, { video: { ...layer.video, muted: $event.target.checked } })" />
        <span>Muted</span>
      </label>
    </div>

    <label class="row">
      <input type="checkbox" :checked="yt.autoHide" @change="setYt('autoHide', $event.target.checked)" />
      <span>Auto-hide when finished</span>
    </label>
    <label class="row">
      <input type="checkbox" :checked="yt.preload !== false" @change="setYt('preload', $event.target.checked)" />
      <span>Buffer on add (smooth first play)</span>
    </label>

    <label>Playlist IDs (comma-separated)
      <input :value="(yt.playlist || []).join(', ')"
             @change="setYt('playlist', $event.target.value.split(',').map((s) => s.trim()).filter(Boolean))" />
    </label>

    <p class="hint muted small">Transport (play/pause/seek/stop/volume/speed) is in the floating YouTube control window.</p>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

const yt = computed(() => props.layer?.youtube || {})

function setYt(key, value) {
  scene.updateLayer(props.layer.id, { youtube: { ...yt.value, [key]: value } })
}
</script>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.small { font-size: 10px; }
.hint { margin: 6px 0 0; line-height: 1.4; }
.keep-row { align-items: center; }
</style>
