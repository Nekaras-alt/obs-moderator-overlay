<!--
  YoutubePlayer.vue
  Moderator transport for a YouTube layer. Routes play/pause/seek/stop through
  the authoritative yt-timeline protocol (serverClock / moderatorMaster) or
  legacy media-ctrl when syncMode is legacy. Scrubber follows expected timeline
  time so the UI stays locked to the shared clock.
-->
<template>
  <fieldset v-if="layer?.type === 'youtube'" class="yt-player fluent-fieldset">
    <legend>YouTube player</legend>

    <div class="sync-row">
      <label class="sync-label">Sync
        <select :value="syncMode" @change="setSyncMode($event.target.value)">
          <option value="serverClock">Server clock</option>
          <option value="moderatorMaster">Moderator master</option>
          <option value="legacy">Legacy commands</option>
        </select>
      </label>
      <Badge :class="['sync-badge', syncBadgeClass]" :title="syncHint">{{ syncLabel }}</Badge>
    </div>

    <div class="fluent-transport btn-row">
      <Button size="sm" :variant="playing ? 'default' : 'secondary'" title="Play" @click="play">
        <Play class="h-3.5 w-3.5" /> Play
      </Button>
      <Button size="sm" :variant="!playing && touched ? 'default' : 'secondary'" title="Pause" @click="pause">
        <Pause class="h-3.5 w-3.5" /> Pause
      </Button>
      <Button size="sm" variant="secondary" title="Stop (reset to start, paused)" @click="stop">
        <Square class="h-3.5 w-3.5" /> Stop
      </Button>
      <Button size="sm" variant="secondary" title="Restart from beginning" @click="restart">
        <SkipBack class="h-3.5 w-3.5" /> Restart
      </Button>
    </div>

    <div class="scrub">
      <span class="time">{{ fmt(current) }}</span>
      <div class="bar" ref="seekBar" @mousedown="onScrubStart">
        <div class="fill" :style="{ width: pct + '%' }"></div>
        <div class="thumb" :style="{ left: pct + '%' }"></div>
      </div>
      <span class="time muted">{{ fmt(duration) }}</span>
    </div>

    <div class="vol-row">
      <Button variant="ghost" size="icon" class="h-8 w-8" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
        <VolumeX v-if="muted || volShown === 0" class="h-4 w-4" />
        <Volume1 v-else-if="volShown < 0.5" class="h-4 w-4" />
        <Volume2 v-else class="h-4 w-4" />
      </Button>
      <input
        type="range"
        class="vol"
        min="0"
        max="1"
        step="0.01"
        :value="volShown"
        @input="onVolume(+$event.target.value)"
      />
      <span class="vol-pct muted">{{ Math.round(volShown * 100) }}%</span>
    </div>

    <div class="speed-row">
      <span class="lbl">Speed</span>
      <div class="speed-btns fluent-transport">
        <Button
          v-for="s in speeds"
          :key="s"
          size="sm"
          :variant="(v.speed || 1) === s ? 'default' : 'outline'"
          :title="s + '× playback'"
          @click="setSpeed(s)"
        >{{ s }}×</Button>
      </div>
    </div>

    <p class="hint muted">{{ modeHint }}</p>
  </fieldset>
</template>

<script setup>
import { computed, ref, onBeforeUnmount, onMounted, watch } from 'vue'
import { Play, Pause, Square, SkipBack, Volume1, Volume2, VolumeX } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { expectedTime, normalizeSyncMode } from '../../features/ytTimeline.js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

const v = computed(() => props.layer?.video || {})
const yt = computed(() => props.layer?.youtube || {})
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const syncMode = computed(() => normalizeSyncMode(yt.value.syncMode))
const isLegacy = computed(() => syncMode.value === 'legacy')

const state = computed(() => scene.mediaState[props.layer.id] || {})
const timeline = computed(() => scene.ytTimeline[props.layer.id] || null)
const syncStatus = computed(() => scene.ytSyncStatus[props.layer.id] || {})

const tick = ref(0)
let tickTimer = null
onMounted(() => {
  tickTimer = setInterval(() => { tick.value++ }, 250)
})
onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  window.removeEventListener('mousemove', onScrubMove)
  window.removeEventListener('mouseup', onScrubUp)
})

const current = computed(() => {
  void tick.value
  if (scrubbing.value && scrubPreview.value != null) return scrubPreview.value
  if (!isLegacy.value && timeline.value) return expectedTime(timeline.value)
  return state.value.current || 0
})
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => {
  if (!isLegacy.value && timeline.value) return !!timeline.value.playing && !timeline.value.stop
  return !!state.value.playing
})
const pct = computed(() => duration.value ? Math.max(0, Math.min(100, (current.value / duration.value) * 100)) : 0)
const touched = computed(() => duration.value > 0 || !!timeline.value)

const muted = computed(() => !!v.value.muted)
const volShown = computed(() => (muted.value ? 0 : (v.value.volume != null ? v.value.volume : 1)))

const syncLabel = computed(() => {
  if (isLegacy.value) return 'Legacy'
  if (syncStatus.value.correcting) return 'Correcting'
  const drift = syncStatus.value.driftMs || 0
  if (drift > 350) return `Drift ${drift}ms`
  return 'In sync'
})
const syncBadgeClass = computed(() => {
  if (isLegacy.value) return 'legacy'
  if (syncStatus.value.correcting || (syncStatus.value.driftMs || 0) > 350) return 'warn'
  return 'ok'
})
const syncHint = computed(() => {
  if (syncMode.value === 'serverClock') return 'Both sides follow the server wall-clock timeline'
  if (syncMode.value === 'moderatorMaster') return 'OBS chases the editor player position'
  return 'Fire-and-forget media-ctrl (old behaviour)'
})
const modeHint = computed(() => {
  if (syncMode.value === 'serverClock') {
    return 'Server clock: play/pause/seek update a shared timeline; editor + OBS correct drift.'
  }
  if (syncMode.value === 'moderatorMaster') {
    return 'Moderator master: editor leads; OBS receives chase heartbeats (~500ms).'
  }
  return 'Legacy: same media-ctrl fan-out as before (no continuous time sync).'
})

const seekBar = ref(null)
const scrubbing = ref(false)
const scrubPreview = ref(null)

function setV(key, value) {
  scene.updateLayer(props.layer.id, { video: { ...v.value, [key]: value } })
}
function setYt(key, value) {
  scene.updateLayer(props.layer.id, { youtube: { ...yt.value, [key]: value } })
}
function setSyncMode(mode) {
  setYt('syncMode', normalizeSyncMode(mode))
}

function sendTransport(patch) {
  if (isLegacy.value) return scene.sendMediaCtrl(props.layer.id, patch)
  return scene.sendYtTransport(props.layer.id, patch)
}

function play() {
  // Anchor both clients to the same mediaTime (play edge → forceSeek on server).
  const t = (!isLegacy.value && timeline.value) ? expectedTime(timeline.value) : (state.value.current || 0)
  sendTransport(isLegacy.value ? { playing: true } : { playing: true, seek: t })
}
function pause() {
  const t = (!isLegacy.value && timeline.value) ? expectedTime(timeline.value) : (state.value.current || 0)
  sendTransport(isLegacy.value ? { playing: false } : { playing: false, seek: t })
}
function stop() { sendTransport({ stop: true }) }
function restart() { sendTransport({ seek: 0, playing: true }) }

function onVolume(val) {
  setV('volume', val)
  if (val > 0 && muted.value) setV('muted', false)
}
function toggleMute() { setV('muted', !muted.value) }
async function setSpeed(s) {
  setV('speed', s)
  if (!isLegacy.value) {
    await scene.sendYtTransport(props.layer.id, {
      rate: s,
      playing: playing.value || undefined
    })
  }
}

function ratioOf(clientX) {
  const bar = seekBar.value
  if (!bar) return 0
  const rect = bar.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}
// During drag only update local UI — commit ONE seek on mouseup.
// Scrub floods (seek every ~6ms) were hard-seeking editor+OBS and desyncing them.
function previewScrub(r) {
  if (!duration.value) return
  scrubPreview.value = r * duration.value
}
function commitScrub() {
  if (scrubPreview.value == null) return
  const t = scrubPreview.value
  scrubPreview.value = null
  scrubbing.value = false
  sendTransport({ seek: t })
}
function onScrubMove(e) {
  previewScrub(ratioOf(e.clientX))
}
function onScrubUp() {
  window.removeEventListener('mousemove', onScrubMove)
  window.removeEventListener('mouseup', onScrubUp)
  document.body.style.userSelect = ''
  commitScrub()
}
function onScrubStart(e) {
  if (e.button !== 0) return
  scrubbing.value = true
  window.addEventListener('mousemove', onScrubMove)
  window.addEventListener('mouseup', onScrubUp)
  document.body.style.userSelect = 'none'
  previewScrub(ratioOf(e.clientX))
}

watch(syncMode, () => {
  // Re-seed timeline when leaving legacy so OBS has a snapshot.
  if (!isLegacy.value && playing.value) {
    scene.sendYtTransport(props.layer.id, {
      seek: current.value,
      playing: true,
      rate: v.value.speed || 1
    })
  }
})

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
</script>

<style scoped>
.yt-player { display: flex; flex-direction: column; gap: 10px; }
.hint { margin: 2px 0 0; line-height: 1.4; font-size: 10px; }

.sync-row { display: flex; align-items: center; gap: 8px; }
.sync-label {
  flex: 1; display: flex; flex-direction: column; gap: 4px;
  font-size: 11px; color: var(--text-dim);
}
.sync-label select {
  padding: 5px 6px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
}
.sync-badge { flex: none; }
.sync-badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.sync-badge.warn { color: #febc2e; border-color: #febc2e55; }
.sync-badge.legacy { color: var(--text-dim); }

.btn-row { display: flex; gap: 5px; flex-wrap: wrap; }
.btn-row :deep(button) { flex: 1; min-width: 0; }

.scrub { display: flex; align-items: center; gap: 8px; }
.time { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: center; }
.bar {
  flex: 1;
  height: 8px;
  background: var(--bg-3);
  border: 1px solid var(--fluent-stroke);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  overflow: visible;
}
.fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: var(--fluent-accent);
  border-radius: 4px;
}
.thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  transform: translateY(-50%);
  background: #fff;
  border: 2px solid var(--fluent-accent);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
  pointer-events: none;
}

.vol-row { display: flex; align-items: center; gap: 8px; }
.vol {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-3);
  border-radius: 2px;
  cursor: pointer;
}
.vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--fluent-accent);
  border: none;
}
.vol::-moz-range-thumb {
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--fluent-accent);
  border: none;
}
.vol-pct { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }

.speed-row { display: flex; align-items: center; gap: 8px; }
.speed-row .lbl { font-size: 11px; color: var(--text-dim); }
.speed-btns { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
