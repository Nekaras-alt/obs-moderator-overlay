<!--
  TwitchPastes — PiP (AppFloatWindow) with direct site load + zoom + send-to-Twitch.
  Electron: <webview> (no HTML rewrite proxy). Browser: iframe + external Open.
-->
<template>
  <component
    :is="embedded ? 'div' : AppFloatWindow"
    v-if="embedded ? open : active"
    v-bind="embedded ? { class: 'tp-embed' } : {
      title: t('panel.pastes'),
      minimized,
      style: floatStyle,
      class: 'tp-float'
    }"
    @close="close"
    @toggle-minimize="toggleMinimize"
    @drag-start="startDrag"
    @reset-position="resetPosition"
  >
    <template v-if="!embedded" #icon>
      <ClipboardPaste class="h-3.5 w-3.5 shrink-0" />
    </template>
    <template v-if="!embedded" #actions>
      <Button size="sm" variant="secondary" class="h-7" :disabled="oauthBusy" @click.stop="connectTwitch">
        <Check v-if="twitchLogin" class="h-3.5 w-3.5" />
        {{ twitchLogin || 'Twitch' }}
      </Button>
    </template>

    <div class="tp-pip" :style="embedded ? undefined : { width: pipW + 'px' }">
      <div class="tp-toolbar">
        <div class="tabs fluent-tabs">
          <button :class="{ active: tab === 'twitchpaste' }" @click="tab = 'twitchpaste'">twitchpaste</button>
          <button :class="{ active: tab === 'copypastas' }" @click="tab = 'copypastas'">copypastas</button>
          <button :class="{ active: tab === 'custom' }" @click="tab = 'custom'">Quick</button>
        </div>
        <Button v-if="embedded" size="sm" variant="secondary" :disabled="oauthBusy" @click="connectTwitch">
          <Check v-if="twitchLogin" class="h-3.5 w-3.5" />
          {{ twitchLogin || 'Connect Twitch' }}
        </Button>
      </div>

      <div v-if="deviceAuth" class="device-box">
        <p>Код: <strong class="code">{{ deviceAuth.userCode }}</strong>
          · <a :href="deviceAuth.uri" target="_blank" rel="noopener">{{ deviceAuth.uri }}</a></p>
      </div>

      <div v-if="tab !== 'custom'" class="tp-frame" :style="{ height: (embedded ? 280 : frameH) + 'px' }">
        <webview
          v-if="useWebview"
          ref="wvRef"
          class="frame"
          :src="siteUrl"
          allowpopups
          webpreferences="contextIsolation=yes, javascript=yes, webSecurity=yes"
          @dom-ready="onFrameReady"
        />
        <iframe
          v-else
          class="frame"
          :src="siteUrl"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
          referrerpolicy="no-referrer-when-downgrade"
        />
      </div>

      <div class="send-row">
        <div v-if="tab !== 'custom' && useWebview" class="zoom-row">
          <span class="muted small">Zoom</span>
          <Button size="sm" variant="ghost" class="h-7 w-7" @click="setZoom(zoom - 0.1)">−</Button>
          <input type="range" min="0.5" max="2" step="0.05" :value="zoom" @input="setZoom(+$event.target.value)" />
          <Button size="sm" variant="ghost" class="h-7 w-7" @click="setZoom(zoom + 0.1)">+</Button>
          <span class="muted small">{{ Math.round(zoom * 100) }}%</span>
        </div>
        <textarea v-model="draft" rows="2" placeholder="Текст для чата (Grab = selection / clipboard)…" />
        <div class="row">
          <Button size="sm" variant="secondary" :disabled="!useWebview" @click="grabSelection">Grab</Button>
          <Button size="sm" variant="secondary" @click="copyDraft"><Copy class="h-3.5 w-3.5" /></Button>
          <a class="link" :href="siteUrl" target="_blank" rel="noopener">Open <ExternalLink class="h-3 w-3 inline" /></a>
          <Button size="sm" :disabled="!draft.trim() || sendBusy" @click="sendChat">Send to Twitch</Button>
        </div>
        <p v-if="status" class="status" :class="{ err: statusErr }">{{ status }}</p>
      </div>
    </div>

    <template v-if="!embedded" #resize>
      <div v-show="!minimized" class="tp-resize" @mousedown.stop.prevent="startResize"></div>
    </template>
  </component>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ClipboardPaste, Check, ExternalLink, Copy } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import AppFloatWindow from '@/components/shell/AppFloatWindow.vue'

const props = defineProps({
  open: Boolean,
  embedded: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
const scene = useSceneStore()
const { t } = useI18n()

const useWebview = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')
const tab = ref('twitchpaste')
const draft = ref('')
const twitchLogin = ref('')
const oauthBusy = ref(false)
const sendBusy = ref(false)
const status = ref('')
const statusErr = ref(false)
const deviceAuth = ref(null)
const zoom = ref(1)
const wvRef = ref(null)
let pollTimer = null

const active = ref(false)
const minimized = ref(false)
const posX = ref(40)
const posY = ref(70)
const pipW = ref(520)
const frameH = ref(420)

const SITES = {
  twitchpaste: 'https://twitchpaste.ru',
  copypastas: 'https://copypastas.ru'
}

const siteUrl = computed(() => SITES[tab.value] || SITES.twitchpaste)
const floatStyle = computed(() => ({
  left: posX.value + 'px',
  top: posY.value + 'px',
  zIndex: 210
}))

function authHeaders() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('omo_token') || ''), 'Content-Type': 'application/json' }
}

function webviewEl() {
  const el = wvRef.value
  return el && typeof el === 'object' ? el : null
}

async function refreshStatus() {
  try {
    const r = await fetch('/api/twitch/oauth/status', { headers: authHeaders() }).then((x) => x.json())
    twitchLogin.value = r.connected ? (r.login || 'connected') : ''
    if (r.connected) deviceAuth.value = null
  } catch (_) { twitchLogin.value = '' }
}

async function connectTwitch() {
  oauthBusy.value = true
  status.value = ''
  statusErr.value = false
  try {
    const r = await fetch('/api/twitch/oauth/device/start', {
      method: 'POST', headers: authHeaders()
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'Device auth failed')
    deviceAuth.value = { userCode: r.userCode, uri: r.verificationUri, deviceCode: r.deviceCode }
    if (r.verificationUri) window.open(r.verificationUri, 'twitch-device', 'width=520,height=720')
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = setInterval(async () => {
      const p = await fetch('/api/twitch/oauth/device/poll?device_code=' + encodeURIComponent(r.deviceCode), {
        headers: authHeaders()
      }).then((x) => x.json())
      if (p.connected) {
        clearInterval(pollTimer)
        pollTimer = null
        twitchLogin.value = p.login || 'connected'
        deviceAuth.value = null
        status.value = 'Twitch connected'
      } else if (!p.pending) {
        clearInterval(pollTimer)
        pollTimer = null
        statusErr.value = true
        status.value = 'Auth expired — try again'
        deviceAuth.value = null
      }
    }, 3000)
  } catch (e) {
    statusErr.value = true
    status.value = e.message
  } finally {
    oauthBusy.value = false
  }
}

function onFrameReady(ev) {
  const el = ev?.target || webviewEl()
  applyZoom(el)
}

function applyZoom(el = webviewEl()) {
  if (!el) return
  try {
    if (typeof el.setZoomFactor === 'function') el.setZoomFactor(zoom.value)
  } catch (_) {}
}

function setZoom(z) {
  zoom.value = Math.max(0.5, Math.min(2, Number(z) || 1))
  localStorage.setItem('omo_pastes_zoom', String(zoom.value))
  applyZoom()
}

async function grabSelection() {
  const el = webviewEl()
  if (!el || typeof el.executeJavaScript !== 'function') {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip?.trim()) draft.value = clip.trim()
    } catch (_) {}
    return
  }
  try {
    const sel = await el.executeJavaScript(
      `(function(){try{return (window.getSelection&&window.getSelection().toString())||''}catch(e){return ''}})()`
    )
    if (String(sel || '').trim()) {
      draft.value = String(sel).trim()
      return
    }
    const clip = await navigator.clipboard.readText()
    if (clip?.trim()) draft.value = clip.trim()
  } catch (_) {}
}

async function sendChat() {
  sendBusy.value = true
  statusErr.value = false
  status.value = ''
  try {
    const channel = scene.settings.twitchChannel || localStorage.getItem('omo_twitch_channel') || ''
    const r = await fetch('/api/twitch/chat/send', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: draft.value, channelLogin: channel })
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'send failed')
    status.value = 'Sent!'
  } catch (e) {
    statusErr.value = true
    status.value = e.message
  } finally {
    sendBusy.value = false
  }
}

async function copyDraft() {
  try { await navigator.clipboard.writeText(draft.value) } catch (_) {}
}

function savePos() {
  localStorage.setItem('omo_pastes_pos', JSON.stringify({ x: posX.value, y: posY.value }))
}
function resetPosition() {
  posX.value = 40
  posY.value = 70
  savePos()
}
function saveSize() {
  localStorage.setItem('omo_pastes_size', JSON.stringify({ w: pipW.value, h: frameH.value }))
}

let dragging = false
let dragOffsetX = 0
let dragOffsetY = 0
let resizing = false
let resizeStartW = 0
let resizeStartH = 0
let resizeStartX = 0
let resizeStartY = 0

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
function startResize(e) {
  resizing = true
  resizeStartW = pipW.value
  resizeStartH = frameH.value
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}
function onResize(e) {
  if (!resizing) return
  pipW.value = Math.max(360, Math.min(1100, resizeStartW + (e.clientX - resizeStartX)))
  frameH.value = Math.max(200, Math.min(800, resizeStartH + (e.clientY - resizeStartY)))
}
function stopResize() {
  if (resizing) { resizing = false; saveSize() }
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
}

function toggleMinimize() { minimized.value = !minimized.value }
function close() { active.value = false; emit('close') }

onMounted(() => {
  const z = Number(localStorage.getItem('omo_pastes_zoom'))
  if (z >= 0.5 && z <= 2) zoom.value = z
  try {
    const p = JSON.parse(localStorage.getItem('omo_pastes_pos') || 'null')
    if (p) { posX.value = p.x ?? 40; posY.value = p.y ?? 70 }
  } catch (_) {}
  try {
    const s = JSON.parse(localStorage.getItem('omo_pastes_size') || 'null')
    if (s) {
      pipW.value = Math.max(360, Math.min(1100, s.w ?? 520))
      frameH.value = Math.max(220, Math.min(700, s.h ?? 420))
    }
  } catch (_) {}
  active.value = props.open && !props.embedded
  refreshStatus()
})
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer) })
watch(() => props.open, (v) => {
  if (!props.embedded) active.value = !!v
})
watch(() => scene.settings.twitchChannel, refreshStatus)
</script>

<style scoped>
.tp-embed {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tp-float { max-width: calc(100vw - 16px); }
.tp-pip {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  background: var(--bg-2, #1e1f22);
}
.tp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--fluent-stroke);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.device-box {
  padding: 6px 10px;
  font-size: 12px;
  border-bottom: 1px solid var(--fluent-stroke);
  flex-shrink: 0;
}
.device-box .code { font-size: 16px; letter-spacing: 0.1em; }
.tp-frame {
  position: relative;
  width: 100%;
  flex: 0 0 auto;
  background: #111;
  overflow: hidden;
}
.frame {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  border: 0;
  background: #111;
  display: inline-flex;
}
.send-row {
  border-top: 1px solid var(--fluent-stroke);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  background: var(--bg-2, #1e1f22);
}
.zoom-row { display: flex; align-items: center; gap: 6px; }
.zoom-row input[type="range"] { flex: 1; min-width: 80px; }
.row { display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.link { font-size: 12px; color: var(--fluent-accent); display: inline-flex; align-items: center; gap: 4px; }
.status { font-size: 12px; margin: 0; color: var(--ok); }
.status.err { color: var(--danger); }
textarea { width: 100%; resize: vertical; }
.tp-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
}
</style>
