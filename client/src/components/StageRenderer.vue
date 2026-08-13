<!--
  StageRenderer.vue
  The single source of visual truth. Renders every layer onto a fixed 1920x1080
  logical stage. The editor wraps this and scales it; the OBS view uses it at
  1:1. Both render identical coordinates, so what the moderator sees is exactly
  what the stream gets.

  Applies video/audio playback settings (speed/volume/fragment-loop) to the
  live media elements. Video/audio transport mirrors via media-ctrl; YouTube
  uses the yt-timeline protocol (serverClock / moderatorMaster) or legacy
  media-ctrl when syncMode is legacy.

  Emits 'select' (id) and 'edit-text' (id) so the editor Canvas can wire
  click-to-select and double-click-to-edit-text. OBS mode ignores both.
-->
<template>
  <div class="stage" :style="stageStyle">
    <LayerContextMenu
      v-for="layer in renderable"
      :key="layer.id"
      :layer="layer"
      :disabled="mode !== 'editor'"
      :on-fit-aspect="mode === 'editor' ? menuFitAspect : null"
    >
    <div
      class="layer"
      :class="{ locked: layer.locked, interactive: mode === 'editor', sel: mode === 'editor' && scene.selectedId === layer.id }"
      :style="layerStyle(layer)"
      @mousedown.stop="mode === 'editor' && onLayerMouseDown($event, layer.id)"
      @contextmenu.stop="mode === 'editor' && emit('select', layer.id)"
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
            <Music class="audio-note h-4 w-4" aria-hidden="true" />
            <span class="audio-name" :title="layer.name">{{ layer.name }}</span>
          </div>
          <div class="audio-controls-row">
            <button
              v-if="mode === 'editor'"
              type="button"
              class="ap-btn"
              :title="audioState[layer.id]?.playing ? 'Pause' : 'Play'"
              @click.stop="toggleAudio(layer)"
            >
              <Pause v-if="audioState[layer.id]?.playing" class="h-3.5 w-3.5" />
              <Play v-else class="h-3.5 w-3.5" />
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
            <Volume2 class="ap-vol-icon h-3.5 w-3.5" aria-hidden="true" />
            <input type="range" class="ap-vol" min="0" max="1" step="0.01"
                   :value="layer.audio.volume" @click.stop @input="onVol(layer, +$event.target.value)" />
          </div>
        </div>
      </div>
      <!-- YOUTUBE (video) -->
      <div
        v-else-if="layer.type === 'youtube'"
        class="yt-body"
        :class="{ 'yt-obs-clean': mode === 'obs' }"
        :style="fillStyle"
      >
        <iframe
          v-if="ytSrc(layer)"
          :ref="(el) => bindYoutube(layer.id, el)"
          :src="ytSrc(layer)"
          frameborder="0"
          allow="autoplay; encrypted-media; picture-in-picture"
          :allowfullscreen="mode === 'editor'"
          @load="onYtLoad(layer)"
        />
        <!-- OBS: cover YouTube chrome (title / big play / end screen) until live playback -->
        <div
          v-if="mode === 'obs' && !ytObsLive(layer.id)"
          class="yt-obs-mask"
          aria-hidden="true"
        />
        <div v-else-if="mode === 'editor' && !ytSrc(layer)" class="yt-placeholder">YouTube: {{ layer.name }}</div>
      </div>
      <!-- TEXT -->
      <div
        v-else-if="layer.type === 'text'"
        class="text-body"
        :style="textStyle(layer)"
      >{{ layer.text?.content || '' }}</div>

      <!-- TIMER (countdown) -->
      <div
        v-else-if="layer.type === 'timer'"
        class="text-body"
        :style="textStyle(layer)"
      >{{ formatTimer(layer) }}</div>

      <!-- COUNTER -->
      <div
        v-else-if="layer.type === 'counter'"
        class="text-body"
        :style="textStyle(layer)"
      >{{ layer.counterValue ?? 0 }}</div>

      <!-- BROWSER / CHATIS
           OBS Studio uses CEF top-level documents (not iframes). In Electron we
           mirror that with <webview>. In Chrome/dev (and OBS overlay page) we
           use iframe + gateway for XFO hosts. -->
      <div v-else-if="layer.type === 'browser' || layer.type === 'chatis'" class="browser-body" :style="fillStyle(layer)">
        <webview
          v-if="useWebview && directBrowserUrl(layer)"
          :ref="(el) => bindBrowserFrame(layer, el)"
          :key="'wv-' + browserFrameKey(layer)"
          class="browser-frame"
          :src="directBrowserUrl(layer)"
          :style="{ width: '100%', height: '100%' }"
          allowpopups
          webpreferences="contextIsolation=yes, javascript=yes, webSecurity=yes"
          @did-finish-load="onBrowserLoad(layer, $event)"
          @dom-ready="onWebviewReady(layer, $event)"
        />
        <iframe
          v-else-if="safeBrowserSrc(layer) !== 'about:blank'"
          :ref="(el) => bindBrowserFrame(layer, el)"
          :key="browserFrameKey(layer)"
          class="browser-frame"
          :src="safeBrowserSrc(layer)"
          :title="layer.name"
          frameborder="0"
          scrolling="no"
          referrerpolicy="strict-origin-when-cross-origin"
          loading="eager"
          allow="autoplay; fullscreen; clipboard-write"
          @load="onBrowserLoad(layer, $event)"
        />
        <div v-else class="browser-empty">No URL</div>
        <div v-if="mode === 'editor'" class="browser-shield" aria-hidden="true"></div>
        <div v-if="mode === 'editor'" class="browser-badge">{{ browserBadge(layer) }}{{ useWebview ? ' · CEF' : '' }}</div>
      </div>

      <!-- MULTI BROWSER SOURCE (several widgets + exclusive queue) -->
      <div
        v-else-if="layer.type === 'multiBrowser'"
        class="browser-body multi-browser"
        :class="{ 'is-locked': multiLocked(layer.id) }"
        :style="fillStyle(layer)"
      >
        <template v-for="(u, i) in multiDisplayUrls(layer)" :key="layer.id + '-' + i + '-' + (layer.multiBrowser?.refreshKey || 0)">
          <webview
            v-if="useWebview"
            :ref="(el) => bindMultiFrame(layer.id, i, el)"
            class="browser-frame multi-frame"
            :class="multiFrameClass(layer.id, i)"
            :src="u"
            :style="{ width: '100%', height: '100%' }"
            allowpopups
            webpreferences="contextIsolation=yes, javascript=yes, webSecurity=yes"
            @dom-ready="onMultiReady(layer, i, $event)"
            @media-started-playing="onMultiMediaStart(layer, i)"
            @media-paused="onMultiMediaStop(layer, i)"
          />
          <iframe
            v-else
            :ref="(el) => bindMultiFrame(layer.id, i, el)"
            class="browser-frame multi-frame"
            :class="multiFrameClass(layer.id, i)"
            :src="u"
            :title="(layer.name || 'Multi') + ' #' + (i + 1)"
            frameborder="0"
            scrolling="no"
            referrerpolicy="strict-origin-when-cross-origin"
            loading="eager"
            allow="autoplay; fullscreen; clipboard-write"
            @load="onMultiReady(layer, i, $event)"
          />
        </template>
        <div v-if="!multiDisplayUrls(layer).length" class="browser-empty">No URLs</div>
        <div v-if="mode === 'editor'" class="browser-shield" aria-hidden="true"></div>
        <div v-if="mode === 'editor'" class="browser-badge">
          Multi Browser · {{ multiDisplayUrls(layer).length }}
          <template v-if="layer.multiBrowser?.queueEnabled !== false">
            · Q{{ multiPendingCount(layer.id) }}
          </template>
          {{ useWebview ? ' · CEF' : '' }}
        </div>
      </div>

      <!-- TTL countdown badge (editor only) -->
      <div v-if="mode === 'editor' && ttlRemaining[layer.id] > 0" class="ttl-badge">⏱ {{ fmt(ttlRemaining[layer.id]) }}</div>
    </div>
    </LayerContextMenu>
  </div>
</template>

<script setup>
import { computed, reactive, watch, onUnmounted, onMounted, ref } from 'vue'
import { Music, Play, Pause, Volume2 } from '@lucide/vue'
import LayerContextMenu from '@/components/shell/LayerContextMenu.vue'
import { isPrimaryButton } from '@/features/safeContextMenu.js'
import { STAGE } from '@shared/schema.js'
import { ytCommand, ytListen, onYtMessage, ytStateInfo, ytPreload } from '../features/youtube.js'
import {
  expectedTime,
  applyTimeline,
  correctToExpected,
  normalizeSyncMode,
  ytEmbedOrigin,
  YT_CORRECT_INTERVAL_MS,
  YT_HEARTBEAT_MS
} from '../features/ytTimeline.js'
import { browserCfgOf, browserSrc, multiBrowserUrls, multiBrowserDirectUrls, pushBrowserAudio } from '../features/browserLayer.js'
import { buildChatisUrl, defaultChatisConfig } from '@shared/chatis.js'
import { createMultiQueue } from '../features/multiBrowserQueue.js'
import { useSceneStore } from '../stores/scene.js'

const emit = defineEmits(['select', 'edit-text', 'fit-aspect', 'media-state', 'audio-ctrl'])
const scene = useSceneStore()

const props = defineProps({
  layers: { type: Array, default: () => [] },
  mode: { type: String, default: 'editor' },
  scale: { type: Number, default: 1 },
  ttlMap: { type: Object, default: () => ({}) }, // id -> seconds remaining (editor only)
  // Latest transient transport command per layer id: { playing?, seek?, nonce }.
  // Applied to <video>/<audio> and to YouTube only in legacy syncMode.
  mediaCtrl: { type: Object, default: () => ({}) }
})

/** LMB selects; RMB is reserved for LayerContextMenu (no move-start side effects). */
function onLayerMouseDown(e, id) {
  if (!isPrimaryButton(e)) return
  emit('select', id)
}

/** Natural size cache for manual "Fit aspect" from context menu. */
const natSizes = new Map()

function menuFitAspect(layer) {
  if (!layer?.id) return
  const cached = natSizes.get(layer.id)
  const v = videoEls.get(layer.id)
  const natW = v?.videoWidth || cached?.w || 0
  const natH = v?.videoHeight || cached?.h || 0
  if (!natW || !natH) return
  layer._aspectFit = false
  emit('fit-aspect', { id: layer.id, natW, natH, force: true })
}

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

// Tick for live timer countdowns (synced via layer.timerEndsAt).
const nowMs = ref(Date.now())
let timerTickId = null
function syncTimerTick() {
  const needs = renderable.value.some((l) => l.type === 'timer' && l.timerEndsAt)
  if (needs && !timerTickId) {
    timerTickId = setInterval(() => { nowMs.value = Date.now() }, 250)
  } else if (!needs && timerTickId) {
    clearInterval(timerTickId)
    timerTickId = null
  }
}
watch(
  () => renderable.value.map((l) => (l.type === 'timer' ? l.timerEndsAt : null)),
  syncTimerTick,
  { immediate: true }
)
onUnmounted(() => {
  if (timerTickId) {
    clearInterval(timerTickId)
    timerTickId = null
  }
})

function formatTimer(layer) {
  let secs
  if (layer.timerEndsAt) {
    // Depend on nowMs so the display updates while counting down.
    void nowMs.value
    secs = Math.max(0, Math.ceil((layer.timerEndsAt - nowMs.value) / 1000))
  } else {
    secs = Math.max(0, Math.floor(Number(layer.timerSeconds) || 0))
  }
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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
// Transport is driven by yt-timeline (serverClock / moderatorMaster) or legacy
// media-ctrl. Native chrome is always off so only the app player can seek.
// enablejsapi=1 + origin open the postMessage command channel.
function ytSyncModeOf(layer) {
  return normalizeSyncMode(layer?.youtube?.syncMode)
}

function ytSrc(layer) {
  if (!layer.src) return ''
  const y = layer.youtube || {}
  const params = new URLSearchParams({
    enablejsapi: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    controls: '0',
    showinfo: '0',
    iv_load_policy: '3',
    cc_load_policy: '0',
    disablekb: '1',
    fs: '0',
    autoplay: '0'
  })
  const origin = ytEmbedOrigin()
  if (origin) params.set('origin', origin)
  if (y.startAt) params.set('start', String(Math.floor(y.startAt)))
  if (y.playlist && y.playlist.length) {
    params.set('listType', 'playlist')
    params.set('playlist', y.playlist.join(','))
  }
  const m = String(layer.src).match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/)
  const id = m ? m[1] : layer.src
  return `https://www.youtube.com/embed/${id}?${params.toString()}`
}

/** OBS shows the iframe only while the player is actually playing (no YT UI). */
function ytObsLive(id) {
  const st = ytState[id]
  if (st?.playing) return true
  const tl = scene.ytTimeline[id]
  return !!(tl && tl.playing && !tl.stop)
}

// browserSrc imported from features/browserLayer.js
/** Electron webview ≈ OBS CEF BrowserSource (top-level guest, ignores XFO). */
const useWebview = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')

function safeBrowserSrc(layer) {
  try { return browserSrc(layer) || 'about:blank' } catch (_) { return 'about:blank' }
}
function multiDisplayUrls(layer) {
  try {
    return useWebview ? multiBrowserDirectUrls(layer) : multiBrowserUrls(layer)
  } catch (_) { return [] }
}

// --- Multi Browser Source exclusive queue ---------------------------------
const multiQueues = new Map()
const multiActive = reactive({})
const multiPending = reactive({})
const multiFrames = new Map() // `${layerId}:${i}` -> el
let multiPollTimer = null

function multiKey(layerId, i) { return `${layerId}:${i}` }

function ensureMultiQueue(layer) {
  const id = layer.id
  const cfg = layer.multiBrowser || {}
  let q = multiQueues.get(id)
  if (!q) {
    q = createMultiQueue({
      enabled: cfg.queueEnabled !== false,
      idleMs: cfg.idleMs,
      minHoldMs: cfg.minHoldMs,
      maxHoldMs: cfg.maxHoldMs,
      onChange: (st) => {
        multiActive[id] = st.active
        multiPending[id] = st.pending.length
        applyMultiAudio(id)
      }
    })
    multiQueues.set(id, q)
  } else {
    q.setEnabled(cfg.queueEnabled !== false)
    q.updateTiming({ idleMs: cfg.idleMs, minHoldMs: cfg.minHoldMs, maxHoldMs: cfg.maxHoldMs })
  }
  return q
}

function multiLocked(layerId) {
  return multiActive[layerId] != null
}
function multiPendingCount(layerId) {
  return multiPending[layerId] || 0
}
function multiFrameClass(layerId, i) {
  const active = multiActive[layerId]
  if (active == null) return {}
  return {
    'is-active': active === i,
    'is-waiting': active !== i
  }
}

function bindMultiFrame(layerId, i, el) {
  const k = multiKey(layerId, i)
  if (el) multiFrames.set(k, el)
  else multiFrames.delete(k)
}

function applyMultiAudio(layerId) {
  const active = multiActive[layerId]
  const queueOn = (() => {
    const layer = props.layers.find((l) => l.id === layerId)
    return layer?.multiBrowser?.queueEnabled !== false
  })()
  for (const [k, el] of multiFrames) {
    if (!k.startsWith(layerId + ':')) continue
    const i = Number(k.slice(layerId.length + 1))
    if (!el || typeof el.setAudioMuted !== 'function') continue
    try {
      if (!queueOn || active == null) el.setAudioMuted(false)
      else el.setAudioMuted(active !== i)
    } catch (_) {}
  }
}

const BROWSER_OVERFLOW_CSS =
  'html,body{overflow:hidden!important;margin:0!important;}' +
  'html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}'

function onMultiReady(layer, i, ev) {
  ensureMultiQueue(layer)
  const el = ev?.target || multiFrames.get(multiKey(layer.id, i))
  if (el) bindMultiFrame(layer.id, i, el)
  try {
    if (el && typeof el.insertCSS === 'function') el.insertCSS(BROWSER_OVERFLOW_CSS)
  } catch (_) {}
  applyMultiAudio(layer.id)
  startMultiPoll()
}

function onMultiMediaStart(layer, i) {
  const q = ensureMultiQueue(layer)
  q.onActivity(i)
  applyMultiAudio(layer.id)
}

function onMultiMediaStop(layer, i) {
  ensureMultiQueue(layer).onIdle(i)
}

async function probeMultiActivity(el) {
  if (!el) return false
  try {
    if (typeof el.executeJavaScript === 'function') {
      return !!(await el.executeJavaScript(
        `(() => { try {
          const media = [...document.querySelectorAll('audio,video')];
          if (media.some(m => !m.paused && !m.ended && m.currentTime > 0)) return true;
          const anim = document.getAnimations ? document.getAnimations() : [];
          if (anim.some(a => a.playState === 'running' && (a.effect?.getTiming?.()?.duration || 0) > 200)) return true;
          return false;
        } catch (e) { return false } })()`
      ))
    }
  } catch (_) {}
  return false
}

function startMultiPoll() {
  if (multiPollTimer) return
  multiPollTimer = setInterval(async () => {
    for (const layer of props.layers) {
      if (layer.type !== 'multiBrowser') continue
      if (layer.multiBrowser?.queueEnabled === false) continue
      const q = ensureMultiQueue(layer)
      const urls = multiDisplayUrls(layer)
      for (let i = 0; i < urls.length; i++) {
        const el = multiFrames.get(multiKey(layer.id, i))
        const busy = await probeMultiActivity(el)
        if (busy) q.onActivity(i)
        else if (q.getActive() === i) q.onIdle(i)
      }
      applyMultiAudio(layer.id)
    }
  }, 700)
}

watch(
  () => props.layers.filter((l) => l.type === 'multiBrowser').map((l) => [
    l.id,
    l.multiBrowser?.queueEnabled,
    l.multiBrowser?.idleMs,
    l.multiBrowser?.minHoldMs,
    l.multiBrowser?.maxHoldMs,
    (l.multiBrowser?.urls || []).join('\n')
  ]),
  () => {
    const ids = new Set()
    for (const l of props.layers) {
      if (l.type !== 'multiBrowser') continue
      ids.add(l.id)
      ensureMultiQueue(l)
    }
    for (const id of [...multiQueues.keys()]) {
      if (!ids.has(id)) {
        multiQueues.get(id)?.destroy()
        multiQueues.delete(id)
        delete multiActive[id]
        delete multiPending[id]
      }
    }
    startMultiPoll()
  },
  { immediate: true, deep: true }
)

onUnmounted(() => {
  if (multiPollTimer) { clearInterval(multiPollTimer); multiPollTimer = null }
  for (const q of multiQueues.values()) q.destroy()
  multiQueues.clear()
})

function browserFrameKey(layer) {
  const cfg = browserCfgOf(layer)
  return `${layer.id}-${cfg.refreshKey || 0}`
}
function browserBadge(layer) {
  const cfg = browserCfgOf(layer)
  if (layer.type === 'chatis' || cfg.source === 'chatis') return 'ChatIS'
  return 'Browser'
}

function directBrowserUrl(layer) {
  const cfg = browserCfgOf(layer)
  let url = cfg.url || layer.src || ''
  if (!url && layer.type === 'chatis' && cfg.channel) {
    url = buildChatisUrl({
      ...defaultChatisConfig(cfg.channel),
      ...(cfg.chatisParams || {})
    })
  }
  url = String(url || '').trim()
  if (!/^https?:\/\//i.test(url)) return ''
  if (cfg.refreshKey) {
    try {
      const u = new URL(url)
      u.searchParams.set('_omo_r', String(cfg.refreshKey))
      return u.toString()
    } catch (_) { return url }
  }
  return url
}

function onWebviewReady(layer, ev) {
  const el = ev?.target || browserFrames.get(layer.id)
  const cfg = browserCfgOf(layer)
  if (!el) return
  try {
    if (typeof el.insertCSS === 'function') {
      el.insertCSS(BROWSER_OVERFLOW_CSS)
      if (cfg.customCss) el.insertCSS(String(cfg.customCss))
    }
  } catch (_) {}
  try {
    if (cfg.controlAudioViaObs && typeof el.setAudioMuted === 'function') {
      el.setAudioMuted(!!cfg.muted || (typeof cfg.volume === 'number' && cfg.volume <= 0))
    }
  } catch (_) {}
}

const browserFrames = new Map()
function bindBrowserFrame(layer, el) {
  if (!layer?.id) return
  if (el) browserFrames.set(layer.id, el)
  else browserFrames.delete(layer.id)
}
function onBrowserLoad(layer, ev) {
  const cfg = browserCfgOf(layer)
  pushBrowserAudio(ev?.target || browserFrames.get(layer.id), cfg)
}

watch(
  () => props.layers.map((l) => {
    if (l.type !== 'browser' && l.type !== 'chatis') return null
    const c = browserCfgOf(l)
    return [l.id, c.volume, c.muted, c.controlAudioViaObs]
  }),
  () => {
    for (const l of props.layers) {
      if (l.type !== 'browser' && l.type !== 'chatis') continue
      pushBrowserAudio(browserFrames.get(l.id), browserCfgOf(l))
    }
  },
  { deep: true }
)

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
const ytPendingTimeline = reactive({}) // id -> timeline snapshot | null
const ytTimelineNonce = reactive({})   // id -> last applied timeline.nonce
const ytLastForceSeekAt = reactive({}) // id -> ms epoch of last hard seek
// Tracks per-id whether we've already buffered the opening segment. The IFrame
// player only fetches data once playback starts, so a brand-new embed left
// paused has nothing buffered — and the moderator's first Play stutters while
// it catches up. When the layer's preload flag is on we kick playback on ready
// and pause it as soon as it starts streaming (state 3/1). ytBuffered guards
// against re-buffering on every subsequent onReady/state delivery.
const ytBuffered = reactive({})        // id -> boolean
const ytAutoHideDone = reactive({})    // id -> bool (once per ended cycle)

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
      ytPendingTimeline[id] = null
      ytBuffered[id] = false
      ytTimelineNonce[id] = null
      ytAutoHideDone[id] = false
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
    ytPendingTimeline[id] = null
    ytBuffered[id] = false
    ytTimelineNonce[id] = null
  }
}

function layerById(id) {
  return props.layers.find((x) => x.id === id)
}

function isLegacyYt(id) {
  const l = layerById(id)
  return !l || l.type !== 'youtube' || ytSyncModeOf(l) === 'legacy'
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

function applyYtTimeline(id, timeline) {
  const el = ytEls.get(id)
  if (!el || !timeline) return false
  if (!ytReady[id]) {
    ytPendingTimeline[id] = timeline
    return false
  }
  ytBuffered[id] = true
  ytTimelineNonce[id] = timeline.nonce
  const exp = expectedTime(timeline)
  applyTimeline(el, timeline, { ready: true })
  if (timeline.forceSeek || timeline.stop) ytLastForceSeekAt[id] = Date.now()
  ensureYt(id).playing = !!timeline.playing && !timeline.stop
  ensureYt(id).current = timeline.forceSeek || timeline.stop ? exp : (ytState[id]?.current ?? exp)
  pushMediaState(id, { playing: !!timeline.playing && !timeline.stop, current: ensureYt(id).current })
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
    // Prefer authoritative timeline (serverClock / moderatorMaster).
    const pendingTl = ytPendingTimeline[id] || scene.ytTimeline[id]
    if (pendingTl && !isLegacyYt(id)) {
      ytPendingTimeline[id] = null
      applyYtTimeline(id, pendingTl)
      ytBuffered[id] = true
      return
    }
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
    if (info.ended) {
      pushMediaState(id, { playing: false })
      handleYtEnded(id)
    } else {
      ytAutoHideDone[id] = false
    }
  } else if (d.event === 'infoDelivery') {
    const id = idForYtSource(source)
    if (id == null) return
    const info = d.info || {}
    if (info.currentTime != null) {
      ensureYt(id).current = info.currentTime
      // In clock modes the UI prefers expected time; still keep raw for correction.
      if (isLegacyYt(id) || props.mode === 'editor') {
        const tl = scene.ytTimeline[id]
        if (tl && !isLegacyYt(id)) {
          pushMediaState(id, { current: expectedTime(tl) })
        } else {
          pushMediaState(id, { current: info.currentTime })
        }
      }
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
      if (si.ended) handleYtEnded(id)
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
  const l = layerById(id)
  return !!l && (l.youtube?.preload !== false)
}
function onYtLoad(layer) {
  const el = ytEls.get(layer.id)
  if (!el) return
  ytListen(el)
  // Settings can't be pushed until onReady (the player would drop them), but
  // re-listening here covers a late @load that missed the initial handshake.
}

function handleYtEnded(id) {
  if (ytAutoHideDone[id]) return
  const l = layerById(id)
  if (!l || l.type !== 'youtube' || !l.youtube?.autoHide) return
  if (props.mode !== 'editor') return
  ytAutoHideDone[id] = true
  if (l.audienceVisible !== false) {
    scene.updateLayer(id, { audienceVisible: false }, { optimistic: true })
  }
}

// Push the layer's persisted video settings (mute/volume/speed) to the embed.
// Editor previewAudio=muted forces mute on the canvas only; OBS uses layer.video.
function applyYtSettings(id) {
  const el = ytEls.get(id)
  const l = layerById(id)
  if (!el || !l) return
  const v = l.video || {}
  const previewMuted = props.mode === 'editor' && (l.youtube?.previewAudio !== 'sound')
  const muted = previewMuted || !!v.muted
  if (muted) ytCommand(el, 'mute')
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

// --- Media transport sync (video + audio + youtube legacy) -----------------
// Watch the latest command per id and apply it to the live element in BOTH
// editor and OBS mode. The nonce lets a repeat (e.g. seek 0 twice) re-fire
// even though the patch object is otherwise identical. State readouts are
// pushed back to the parent via 'media-state' (editor only) so the transport
// bars can show live current/duration/playing.
//
// YouTube in serverClock / moderatorMaster uses yt-timeline instead.
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
      // YouTube — always apply media-ctrl (legacy path). serverClock/moderatorMaster
      // also fan out media-ctrl from ytTransport so OBS cannot miss yt-timeline-only.
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

// Authoritative YouTube timelines — soft drift correction + UI clock.
// Hard transport apply is done via mirrored media-ctrl (see watcher above).
watch(
  () => scene.ytTimeline,
  (map) => {
    for (const id of Object.keys(map || {})) {
      const tl = map[id]
      if (!tl || !tl.nonce) continue
      if (isLegacyYt(id)) continue
      if (props.mode === 'editor' && ytSyncModeOf(layerById(id)) === 'moderatorMaster' && tl._chase) {
        continue
      }
      // Keep pending snapshot for onReady; do not hard-seek here (media-ctrl does).
      if (!ytReady[id]) {
        ytPendingTimeline[id] = tl
        continue
      }
      if (ytTimelineNonce[id] === tl.nonce) continue
      ytTimelineNonce[id] = tl.nonce
      // Soft chase only
      if (tl._chase && props.mode === 'obs') {
        const el = ytEls.get(id)
        const actual = ytState[id]?.current
        correctToExpected(el, tl, actual)
        if (tl.playing) ytCommand(el, 'playVideo')
        else ytCommand(el, 'pauseVideo')
      }
      if (props.mode === 'editor') {
        pushMediaState(id, {
          playing: !!tl.playing && !tl.stop,
          current: expectedTime(tl)
        })
      }
    }
  },
  { deep: true, flush: 'post' }
)

// Keep YouTube mute/volume/speed in sync with the layer's video sub-object
// (and editor previewAudio). The embed doesn't read our props; we push them
// via postMessage on change.
watch(
  () => renderable.value.filter((l) => l.type === 'youtube').map((l) => [
    l.id, !!(l.video?.muted), l.video?.volume, l.video?.speed, l.youtube?.previewAudio
  ]),
  (entries) => {
    for (const [id] of entries) applyYtSettings(id)
  },
  { deep: true, flush: 'post' }
)

// Drift correction + moderatorMaster heartbeat.
let ytCorrectTimer = null
let ytHeartbeatTimer = null

function tickYtCorrect() {
  for (const [id, el] of ytEls) {
    if (!el || !ytReady[id]) continue
    const l = layerById(id)
    if (!l || l.type !== 'youtube') continue
    const mode = ytSyncModeOf(l)
    if (mode === 'legacy') continue
    // In moderatorMaster the editor is the master — don't correct ourselves.
    if (mode === 'moderatorMaster' && props.mode === 'editor') continue
    const tl = scene.ytTimeline[id]
    if (!tl || !tl.playing || tl.stop) {
      if (props.mode === 'editor') scene.setYtSyncStatus(id, { correcting: false, driftMs: 0 })
      continue
    }
    // Cooldown after hard seek — YouTube needs time to buffer; seeking again
    // during that window caused perpetual OBS lag (hypothesis C).
    if (ytLastForceSeekAt[id] && Date.now() - ytLastForceSeekAt[id] < 1200) continue
    const actual = ytState[id]?.current
    const expected = expectedTime(tl)
    const driftMs = actual != null ? Math.round(Math.abs(actual - expected) * 1000) : 0
    const corrected = correctToExpected(el, tl, actual)
    if (corrected) ytLastForceSeekAt[id] = Date.now()
    if (props.mode === 'editor') {
      scene.setYtSyncStatus(id, { correcting: !!corrected, driftMs })
    }
  }
}

function tickYtHeartbeat() {
  if (props.mode !== 'editor') return
  for (const [id] of ytEls) {
    const l = layerById(id)
    if (!l || l.type !== 'youtube') continue
    if (ytSyncModeOf(l) !== 'moderatorMaster') continue
    if (!ytReady[id]) continue
    const st = ytState[id] || {}
    scene.sendYtTime(id, {
      current: st.current || 0,
      playing: !!st.playing,
      rate: l.video?.speed || 1
    })
  }
}

onMounted(() => {
  ytCorrectTimer = setInterval(tickYtCorrect, YT_CORRECT_INTERVAL_MS)
  ytHeartbeatTimer = setInterval(tickYtHeartbeat, YT_HEARTBEAT_MS)
})

onUnmounted(() => {
  if (ytCorrectTimer) { clearInterval(ytCorrectTimer); ytCorrectTimer = null }
  if (ytHeartbeatTimer) { clearInterval(ytHeartbeatTimer); ytHeartbeatTimer = null }
})

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
  if (!natW || !natH) return
  natSizes.set(layer.id, { w: natW, h: natH })
  if (layer._aspectFit) return
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
.layer.interactive:hover:not(.sel) {
  outline: 1.5px solid color-mix(in srgb, var(--fluent-accent, #3b82f6) 80%, #fff);
  outline-offset: 0;
}
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
  flex: none;
  color: #fff;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.3));
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
.ap-vol-icon { flex: none; opacity: .9; }
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
.yt-body { width: 100%; height: 100%; background: #000; position: relative; overflow: hidden; }
.yt-body iframe { width: 100%; height: 100%; border: 0; }
.yt-obs-clean iframe { pointer-events: none; }
.yt-obs-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: #000;
  pointer-events: none;
}
.browser-body { width: 100%; height: 100%; position: relative; background: transparent; overflow: hidden; }
.browser-frame { width: 100%; height: 100%; border: 0; background: transparent; pointer-events: none; }
.multi-browser .multi-frame { position: absolute; inset: 0; }
.multi-browser.is-locked .multi-frame.is-waiting {
  opacity: 0 !important;
  visibility: hidden;
  pointer-events: none;
}
.multi-browser.is-locked .multi-frame.is-active {
  opacity: 1;
  z-index: 1;
}
.browser-shield { position: absolute; inset: 0; z-index: 2; cursor: pointer; background: transparent; }
.browser-empty {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; color: rgba(255,255,255,.5); font-size: 14px;
  background: rgba(20,20,30,.6);
}
.browser-badge {
  position: absolute; top: 4px; left: 4px; font-size: 10px; padding: 2px 6px;
  background: rgba(0,0,0,.65); color: #fff; border-radius: 4px; pointer-events: none;
}
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
