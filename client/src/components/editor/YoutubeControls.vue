<!--
  YoutubeControls.vue (M3)
  Transport-only panel for a YouTube layer. Lives inside each floating
  YoutubeManager window (one per video), so every clip has its own always-on
  control surface. Offers the full transport the moderator needs while juggling
  several clips: Play / Pause / Stop / Restart, a draggable scrubber, Volume +
  Mute, and playback Speed.

  Everything here drives the *live* player:
    - Play / Pause / Stop / Restart / seek go through the shared media-ctrl
      channel so the OBS stream mirrors them (transient, never persisted).
    - Volume / Mute / Speed patch the layer's `video` sub-object; StageRenderer
      pushes them into the embed via postMessage (setVolume / mute / unMute /
      setPlaybackRate) on change and on player ready.

  The non-transport settings (Video URL/ID, Start at, Auto-hide, Buffer on add,
  Playlist IDs) intentionally live on the Properties panel (YoutubeSettings.vue),
  not here.
-->
<template>
  <fieldset v-if="layer?.type === 'youtube'" class="yt-controls">
    <legend>YouTube transport</legend>

    <!-- Primary transport buttons: play / pause / stop / restart. -->
    <div class="btn-row">
      <button class="yt-btn" :class="{ active: playing }" title="Play" @click="play">▶ Play</button>
      <button class="yt-btn" :class="{ active: !playing && touched }" title="Pause" @click="pause">❚❚ Pause</button>
      <button class="yt-btn" title="Stop (reset to start, paused)" @click="stop">⏹ Stop</button>
      <button class="yt-btn" title="Restart from beginning" @click="restart">⏮ Restart</button>
    </div>

    <!-- Draggable scrubber: click or drag the thumb to seek. Mirrors to OBS. -->
    <div class="scrub">
      <span class="time">{{ fmt(current) }}</span>
      <div
        class="bar"
        ref="seekBar"
        @mousedown="onScrubStart"
      >
        <div class="fill" :style="{ width: pct + '%' }"></div>
        <div class="thumb" :style="{ left: pct + '%' }"></div>
      </div>
      <span class="time muted">{{ fmt(duration) }}</span>
    </div>

    <!-- Volume: mute toggle + slider + live percentage. -->
    <div class="vol-row">
      <button class="yt-btn icon" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
        {{ muted || volShown === 0 ? '🔇' : volShown < 0.5 ? '🔉' : '🔊' }}
      </button>
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

    <!-- Speed: one-click playback-rate buttons. -->
    <div class="speed-row">
      <span class="lbl">Speed</span>
      <div class="speed-btns">
        <button
          v-for="s in speeds"
          :key="s"
          class="yt-btn mini"
          :class="{ active: (v.speed || 1) === s }"
          :title="s + '× playback'"
          @click="setSpeed(s)"
        >{{ s }}×</button>
      </div>
    </div>

    <p class="hint muted">Play / pause / stop / seek mirror live to the OBS stream. Volume &amp; speed apply to this player.</p>
  </fieldset>
</template>

<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const props = defineProps({ layer: Object })
const scene = useSceneStore()

// Persisted per-layer media settings (volume / muted / speed) live on the
// generic `video` sub-object that all layer types carry; StageRenderer pushes
// them into the YouTube embed.
const v = computed(() => props.layer?.video || {})
const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

// Live readout pushed up from StageRenderer (editor only).
const state = computed(() => scene.mediaState[props.layer.id] || {})
const current = computed(() => state.value.current || 0)
const duration = computed(() => state.value.duration || 0)
const playing = computed(() => !!state.value.playing)
const pct = computed(() => duration.value ? Math.max(0, Math.min(100, (current.value / duration.value) * 100)) : 0)
// Whether transport has been touched at all — only then do we highlight Pause
// when stopped, so the bar isn't lit up on a fresh, never-played video.
const touched = computed(() => duration.value > 0)

const muted = computed(() => !!v.value.muted)
// The slider reflects 0 while muted (and writes unmute on first drag).
const volShown = computed(() => (muted.value ? 0 : (v.value.volume != null ? v.value.volume : 1)))

const seekBar = ref(null)

function setV(key, value) {
  scene.updateLayer(props.layer.id, { video: { ...v.value, [key]: value } })
}

// --- Transport (shared media-ctrl channel; mirrors to OBS) ------------------
// stop is a first-class command: StageRenderer resets the player to the start
// and holds it paused on both sides.
function play() { scene.sendMediaCtrl(props.layer.id, { playing: true }) }
function pause() { scene.sendMediaCtrl(props.layer.id, { playing: false }) }
function stop() { scene.sendMediaCtrl(props.layer.id, { stop: true }) }
function restart() { scene.sendMediaCtrl(props.layer.id, { seek: 0, playing: true }) }

// --- Volume / speed (persisted on layer.video → pushed to the embed) --------
function onVolume(val) {
  setV('volume', val)
  // Dragging up from 0 while muted should audibly unmute.
  if (val > 0 && muted.value) setV('muted', false)
}
function toggleMute() { setV('muted', !muted.value) }
function setSpeed(s) { setV('speed', s) }

// --- Draggable scrubber -----------------------------------------------------
// mousedown starts a drag (and seeks immediately, so a plain click also seeks);
// mousemove continues seeking; mouseup ends. Listeners live on window so the
// drag survives even if the cursor leaves the bar.
let dragging = false
function ratioOf(clientX) {
  const bar = seekBar.value
  if (!bar) return 0
  const rect = bar.getBoundingClientRect()
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}
function seekToRatio(r) {
  if (!duration.value) return
  scene.sendMediaCtrl(props.layer.id, { seek: r * duration.value })
}
function onScrubMove(e) {
  seekToRatio(ratioOf(e.clientX))
}
function onScrubUp() {
  dragging = false
  window.removeEventListener('mousemove', onScrubMove)
  window.removeEventListener('mouseup', onScrubUp)
  document.body.style.userSelect = ''
}
function onScrubStart(e) {
  if (e.button !== 0) return
  dragging = true
  window.addEventListener('mousemove', onScrubMove)
  window.addEventListener('mouseup', onScrubUp)
  document.body.style.userSelect = 'none'
  // Seek on press so click-to-seek works even without a drag.
  seekToRatio(ratioOf(e.clientX))
}
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onScrubMove)
  window.removeEventListener('mouseup', onScrubUp)
})

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
</script>

<style scoped>
.yt-controls { display: flex; flex-direction: column; gap: 10px; }
.hint { margin: 2px 0 0; line-height: 1.4; font-size: 10px; }

/* Transport buttons */
.btn-row { display: flex; gap: 5px; }
.yt-btn {
  flex: 1;
  padding: 7px 6px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.yt-btn:hover { background: var(--bg-2); }
.yt-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.yt-btn.icon { flex: none; width: 34px; padding: 7px 0; }
.yt-btn.mini { flex: none; padding: 5px 7px; font-size: 11px; }

/* Scrubber */
.scrub { display: flex; align-items: center; gap: 8px; }
.time { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: center; }
.bar {
  flex: 1;
  height: 8px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  overflow: visible;
}
.fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: var(--accent);
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
  border: 2px solid var(--accent);
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
  pointer-events: none;
}

/* Volume */
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
  background: var(--accent);
  border: none;
}
.vol::-moz-range-thumb {
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
}
.vol-pct { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }

/* Speed */
.speed-row { display: flex; align-items: center; gap: 8px; }
.speed-row .lbl { font-size: 11px; color: var(--text-dim); }
.speed-btns { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
