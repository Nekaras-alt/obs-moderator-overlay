<!--
  AudioControls.vue
  Audio layer controls: transport (play/pause/stop/rewind), volume, loop.
  Transport goes through the shared media-ctrl channel so the OBS stream
  mirrors play/pause/seek. Volume + loop are persisted on layer.audio and
  applied to the local element; the stream's loudness is governed by OBS.
-->
<template>
  <fieldset v-if="layer?.type === 'audio'">
    <legend>Audio</legend>

    <div class="transport">
      <button class="t-btn" :class="{ active: playing }" title="Play" @click="setPlaying(true)">▶</button>
      <button class="t-btn" title="Pause" @click="setPlaying(false)">❚❚</button>
      <button class="t-btn" title="Stop (pause + rewind)" @click="stop">■</button>
      <button class="t-btn" title="Rewind to start" @click="rewind">⏮</button>
    </div>

    <!-- Live readout from the on-card player. -->
    <div class="audio-readout muted small">
      {{ fmt(current) }} / {{ fmt(duration) }}
    </div>

    <label>Volume
      <input type="range" min="0" max="1" step="0.05" :value="a.volume"
             @input="setA('volume', +$event.target.value)" />
      <span class="muted small">{{ Math.round((a.volume ?? 1) * 100) }}%</span>
    </label>
    <label class="row">
      <input type="checkbox" :checked="a.loop" @change="setA('loop', $event.target.checked)" />
      <span>Loop</span>
    </label>
    <p class="hint muted small">Shown as a ♪ note card in the editor. Play/pause/seek mirror to the OBS stream; volume affects only your preview (the stream's level is set in OBS).</p>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const props = defineProps({ layer: Object })
const scene = useSceneStore()
const a = computed(() => props.layer?.audio || {})

// Live readout pushed up from the on-card audio player in StageRenderer.
const state = computed(() => scene.mediaState[props.layer.id] || {})
const current = computed(() => state.value.current || 0)
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => !!state.value.playing)

function setA(key, value) {
  scene.updateLayer(props.layer.id, { audio: { ...a.value, [key]: value } })
}

// Transport: transient commands fanned out via media-ctrl (not persisted).
function setPlaying(p) {
  scene.sendMediaCtrl(props.layer.id, { playing: p })
}
function stop() {
  scene.sendMediaCtrl(props.layer.id, { playing: false, seek: 0 })
}
function rewind() {
  scene.sendMediaCtrl(props.layer.id, { seek: 0 })
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
</script>
<style scoped>
.small { font-size: 10px; }
.hint { margin: 6px 0 0; line-height: 1.4; }
.transport { display: flex; gap: 6px; margin-bottom: 8px; }
.t-btn {
  flex: 1;
  padding: 6px 0;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.t-btn:hover { background: var(--bg-2); }
.t-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.audio-readout { font-variant-numeric: tabular-nums; margin-bottom: 8px; }
</style>
