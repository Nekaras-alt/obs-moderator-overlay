<!--
  YoutubeSettings.vue
  Non-transport settings for a YouTube layer. Transport lives in YoutubePlayer
  (floating YoutubeManager). Fields persist on layer.youtube / src / video.
-->
<template>
  <fieldset v-if="layer?.type === 'youtube'" class="yt-settings">
    <legend>YouTube</legend>

    <label class="field">
      Video URL / ID
      <input
        type="text"
        :value="layer.src"
        @change="scene.updateLayer(layer.id, { src: $event.target.value })"
      />
    </label>

    <label class="field">
      Start at (seconds)
      <input
        type="number"
        min="0"
        step="1"
        :value="yt.startAt"
        @change="setYt('startAt', +$event.target.value)"
      />
    </label>

    <label class="field">
      Sync mode
      <select :value="syncMode" @change="setYt('syncMode', $event.target.value)">
        <option value="serverClock">Server clock (recommended)</option>
        <option value="moderatorMaster">Moderator master</option>
        <option value="legacy">Legacy commands</option>
      </select>
    </label>

    <label class="field">
      Editor preview audio
      <select :value="previewAudio" @change="setYt('previewAudio', $event.target.value)">
        <option value="muted">Muted on canvas (sound in OBS only)</option>
        <option value="sound">Sound on canvas too</option>
      </select>
    </label>

    <label class="row">
      <input
        type="checkbox"
        :checked="layer.video?.muted"
        @change="scene.updateLayer(layer.id, { video: { ...layer.video, muted: $event.target.checked } })"
      />
      <span>Muted (OBS)</span>
    </label>

    <label class="row">
      <input type="checkbox" :checked="yt.autoHide" @change="setYt('autoHide', $event.target.checked)" />
      <span>Auto-hide from audience when finished</span>
    </label>

    <label class="row">
      <input type="checkbox" :checked="yt.preload !== false" @change="setYt('preload', $event.target.checked)" />
      <span>Buffer on add (smooth first play)</span>
    </label>

    <label class="field">
      Playlist IDs (comma-separated)
      <input
        type="text"
        :value="(yt.playlist || []).join(', ')"
        @change="setYt('playlist', $event.target.value.split(',').map((s) => s.trim()).filter(Boolean))"
      />
    </label>

    <p class="hint muted">Transport (play/pause/seek/stop/volume/speed) is in the floating YouTube player window.</p>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { normalizeSyncMode } from '../../features/ytTimeline.js'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

const yt = computed(() => props.layer?.youtube || {})
const syncMode = computed(() => normalizeSyncMode(yt.value.syncMode))
const previewAudio = computed(() => (yt.value.previewAudio === 'sound' ? 'sound' : 'muted'))

function setYt(key, value) {
  const next = { ...yt.value, [key]: value }
  if (key === 'syncMode') next.syncMode = normalizeSyncMode(value)
  scene.updateLayer(props.layer.id, { youtube: next })
}
</script>

<style scoped>
/* Self-contained layout: parent inspector styles do not pierce into this SFC. */
.yt-settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  border: 1px solid var(--fluent-stroke, var(--border));
  border-radius: 8px;
  padding: 10px 12px;
  margin: 0;
  background: color-mix(in srgb, var(--bg-3) 35%, transparent);
  box-sizing: border-box;
}
.yt-settings legend {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  padding: 0 4px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
}
.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: var(--text);
}
.row input[type='checkbox'] {
  flex: none;
  width: auto;
  margin: 0;
}
.field input,
.field select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
}
.hint {
  margin: 0;
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-dim);
}
</style>
