<!--
  StageRenderer.vue
  The single source of visual truth. Renders every layer onto a fixed 1920x1080
  logical stage. The editor wraps this and scales it; the OBS view uses it at
  1:1. Both render identical coordinates, so what the moderator sees is exactly
  what the stream gets.

  Applies video/audio playback settings (speed/volume/fragment-loop) to the
  live media elements, and mirrors transport commands (play/pause/seek) from
  the moderator to the OBS stream via the media-ctrl channel.

  Emits 'select' (id) and 'edit-text' (id) so the editor Canvas can wire
  click-to-select and double-click-to-edit-text. OBS mode ignores both.
-->
<template>
  <div class="stage" :style="stageStyle">
    <div
      v-for="layer in renderable"
      :key="layer.id"
      class="layer"
      :class="{ locked: layer.locked, interactive: mode === 'editor' }"
      :style="layerStyle(layer)"
      @mousedown.stop="mode === 'editor' && emit('select', layer.id)"
      @dblclick.stop="mode === 'editor' && layer.type === 'text' && emit('edit-text', layer.id)"
    >
      <!-- IMAGE / GIF / EMOTE (emotes are plain <img> — static or animated webp/gif) -->
      <img
        v-if="layer.type === 'image' || layer.type === 'gif' || layer.type === 'emote'"
        :src="layer.src"
        draggable="false"
        :style="fillStyle(layer)"
        @load="onImgMeta(layer, $event)"
      />
      <!-- VIDEO -->
      <video
        v-else-if="layer.type === 'video'"
        :ref="(el) => bindVideo(layer.id, el)"
        :src="layer.src"
        :loop="layer.video.loop"
        :autoplay="layer.video.autoplay"
        :muted="layer.video.muted"
        playsinline
        :style="fillStyle(layer)"
        @loadedmetadata="onVideoMeta(layer)"
        @timeupdate="onVideoTime(layer)"
        @play="onVideoPlayPause(layer, true)"
        @pause="onVideoPlayPause(layer, false)"
        @ended="onVideoEnded(layer)"
      />
      <!-- AUDIO -->
      <div v-else-if="layer.type === 'audio'" class="audio-body" :style="fillStyle">
        <!-- The actual audio element drives playback; hidden visually. One
             element for BOTH modes so the media-ctrl watcher drives it the
             same way in the editor and in OBS — no autoplay desync. -->
        <audio
          :ref="(el) => bindAudio(layer.id, el)"
          :src="layer.src"
          :loop="layer.audio.loop"
          preload="metadata"
          @loadedmetadata="onAudioMeta(layer)"
          @timeupdate="onAudioTime(layer)"
          @play="onAudioPlayPause(layer, true)"
          @pause="onAudioPlayPause(layer, false)"
          @ended="onAudioEnded(layer)"
          style="display:none"
        />
        <!-- Player card. Shown to the audience too (when audienceVisible) so
             viewers see the now-playing card on the stream. The moderator
             controls it (play/pause/seek/volume); OBS just renders it. -->
        <div class="audio-player">
          <div class="audio-note-row">
            <span class="audio-note">♪</span>
            <span class="audio-name" :title="layer.name">{{ layer.name }}</span>
          </div>
          <div class="audio-controls-row">
            <button v-if="mode === 'editor'" class="ap-btn" :title="audioState[layer.id]?.playing ? 'Pause' : 'Play'" @click.stop="toggleAudio(layer)">
              {{ audioState[layer.id]?.playing ? '❚❚' : '▶' }}
            </button>
            <span class="ap-time">{{ fmt(audioState[layer.id]?.current || 0) }}</span>
            <div v-if="mode === 'editor'" class="ap-seek" @click.stop="onSeek($event, layer)">
              <div class="ap-progress" :style="{ width: pct(layer.id) + '%' }"></div>
            </div>
            <div v-else class="ap-seek static">
              <div class="ap-progress" :style="{ width: pct(layer.id) + '%' }"></div>
            </div>
            <span class="ap-time muted">{{ fmt(audioState[layer.id]?.duration || 0) }}</span>
          </div>
          <div v-if="mode === 'editor'" class="audio-vol-row">
            <span class="ap-vol-icon">🔊</span>
            <input type="range" class="ap-vol" min="0" max="1" step="0.01"
                   :value="layer.audio.volume" @click.stop @input="onVol(layer, +$event.target.value)" />
          </div>
        </div>
      </div>
      <!-- YOUTUBE (video) -->
      <div v-else-if="layer.type === 'youtube'" class="yt-body" :style="fillStyle">
        <iframe
          v-if="ytSrc(layer)"
          :ref="(el) => bindYoutube(layer.id, el)"
          :src="ytSrc(layer)"
          frameborder="0"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen
          @load="onYtLoad(layer)"
        />
        <div v-else class="yt-placeholder">YouTube: {{ layer.name }}</div>
      </div>
      <!-- TEXT -->
      <div
        v-else-if="layer.type === 'text'"
        class="text-body"
        :style="textStyle(layer)"
      >{{ layer.text?.content || '' }}</div>

      <!-- TTL countdown badge (editor only) -->
      <div v-if="mode === 'editor' && ttlRemaining[layer.id] > 0" class="ttl-badge">⏱ {{ fmt(ttlRemaining[layer.id]) }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'
import { STAGE } from '@shared/schema.js'
import { ytCommand, ytListen, onYtMessage, ytStateInfo, ytPreload } from '../features/youtube.js'

const emit = defineEmits(['select', 'edit-text', 'fit-aspect', 'media-state', 'audio-ctrl'])

const props = defineProps({
  layers: { type: Array, default: () => [] },
  mode: { type: String, default: 'editor' },
  scale: { type: Number, default: 1 },
  ttlMap: { type: Object, default: () => ({}) }, // id -> seconds remaining (editor only)
  // Latest transient transport command per layer id: { playing?, seek?, nonce }.
  // Applied to the live <video>/<audio> in BOTH modes so OBS mirrors transport.
  mediaCtrl: { type: Object, default: () => ({}) }
})

// All layers that the current mode should consider. In editor mode, layers
// hidden via the eye icon are excluded. In OBS mode, ALL layers are rendered
// so that toggling audienceVisible doesn't destroy/recreate DOM elements (which
// would restart YouTube iframes and reset video playback). Instead, audience-
// hidden layers are made invisible via CSS opacity/visibility in layerStyle.
const renderable = computed(() =>
  props.layers.filter((l) => props.mode === 'editor' ? l.visible !== false : true)
)

const stageStyle = computed(() => ({
  width: STAGE.W + 'px',
  height: STAGE.H + 'px',
  transform: `scale(${props.scale})`,
  transformOrigin: 'top left'
}))

// Media fill style: when maintainRatio is on, the media keeps its native aspect
// ratio inside the box (object-fit: contain) instead of stretching (fill).
// Default true for image/gif/video, false for other types.
function fillStyle(layer) {
  const contain = layer.maintainRatio !== false && ['image', 'gif', 'video', 'emote'].includes(layer.type)
  return { width: '100%', height: '100%', objectFit: contain ? 'contain' : 'fill', display: 'block' }
}

const ttlRemaining = computed(() => props.ttlMap || {})

function layerStyle(layer) {
  const t = layer.transform || {}
  // In OBS mode, audience-hidden layers stay in the DOM (so iframes/videos
  // don't reload on toggle) but are invisible via CSS. In editor mode,
  // audienceVisible is irrelevant — the editor always shows the layer.
  const audienceHidden = props.mode === 'obs' && !layer.audienceVisible
  const base = {
    left: t.x + 'px',
    top: t.y + 'px',
    width: t.w + 'px',
    height: t.h + 'px',
    transform: [
      `rotate(${t.rotation || 0}deg)`,
      t.flipH ? 'scaleX(-1)' : '',
      t.flipV ? 'scaleY(-1)' : '',
      ''
    ].filter(Boolean).join(' '),
    opacity: (t.opacity != null ? t.opacity : 1),
    display: 'block',
    // visibility:hidden hides the layer without removing it from layout,
    // so media elements (YouTube iframes, <video>, <audio>) keep their state
    // across audience-visible toggles. pointer-events:none prevents hidden
    // layers from intercepting any interaction in editor mode.
    visibility: audienceHidden ? 'hidden' : 'visible',
    pointerEvents: audienceHidden ? 'none' : ''
  }
  return base
}

// --- TEXT styling ----------------------------------------------------------
function textStyle(layer) {
  const tx = layer.text || {}
  const bg = tx.bgColor && tx.bgOpacity > 0
    ? withOpacity(tx.bgColor, tx.bgOpacity)
    : 'transparent'
  return {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: tx.textAlign === 'left' ? 'flex-start'
      : tx.textAlign === 'right' ? 'flex-end' : 'center',
    textAlign: tx.textAlign || 'center',
    fontFamily: tx.fontFamily || 'Arial, sans-serif',
    fontSize: (tx.fontSize || 48) + 'px',
    color: tx.fontColor || '#ffffff',
    fontWeight: tx.bold ? '700' : '400',
    fontStyle: tx.italic ? 'italic' : 'normal',
    padding: '0 8px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    // Outline via text-stroke (with a paint-order fallback for Firefox).
    WebkitTextStroke: tx.outlineWidth > 0 ? `${tx.outlineWidth}px ${tx.outlineColor || '#000'}` : '0',
    paintOrder: 'stroke fill',
    // Drop shadow.
    textShadow: tx.shadow ? `${tx.shadowOffsetX || 0}px ${tx.shadowOffsetY || 0}px ${tx.shadowBlur || 0}px ${tx.shadowColor || '#000'}` : 'none',
    // Background fill + rounding.
    background: bg,
    borderRadius: (tx.borderRadius || 0) + 'px'
  }
}

// Convert a #rrggbb hex + 0..1 opacity into an rgba() string.
function withOpacity(hex, opacity) {
  if (!hex) return 'transparent'
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity != null ? opacity : 1})`
}

// --- YouTube embed URL -----------------------------------------------------
// IMPORTANT: transport is driven by the shared media-ctrl channel (play/pause/
// seek), NOT by autoplay=1. Browsers block sound-on autoplay, which left the
// editor preview stuck on "ready for playback" while OBS played — and the two
// drifted apart. With autoplay off everywhere, both clients start paused and
// only move when the moderator issues a transport command. enablejsapi=1 opens
// the postMessage command channel ytCommand() uses.
function ytSrc(layer) {
  if (!layer.src) return ''
  const y = layer.youtube || {}
  const params = new URLSearchParams({
    enablejsapi: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1'
  })
  if (props.mode === 'obs') {
    // Clean video for the stream: no controls, no branding, no annotations.
    params.set('controls', '0')
    params.set('showinfo', '0')
    params.set('iv_load_policy', '3')
    params.set('disablekb', '1')
    params.set('fs', '0')
    params.set('modestbranding', '1')
  } else {
    // Editor: full player chrome so the moderator can scrub/seek/pause.
    params.set('controls', '1')
  }
  // Keep both clients paused at the start so the moderator decides when to
  // roll. Mute/volume/speed are deliberately NOT in the URL: they'd change the
  // src string on every toggle, which reloads the iframe and restarts playback.
  // Instead they're pushed live via postMessage from applyYtSettings (on ready
  // and on every change), so mute/unmute applies in place — the video keeps
  // playing uninterrupted, only its audio flips.
  params.set('autoplay', '0')
  if (y.startAt) params.set('start', String(Math.floor(y.startAt)))
  if (y.playlist && y.playlist.length) {
    params.set('listType', 'playlist')
    params.set('playlist', y.playlist.join(','))
  }
  const m = String(layer.src).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)
  const id = m ? m[1] : layer.src
  return `https://www.youtube.com/embed/${id}?${params.toString()}`
}

// --- Media element management ----------------------------------------------
const videoEls = reactive(new Map())   // id -> HTMLVideoElement
const audioEls = reactive(new Map())   // id -> HTMLAudioElement
const ytEls = reactive(new Map())      // id -> HTMLIFrameElement (YouTube)
const audioState = reactive({})        // id -> { playing, current, duration }
const ytState = reactive({})           // id -> { playing, current, duration }
// Tracks the last nonce applied per YouTube id, so a repeated transport
// command (e.g. seek-to-0 twice) still re-fires the postMessage.
const ytNonce = reactive({})
// Per-id readiness + the last transport command seen before the player was
// ready. OBS's Chromium Browser Source IGNORES the autoplay=0 URL param and
// starts the video on its own; we can't trust the URL to keep it paused. So we
// force-pause via postMessage on onReady. That also means a transport command
// (Play/seek) that arrives before the player is ready would be lost — we stash
// it here and replay it once onReady fires.
const ytReady = reactive({})           // id -> boolean
const ytPending = reactive({})         // id -> { playing?, seek?, nonce } | null
// Tracks per-id whether we've already buffered the opening segment. The IFrame
// player only fetches data once playback starts, so a brand-new embed left
// paused has nothing buffered — and the moderator's first Play stutters while
// it catches up. When the layer's preload flag is on we kick playback on ready
// and pause it as soon as it starts streaming (state 3/1). ytBuffered guards
// against re-buffering on every subsequent onReady/state delivery.
const ytBuffered = reactive({})        // id -> boolean

function bindVideo(id, el) { if (el) videoEls.set(id, el) }
function bindAudio(id, el) { if (el) audioEls.set(id, el) }
function bindYoutube(id, el) {
  if (el) {
    // New iframe (or src swap): reset readiness so we re-pause on the next
    // onReady. Without this, swapping a video on a live layer would keep the
    // old ready=true and skip the force-pause — re-autoplaying in OBS.
    if (ytEls.get(id) !== el) {
      ytReady[id] = false
      ytPending[id] = null
      ytBuffered[id] = false
    }
    ytEls.set(id, el)
    // (Re)establish the listening handshake for this player; the @load handler
    // also does this, but setting it here covers any path that swaps the src
    // without reloading the node (reactive ref rebind).
    ytListen(el)
  } else {
    ytEls.delete(id)
    ytReady[id] = false
    ytPending[id] = null
    ytBuffered[id] = false
  }
}

// Apply a transport command to a YouTube embed right now. Returns true if it
// could be applied (player ready), false if it was stashed for later.
function applyYtCommand(id, cmd) {
  const el = ytEls.get(id)
  if (!el) return false
  if (!ytReady[id]) {
    // Player not ready yet (OBS may still be loading the iframe). Remember the
    // latest intent and replay it from onReady so the moderator's command is
    // never silently dropped.
    ytPending[id] = cmd
    return false
  }
  // Any real moderator transport (play/pause/seek/stop) supersedes the one-shot
  // opening-segment preload. Marking ytBuffered here cancels an in-flight preload
  // pause (which is queued to fire on the next state-1 delivery): without this,
  // pressing Play during the brief preload window would be immediately undone by
  // that pending pause — so Play looked like it "did nothing".
  if (cmd.playing != null || typeof cmd.seek === 'number' || cmd.stop) {
    ytBuffered[id] = true
  }
  if (typeof cmd.seek === 'number' && isFinite(cmd.seek)) {
    ytCommand(el, 'seekTo', [Math.max(0, cmd.seek), true])
  }
  // stop: reset to the start and hold paused. We deliberately do NOT use
  // stopVideo() — it drops the player to the "unstarted" (-1) state, and a
  // seekTo(0) on an unstarted player AUTO-PLAYS (a YT API quirk), so Stop would
  // look like it restarted the video. pauseVideo() leaves the player paused
  // (state 2), where seekTo(0) holds position without playing.
  if (cmd.stop) {
    ytCommand(el, 'pauseVideo')
    ytCommand(el, 'seekTo', [0, true])
    ensureYt(id).playing = false
    pushMediaState(id, { playing: false, current: 0 })
  }
  if (cmd.playing === true) ytCommand(el, 'playVideo')
  else if (cmd.playing === false) ytCommand(el, 'pauseVideo')
  return true
}

// Single global listener for YT state deliveries. Each inbound message names
// an info object we match back to its iframe (and thus its layer id).
onYtMessage((source, d) => {
  if (d.event === 'onReady') {
    const id = idForYtSource(source)
    if (id == null) return
    ytReady[id] = true
    // Push the layer's persisted audio settings (mute/volume) to the embed.
    applyYtSettings(id)
    // OBS auto-plays despite autoplay=0, so the moderator and OBS drift. Force
    // the player to the moderator's last intent: start PAUSED unless a Play
    // command arrived while we were still loading — in which case honor it.
    const pending = ytPending[id]
    if (pending) {
      ytPending[id] = null
      applyYtCommand(id, pending)
      // A real transport command supersedes the one-shot preload buffer.
      ytBuffered[id] = true
    } else if (ytWantsPreload(id) && !ytBuffered[id]) {
      // Kick off the opening-segment buffer (play→pause once it starts). The
      // actual pause fires from onStateChange below when state hits 3/1, and
      // ytBuffered flips true so we only do this once per player load.
      ytPreload(ytEls.get(id))
    } else {
      // No transport issued yet → hold paused on BOTH sides.
      ytCommand(ytEls.get(id), 'pauseVideo')
      ensureYt(id).playing = false
      pushMediaState(id, { playing: false })
    }
  } else if (d.event === 'onStateChange' && d.info != null) {
    const id = idForYtSource(source)
    if (id == null) return
    const info = ytStateInfo(d.info)
    const st = ensureYt(id)
    // Preload buffer landing: the opening-segment buffer (see ytPreload) is
    // done once playback actually starts STREAMING — i.e. state 1 (playing),
    // meaning the player has fetched enough data to roll. Pausing on state 3
    // (buffering) instead would freeze the player mid-buffer: a paused YouTube
    // player doesn't keep prefetching, so the stream never reaches a clean cued
    // state and OBS sits on a spinner forever. Once buffered, immediately pause
    // so the player has the head of the video ready but stays cued for the
    // moderator's real Play. Only the very first transition per load, and never
    // after a real transport command has superseded the preload (ytBuffered).
    if (!ytBuffered[id] && d.info === 1 && ytWantsPreload(id)) {
      ytBuffered[id] = true
      ytCommand(ytEls.get(id), 'pauseVideo')
      st.playing = false
      pushMediaState(id, { playing: false })
      // The preload kick was muted (ytPreload mutes so the buffer burst isn't
      // audible). Restore the layer's real mute/volume now that buffering is
      // done, so the moderator's first Play has correct audio.
      applyYtSettings(id)
      return
    }
    if (info.playing !== st.playing) {
      st.playing = info.playing
      pushMediaState(id, { playing: info.playing })
    }
    if (info.ended) pushMediaState(id, { playing: false })
  } else if (d.event === 'infoDelivery') {
    const id = idForYtSource(source)
    if (id == null) return
    const info = d.info || {}
    if (info.currentTime != null) {
      ensureYt(id).current = info.currentTime
      pushMediaState(id, { current: info.currentTime })
    }
    if (info.duration != null) {
      ensureYt(id).duration = info.duration
      pushMediaState(id, { duration: info.duration })
    }
    if (info.playerState != null) {
      const si = ytStateInfo(info.playerState)
      const st = ensureYt(id)
      if (si.playing !== st.playing) {
        st.playing = si.playing
        pushMediaState(id, { playing: si.playing })
      }
    }
  }
})
// Match a message's source window back to a layer id by comparing
// contentWindow on every tracked iframe.
function idForYtSource(source) {
  for (const [id, el] of ytEls) {
    if (el && el.contentWindow === source) return id
  }
  return null
}
function ensureYt(id) {
  if (!ytState[id]) ytState[id] = { playing: false, current: 0, duration: 0 }
  return ytState[id]
}
// Whether this layer should buffer its opening segment on load. Defaults to on
// (newly added YouTube videos play back smoothly from the first Play) but can
// be turned off per-layer via the youtube.preload flag. Buffered once per load.
function ytWantsPreload(id) {
  const l = props.layers.find((x) => x.id === id)
  return !!l && (l.youtube?.preload !== false)
}
function onYtLoad(layer) {
  const el = ytEls.get(layer.id)
  if (!el) return
  ytListen(el)
  // Settings can't be pushed until onReady (the player would drop them), but
  // re-listening here covers a late @load that missed the initial handshake.
}
// Push the layer's persisted video settings (mute/volume/speed) to the embed.
function applyYtSettings(id) {
  const el = ytEls.get(id)
  const l = props.layers.find((x) => x.id === id)
  if (!el || !l) return
  const v = l.video || {}
  if (v.muted) ytCommand(el, 'mute')
  else { ytCommand(el, 'unMute'); ytCommand(el, 'setVolume', [Math.round((v.volume != null ? v.volume : 1) * 100)]) }
  // Playback rate. setPlaybackRate only sticks once the player is ready, which
  // is why this is called from onReady as well as the change watcher.
  ytCommand(el, 'setPlaybackRate', [v.speed != null ? v.speed : 1])
}

// Push video playback props to the live elements.
watch(
  () => renderable.value.filter((l) => l.type === 'video'),
  (vids) => {
    for (const l of vids) {
      const el = videoEls.get(l.id)
      if (!el) continue
      const v = l.video || {}
      if (el.playbackRate !== (v.speed || 1)) el.playbackRate = v.speed || 1
      el.volume = v.volume != null ? v.volume : 1
    }
  },
  { deep: true, flush: 'post' }
)

// Push audio volume + loop to the live elements.
watch(
  () => renderable.value.filter((l) => l.type === 'audio'),
  (auds) => {
    for (const l of auds) {
      const el = audioEls.get(l.id)
      if (!el) continue
      const a = l.audio || {}
      el.volume = a.volume != null ? a.volume : 1
      el.loop = !!a.loop
    }
  },
  { deep: true, flush: 'post' }
)

// --- Media transport sync (video + audio + youtube) ------------------------
// Watch the latest command per id and apply it to the live element in BOTH
// editor and OBS mode. The nonce lets a repeat (e.g. seek 0 twice) re-fire
// even though the patch object is otherwise identical. State readouts are
// pushed back to the parent via 'media-state' (editor only) so the transport
// bars can show live current/duration/playing.
//
// YouTube iframes can't be driven by el.play()/el.currentTime — they speak the
// postMessage JSON protocol (see features/youtube.js). Commands are routed
// through applyYtCommand(), which queues them if the player hasn't loaded yet
// and replays from onReady, so the moderator's intent is never lost.
watch(
  () => props.mediaCtrl,
  (ctrl) => {
    for (const id of Object.keys(ctrl)) {
      const cmd = ctrl[id]
      if (!cmd || !cmd.nonce) continue
      // Video / audio — direct DOM control.
      const el = videoEls.get(id) || audioEls.get(id)
      if (el) {
        if (typeof cmd.seek === 'number' && isFinite(cmd.seek)) {
          try { el.currentTime = Math.max(0, cmd.seek) } catch (_) { /* not seekable yet */ }
        }
        // stop: reset to the start and hold paused.
        if (cmd.stop) {
          try { el.currentTime = 0 } catch (_) { /* not seekable yet */ }
          el.pause?.()
          if (audioState[id]) audioState[id].playing = false
          pushMediaState(id, { playing: false, current: 0 })
          continue
        }
        if (cmd.playing === true) { el.play?.().catch(() => {}) }
        else if (cmd.playing === false) { el.pause?.() }
        continue
      }
      // YouTube — postMessage, with pre-ready queuing.
      const yt = ytEls.get(id)
      if (yt) {
        if (ytNonce[id] === cmd.nonce) continue
        ytNonce[id] = cmd.nonce
        applyYtCommand(id, cmd)
      }
    }
  },
  { deep: true, flush: 'post' }
)

// Keep YouTube mute/volume/speed in sync with the layer's video sub-object
// (the embed doesn't read our props; we push them via postMessage on change).
watch(
  () => renderable.value.filter((l) => l.type === 'youtube').map((l) => [l.id, !!(l.video?.muted), l.video?.volume, l.video?.speed]),
  (entries) => {
    for (const [id] of entries) applyYtSettings(id)
  },
  { deep: true, flush: 'post' }
)

function onVideoMeta(layer) {
  const el = videoEls.get(layer.id)
  if (!el) return
  el.playbackRate = layer.video?.speed || 1
  el.volume = layer.video?.volume != null ? layer.video.volume : 1
  emitAspectFit(layer, el.videoWidth, el.videoHeight)
  pushMediaState(layer.id, { duration: el.duration || 0 })
}

// On first media load, snap the layer's box to the media's native aspect ratio
// so it never looks squashed. Only the editor applies this (OBS just renders).
function onImgMeta(layer, ev) {
  const el = ev?.target
  if (!el) return
  emitAspectFit(layer, el.naturalWidth, el.naturalHeight)
}

// Emit a proposed box that matches the media's native aspect, scaled to fit
// comfortably on the stage while keeping the box's current center. The editor
// (Canvas) applies it via the store; OBS ignores the event. Fires once per
// layer — guarded by a transient _aspectFit flag so manual resize is respected.
function emitAspectFit(layer, natW, natH) {
  if (props.mode !== 'editor') return
  if (layer._aspectFit) return
  if (!natW || !natH) return
  emit('fit-aspect', { id: layer.id, natW, natH })
}

// Fragment repeat for video (local clamp, independent of transport sync).
function onVideoTime(layer) {
  const el = videoEls.get(layer.id)
  if (!el) return
  if (layer.video?.fragment) {
    const [s, e] = layer.video.fragment
    if (el.currentTime >= e || el.currentTime < s) el.currentTime = s
  }
  pushMediaState(layer.id, { current: el.currentTime || 0, duration: el.duration || 0 })
}
function onVideoPlayPause(layer, playing) {
  pushMediaState(layer.id, { playing })
}
function onVideoEnded(layer) {
  const el = videoEls.get(layer.id)
  if (!el) return
  if (layer.video?.fragment) { el.currentTime = layer.video.fragment[0]; el.play?.() }
}

// Push a media readout up to the parent (editor only) so transport bars can
// render live current/duration/playing. OBS has no use for it.
function pushMediaState(id, partial) {
  if (props.mode !== 'editor') return
  emit('media-state', { id, ...partial })
}

// --- Audio player helpers (editor) -----------------------------------------
// The on-card transport (play/pause/seek/volume) routes through emit('audio-ctrl')
// so it mirrors to the OBS stream via the parent store's sendMediaCtrl. The
// local <audio> element follows along because the mediaCtrl watcher applies the
// command in both modes. audioState is purely the editor's local readout.
function ensureState(id) {
  if (!audioState[id]) audioState[id] = { playing: false, current: 0, duration: 0 }
  return audioState[id]
}
function onAudioMeta(layer) {
  const el = audioEls.get(layer.id)
  const st = ensureState(layer.id)
  st.duration = el?.duration || 0
  pushMediaState(layer.id, { duration: el?.duration || 0 })
}
function onAudioTime(layer) {
  const el = audioEls.get(layer.id)
  const st = ensureState(layer.id)
  st.current = el?.currentTime || 0
  pushMediaState(layer.id, { current: el?.currentTime || 0 })
}
function onAudioEnded(layer) {
  const st = ensureState(layer.id)
  st.playing = false
  st.current = 0
  pushMediaState(layer.id, { playing: false, current: 0 })
}
// Local play/pause readout (covers transport-applied + autoplay starts).
function onAudioPlayPause(layer, playing) {
  const st = ensureState(layer.id)
  st.playing = playing
  pushMediaState(layer.id, { playing })
}
function toggleAudio(layer) {
  const el = audioEls.get(layer.id)
  if (!el) return
  // Route through the shared transport so OBS mirrors it.
  const playing = el.paused
  emit('audio-ctrl', { id: layer.id, patch: playing ? { playing: true } : { playing: false } })
}
function onSeek(e, layer) {
  const el = audioEls.get(layer.id)
  if (!el || !el.duration) return
  const bar = e.currentTarget
  const rect = bar.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const seek = ratio * el.duration
  // Route the seek through the shared transport so OBS mirrors it; autoplay so
  // scrubbing while paused doesn't leave the stream silent at the new position.
  emit('audio-ctrl', { id: layer.id, patch: { seek, playing: true } })
}
function onVol(layer, v) {
  const el = audioEls.get(layer.id)
  if (el) el.volume = v
  // Volume is a per-element setting; it stays local to each client's media
  // element (the OBS stream volume is driven by OBS, not the browser source).
}
function pct(id) {
  const st = audioState[id]
  if (!st || !st.duration) return 0
  return Math.max(0, Math.min(100, (st.current / st.duration) * 100))
}
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m + ':' + String(s).padStart(2, '0')
}
</script>

<style scoped>
.stage {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none; /* editor handles interaction on its overlay */
}
.layer { position: absolute; pointer-events: none; }
.layer.interactive { pointer-events: auto; cursor: pointer; }
.layer.locked { outline: 1px dashed rgba(255,255,255,.25); }

/* --- Audio player --- */
.audio-body {
  background: rgba(0,0,0,.5);
  border-radius: 10px;
  overflow: hidden;
}
.audio-player {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #1db954 0%, #1a8a3f 100%);
  color: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
}
.audio-note-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 0;
}
.audio-note {
  font-size: 28px;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0,0,0,.3);
}
.audio-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.audio-controls-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ap-btn {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,.2);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ap-btn:hover { background: rgba(255,255,255,.35); }
.ap-time { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 32px; }
.ap-time.muted { opacity: .7; }
.ap-seek {
  flex: 1;
  height: 5px;
  background: rgba(255,255,255,.25);
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
/* OBS renders the seek bar read-only (no scrubbing); just show progress. */
.ap-seek.static { cursor: default; }
.ap-progress {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: #fff;
  border-radius: 3px;
}
.audio-vol-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ap-vol-icon { font-size: 11px; }
.ap-vol {
  flex: 1;
  height: 3px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255,255,255,.3);
  border-radius: 2px;
  cursor: pointer;
}
.ap-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #fff;
}

/* --- YouTube video --- */
.yt-body { width: 100%; height: 100%; background: #000; }
.yt-body iframe { width: 100%; height: 100%; }
.yt-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; background: #111; font-size: 14px;
}

/* --- Text --- */
.text-body {
  line-height: 1.2;
  user-select: none;
}

/* --- TTL badge --- */
.ttl-badge {
  position: absolute;
  top: -22px;
  right: 0;
  background: rgba(239, 68, 68, .9);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 5;
}
</style>
