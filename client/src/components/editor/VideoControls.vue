<!--
  VideoControls.vue (M3)
  Playback controls for video layers: transport bar (play/pause + scrub +
  time) wired through media-ctrl so the OBS stream mirrors transport, plus
  loop/autoplay/muted/speed/volume/fragment. Patches the layer's video
  sub-object for the persisted props; sends transient transport commands
  (play/pause/seek) that are NOT persisted.
-->
<template>
  <fieldset v-if="layer?.type === 'video'">
    <legend>Video playback</legend>

    <!-- Transport: play/pause + scrub + time. Synced to OBS via media-ctrl. -->
    <div class="transport">
      <button class="t-btn" :class="{ active: playing }" :title="playing ? 'Pause' : 'Play'" @click="togglePlay">
        {{ playing ? '❚❚' : '▶' }}
      </button>
      <span class="t-time">{{ fmt(current) }}</span>
      <div class="t-seek" ref="seekBar" @click="onSeek">
        <div class="t-progress" :style="{ width: pct + '%' }"></div>
      </div>
      <span class="t-time muted">{{ fmt(duration) }}</span>
    </div>
    <div class="t-row">
      <button class="t-btn small" title="Rewind to start" @click="rewind">⏮ Rewind</button>
    </div>

    <div class="ctrl-grid">
      <label class="row">
        <input type="checkbox" :checked="v.loop" @change="setV('loop', $event.target.checked)" />
        <span>Loop</span>
      </label>
      <label class="row">
        <input type="checkbox" :checked="v.autoplay" @change="setV('autoplay', $event.target.checked)" />
        <span>Auto-play</span>
      </label>
      <label class="row">
        <input type="checkbox" :checked="v.muted" @change="setV('muted', $event.target.checked)" />
        <span>Muted</span>
      </label>
      <label>Speed
        <select :value="v.speed" @change="setV('speed', +$event.target.value)">
          <option v-for="s in speeds" :key="s" :value="s">{{ s }}×</option>
        </select>
      </label>
      <label>Volume
        <input type="range" min="0" max="1" step="0.05" :value="v.volume"
               @input="setV('volume', +$event.target.value)" />
        <span class="muted small">{{ Math.round(v.volume * 100) }}%</span>
      </label>
    </div>

    <div class="fragment" v-if="v.fragment">
      <span class="muted small">Fragment: {{ fmtTime(v.fragment[0]) }} – {{ fmtTime(v.fragment[1]) }}</span>
      <button @click="setV('fragment', null)">Clear fragment</button>
    </div>
    <div v-else class="fragment">
      <span class="muted small">No fragment set. Set in/out in the video element.</span>
      <button @click="setV('fragment', [0, 10])">Set 0–10s demo</button>
    </div>

    <p class="hint muted small">Transport (play/pause/seek) mirrors live to the OBS stream. Volume here affects only your editor preview — the stream's audio level is set in OBS.</p>
  </fieldset>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

const v = computed(() => props.layer?.video || {})
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

// Live readout pushed up from StageRenderer (editor only).
const state = computed(() => scene.mediaState[props.layer.id] || {})
const current = computed(() => state.value.current || 0)
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => !!state.value.playing)
const pct = computed(() => duration.value ? Math.max(0, Math.min(100, (current.value / duration.value) * 100)) : 0)

const seekBar = ref(null)

function setV(key, value) {
  scene.updateLayer(props.layer.id, { video: { ...v.value, [key]: value } })
}

// Transport commands go through the shared media-ctrl channel so OBS mirrors
// them. They are transient — not persisted into scene.json.
function togglePlay() {
  scene.sendMediaCtrl(props.layer.id, { playing: !playing.value })
}
function rewind() {
  scene.sendMediaCtrl(props.layer.id, { seek: 0, playing: true })
}
function onSeek(e) {
  if (!duration.value) return
  const bar = seekBar.value
  if (!bar) return
  const rect = bar.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  scene.sendMediaCtrl(props.layer.id, { seek: ratio * duration.value })
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
function fmtTime(s) {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`
}
</script>

<style scoped>
.ctrl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.small { font-size: 10px; }
.hint { margin: 6px 0 0; line-height: 1.4; }
.fragment { margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.transport { display: flex; align-items: center; gap: 8px; }
.t-btn {
  flex: none;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.t-btn:hover { background: var(--bg-2); }
.t-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.t-btn.small { padding: 4px 8px; font-size: 12px; }
.t-row { display: flex; gap: 6px; margin-top: 6px; }
.t-time { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; }
.t-seek {
  flex: 1;
  height: 6px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.t-progress {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: var(--accent);
  border-radius: 3px;
}
</style>
