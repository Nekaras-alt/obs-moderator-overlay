<!--
  ObsPreviewPanel.vue
  Floating PiP showing OBS Program/Preview.
  Prefers WHEP (MediaMTX) when OBS_PREVIEW_WHEP_URL is set on the server;
  otherwise streams MJPEG from /api/obs/preview.mjpeg (subscriber-gated).
-->
<template>
  <AppFloatWindow
    v-if="open"
    :title="t('panel.obsPreview')"
    :minimized="minimized"
    :style="floatStyle"
    class="op-float"
    @close="close"
    @toggle-minimize="toggleMinimize"
    @drag-start="startDrag"
    @reset-position="resetPosition"
  >
    <template #icon><MonitorPlay class="h-3.5 w-3.5 shrink-0" /></template>
    <template #meta>
      <span class="op-mode muted">{{ modeLabel }}</span>
    </template>
    <div class="op-body" :style="{ width: playerW + 'px', height: playerH + 'px' }">
      <video
        v-if="useWhep"
        ref="videoEl"
        class="op-media"
        autoplay
        playsinline
        muted
      />
      <img
        v-else-if="mjpegUrl"
        class="op-media"
        :src="mjpegUrl"
        alt="OBS preview"
      />
      <div v-else class="op-empty muted">
        <template v-if="!scene.obsConnected">Connect OBS to see preview.</template>
        <template v-else-if="status?.lastError">{{ status.lastError }}</template>
        <template v-else>Starting preview…</template>
      </div>
      <div v-if="isDragging || isResizing" class="op-overlay"></div>
    </div>
    <template #resize>
      <div v-show="!minimized" class="op-resize" @mousedown.stop.prevent="startResize"></div>
    </template>
  </AppFloatWindow>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { MonitorPlay } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import AppFloatWindow from '@/components/shell/AppFloatWindow.vue'

const { t } = useI18n()

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const scene = useSceneStore()
const minimized = ref(false)
const posX = ref(Number(localStorage.getItem('omo_obs_prev_x')) || 24)
const posY = ref(Number(localStorage.getItem('omo_obs_prev_y')) || 120)
const playerW = ref(Number(localStorage.getItem('omo_obs_prev_w')) || 480)
const playerH = ref(Number(localStorage.getItem('omo_obs_prev_h')) || 270)
const videoEl = ref(null)
const isDragging = ref(false)
const isResizing = ref(false)

let dragOffsetX = 0
let dragOffsetY = 0
let resizeStartW = 0
let resizeStartX = 0
let pc = null

const status = computed(() => scene.obsPreviewStatus)
const useWhep = computed(() => !!(status.value?.whepUrl))
const modeLabel = computed(() => {
  if (useWhep.value) return 'WHEP'
  if (props.open && scene.obsConnected) return `MJPEG ${status.value?.fps || 4}fps`
  return '—'
})

const mjpegUrl = computed(() => {
  if (!props.open || !scene.obsConnected || useWhep.value) return ''
  const token = localStorage.getItem('omo_token') || ''
  const path = status.value?.mjpegPath || '/api/obs/preview.mjpeg'
  return `${path}?t=${encodeURIComponent(token)}&_=${scene.obsLayoutRev || 0}`
})

const floatStyle = computed(() => ({
  left: posX.value + 'px',
  top: posY.value + 'px'
}))

function close() { emit('close') }
function toggleMinimize() { minimized.value = !minimized.value }

function persist() {
  localStorage.setItem('omo_obs_prev_x', String(posX.value))
  localStorage.setItem('omo_obs_prev_y', String(posY.value))
  localStorage.setItem('omo_obs_prev_w', String(playerW.value))
  localStorage.setItem('omo_obs_prev_h', String(playerH.value))
}
function resetPosition() {
  posX.value = 24
  posY.value = 80
  persist()
}

function startDrag(e) {
  if (e.button !== 0) return
  isDragging.value = true
  dragOffsetX = e.clientX - posX.value
  dragOffsetY = e.clientY - posY.value
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}

function onDrag(e) {
  if (!isDragging.value) return
  posX.value = Math.max(0, e.clientX - dragOffsetX)
  posY.value = Math.max(0, e.clientY - dragOffsetY)
}

function endDrag() {
  isDragging.value = false
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  persist()
}

function startResize(e) {
  isResizing.value = true
  resizeStartW = playerW.value
  resizeStartX = e.clientX
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', endResize)
}

function onResize(e) {
  if (!isResizing.value) return
  const dw = e.clientX - resizeStartX
  const w = Math.max(240, resizeStartW + dw)
  playerW.value = w
  playerH.value = Math.round(w * 9 / 16)
}

function endResize() {
  isResizing.value = false
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
  persist()
}

async function refreshStatus() {
  try {
    const token = localStorage.getItem('omo_token') || ''
    const r = await fetch('/api/obs/preview-status', {
      headers: { Authorization: 'Bearer ' + token }
    })
    const data = await r.json()
    scene.obsPreviewStatus = {
      mode: data.mode || null,
      whepUrl: data.whepUrl || null,
      mjpegPath: data.mjpegPath || '/api/obs/preview.mjpeg',
      fps: data.fps || 4,
      width: data.width || 960,
      connected: !!data.connected,
      lastError: data.lastError || null
    }
  } catch (_) { /* ignore */ }
}

async function startWhep() {
  stopWhep()
  const url = status.value?.whepUrl
  if (!url || !videoEl.value) return
  try {
    pc = new RTCPeerConnection()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = (ev) => {
      if (videoEl.value) videoEl.value.srcObject = ev.streams[0]
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp
    })
    if (!r.ok) throw new Error('WHEP ' + r.status)
    const answer = await r.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  } catch (e) {
    console.warn('[obs-preview] WHEP failed, use MJPEG:', e)
    stopWhep()
    if (scene.obsPreviewStatus) {
      scene.obsPreviewStatus = { ...scene.obsPreviewStatus, whepUrl: null, lastError: String(e.message || e) }
    }
  }
}

function stopWhep() {
  try { pc?.close() } catch (_) { /* ignore */ }
  pc = null
  if (videoEl.value) videoEl.value.srcObject = null
}

watch(
  () => [props.open, useWhep.value, status.value?.whepUrl, scene.obsConnected],
  async () => {
    if (!props.open) {
      stopWhep()
      return
    }
    await refreshStatus()
    await nextTick()
    if (useWhep.value) await startWhep()
    else stopWhep()
  },
  { immediate: true }
)

onMounted(() => { if (props.open) refreshStatus() })
onUnmounted(() => {
  stopWhep()
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', endResize)
})
</script>

<style scoped>
.op-float { z-index: 120; }
.op-mode { font-size: 10px; font-weight: 500; margin-left: 4px; }
.op-body {
  position: relative;
  background: #000;
  max-width: 90vw;
  max-height: 70vh;
}
.op-media {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
}
.op-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; padding: 12px; text-align: center;
}
.op-overlay { position: absolute; inset: 0; z-index: 2; }
.op-resize {
  position: absolute; right: 0; bottom: 0;
  width: 14px; height: 14px; cursor: se-resize; z-index: 3;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%);
}
</style>
