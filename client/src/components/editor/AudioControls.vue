<!--
  AudioControls.vue
  Audio layer controls. Fluent transport chrome (Phase 2).
-->
<template>
  <fieldset v-if="layer?.type === 'audio'" class="fluent-fieldset">
    <legend>Audio</legend>

    <div class="transport fluent-transport">
      <Button size="icon" class="h-8 w-8" :variant="playing ? 'default' : 'secondary'" title="Play" @click="setPlaying(true)">
        <Play class="h-4 w-4" />
      </Button>
      <Button size="icon" class="h-8 w-8" variant="secondary" title="Pause" @click="setPlaying(false)">
        <Pause class="h-4 w-4" />
      </Button>
      <Button size="icon" class="h-8 w-8" variant="secondary" title="Stop (pause + rewind)" @click="stop">
        <Square class="h-4 w-4" />
      </Button>
      <Button size="icon" class="h-8 w-8" variant="secondary" title="Rewind to start" @click="rewind">
        <SkipBack class="h-4 w-4" />
      </Button>
    </div>

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
    <p class="hint muted small">Shown as a note card in the editor. Play/pause/seek mirror to the OBS stream; volume affects only your preview (the stream's level is set in OBS).</p>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue'
import { Play, Pause, Square, SkipBack } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { Button } from '@/components/ui/button'

const props = defineProps({ layer: Object })
const scene = useSceneStore()
const a = computed(() => props.layer?.audio || {})

const state = computed(() => scene.mediaState[props.layer.id] || {})
const current = computed(() => state.value.current || 0)
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => !!state.value.playing)

function setA(key, value) {
  scene.updateLayer(props.layer.id, { audio: { ...a.value, [key]: value } })
}

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
.audio-readout { font-variant-numeric: tabular-nums; margin-bottom: 8px; }
label.row { flex-direction: row; align-items: center; gap: 8px; display: flex; }
</style>
