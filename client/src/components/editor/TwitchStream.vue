<!--
  TwitchStream.vue — floating PiP Twitch player (Fluent AppFloatWindow chrome).
-->
<template>
  <!-- Embedded: inline player inside Twitch hub tabs -->
  <div v-if="embedded && open" class="ts-embed">
    <div v-if="!channel" class="ts-embed-empty muted">
      Set a Twitch channel in Settings or open Stream from Tools first.
    </div>
    <div v-else class="ts-embed-player">
      <iframe
        v-if="embedUrl"
        :src="embedUrl"
        frameborder="0"
        scrolling="no"
        allowfullscreen
        allow="autoplay; fullscreen"
        class="ts-iframe"
      ></iframe>
    </div>
  </div>
  <Transition v-else name="fluent-float">
    <AppFloatWindow
      v-if="active"
      :title="t('panel.streamTitle', { channel })"
      :minimized="minimized"
      :style="floatStyle"
      class="ts-float"
      @close="close"
      @toggle-minimize="toggleMinimize"
      @drag-start="startDrag"
      @reset-position="resetPosition"
    >
      <template #icon><Tv class="h-3.5 w-3.5 shrink-0" /></template>
      <div class="ts-player-wrap" :style="{ width: playerW + 'px', height: playerH + 'px' }">
        <iframe
          v-if="channel && embedUrl"
          :src="embedUrl"
          frameborder="0"
          scrolling="no"
          allowfullscreen
          allow="autoplay; fullscreen"
          class="ts-iframe"
        ></iframe>
        <div v-if="dragging || resizing" class="ts-overlay"></div>
      </div>
      <template #resize>
        <div v-show="!minimized" class="ts-resize" @mousedown.stop.prevent="startResize"></div>
      </template>
    </AppFloatWindow>
  </Transition>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Tv } from '@lucide/vue'
import { useI18n } from '@/i18n'
import AppFloatWindow from '@/components/shell/AppFloatWindow.vue'

const { t } = useI18n()

const props = defineProps({
  channel: { type: String, default: '' },
  open: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const active = ref(false)
const minimized = ref(false)
const posX = ref(20)
const posY = ref(80)
const playerW = ref(400)
const playerH = ref(225)

let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0
let resizing = false
let resizeStartW = 0
let resizeStartX = 0

const embedUrl = computed(() => {
  if (!props.channel) return ''
  const ch = props.channel.toLowerCase().replace(/^#/, '')
  const host = location.hostname || 'localhost'
  const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(host)
  if (isIP) return `/api/twitch/embed?channel=${ch}`
  return `https://player.twitch.tv/?channel=${ch}&parent=${host}&muted=false&autoplay=true`
})

const floatStyle = computed(() => ({
  left: posX.value + 'px',
  top: posY.value + 'px',
  zIndex: 200
}))

onMounted(() => {
  const savedPos = localStorage.getItem('omo_stream_pos')
  if (savedPos) {
    try {
      const p = JSON.parse(savedPos)
      posX.value = p.x ?? 20
      posY.value = p.y ?? 80
    } catch (_) { /* ignore */ }
  }
  const savedSize = localStorage.getItem('omo_stream_size')
  if (savedSize) {
    try {
      const sz = JSON.parse(savedSize)
      playerW.value = sz.w ?? 400
      playerH.value = sz.h ?? 225
    } catch (_) { /* ignore */ }
  }
  active.value = props.open && !!props.channel
})

watch(() => [props.open, props.channel], ([isOpen, ch]) => {
  active.value = isOpen && !!ch
})

function savePos() {
  localStorage.setItem('omo_stream_pos', JSON.stringify({ x: posX.value, y: posY.value }))
}
function saveSize() {
  localStorage.setItem('omo_stream_size', JSON.stringify({ w: playerW.value, h: playerH.value }))
}
function resetPosition() {
  posX.value = 20
  posY.value = 80
  savePos()
}

function startResize(e) {
  resizing = true
  resizeStartW = playerW.value
  resizeStartX = e.clientX
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e) {
  if (!resizing) return
  const newW = Math.max(240, Math.min(960, resizeStartW + (e.clientX - resizeStartX)))
  playerW.value = newW
  playerH.value = Math.round(newW * 9 / 16)
}

function stopResize() {
  if (resizing) { resizing = false; saveSize() }
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}

function startDrag(e) {
  dragging = true
  dragOffsetX = e.clientX - posX.value
  dragOffsetY = e.clientY - posY.value
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e) {
  if (!dragging) return
  posX.value = Math.max(0, Math.min(window.innerWidth - 240, e.clientX - dragOffsetX))
  posY.value = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffsetY))
}

function stopDrag() {
  if (dragging) { dragging = false; savePos() }
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

function toggleMinimize() { minimized.value = !minimized.value }
function close() { active.value = false; emit('close') }

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
})
</script>

<style scoped>
.ts-float { z-index: 200; }
.ts-player-wrap { position: relative; background: #000; }
.ts-iframe { width: 100%; height: 100%; border: none; display: block; }
.ts-overlay { position: absolute; inset: 0; z-index: 5; }
.ts-resize {
  position: absolute; bottom: 0; right: 0;
  width: 16px; height: 16px; cursor: se-resize; z-index: 6;
  background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.35) 50%);
}
.ts-embed {
  display: flex;
  flex-direction: column;
  min-height: 220px;
  padding: 10px;
}
.ts-embed-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  font-size: 12px;
}
.ts-embed-player {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
}
.ts-embed-player .ts-iframe { width: 100%; height: 100%; }
</style>
