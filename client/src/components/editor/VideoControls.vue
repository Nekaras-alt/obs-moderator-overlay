<!--
  VideoControls.vue (M3)
  Playback controls for video layers. Fluent transport chrome (Phase 2).
-->
<template>
  <fieldset v-if="layer?.type === 'video'" class="fluent-fieldset">
    <legend>Video playback</legend>

    <div class="transport fluent-transport">
      <Button
        size="icon"
        class="h-8 w-8"
        :variant="playing ? 'default' : 'secondary'"
        :title="playing ? 'Pause' : 'Play'"
        @click="togglePlay"
      >
        <Pause v-if="playing" class="h-4 w-4" />
        <Play v-else class="h-4 w-4" />
      </Button>
      <span class="t-time">{{ fmt(current) }}</span>
      <div class="t-seek fluent-seek" ref="seekBar" @click="onSeek">
        <div class="t-progress" :style="{ width: pct + '%' }"></div>
      </div>
      <span class="t-time muted">{{ fmt(duration) }}</span>
    </div>
    <div class="t-row">
      <Button size="sm" variant="secondary" title="Rewind to start" @click="rewind">
        <SkipBack class="h-3.5 w-3.5" /> Rewind
      </Button>
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
      <Button size="sm" variant="outline" @click="setV('fragment', null)">Clear fragment</Button>
    </div>
    <div v-else class="fragment">
      <span class="muted small">No fragment set. Set in/out in the video element.</span>
      <Button size="sm" variant="outline" @click="setV('fragment', [0, 10])">Set 0–10s demo</Button>
    </div>

    <p class="hint muted small">Transport (play/pause/seek) mirrors live to the OBS stream. Volume here affects only your editor preview — the stream's audio level is set in OBS.</p>
  </fieldset>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Play, Pause, SkipBack } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { Button } from '@/components/ui/button'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

const v = computed(() => props.layer?.video || {})
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

const state = computed(() => scene.mediaState[props.layer.id] || {})
const current = computed(() => state.value.current || 0)
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => !!state.value.playing)
const pct = computed(() => duration.value ? Math.max(0, Math.min(100, (current.value / duration.value) * 100)) : 0)

const seekBar = ref(null)

function setV(key, value) {
  scene.updateLayer(props.layer.id, { video: { ...v.value, [key]: value } })
}

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
.t-row { display: flex; gap: 6px; margin-top: 6px; }
.t-time { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; }
.t-seek { flex: 1; }
label.row { flex-direction: row; align-items: center; gap: 8px; display: flex; }
</style>
