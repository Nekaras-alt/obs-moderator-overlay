<!--
  EditorView.vue
  PIN gate → Fluent AppShell (CommandBar / NavigationView / Canvas / Inspector / StatusBar).
  Floating overlays dock top-right; Twitch dock pushes the main columns.
  Owns the single useDnd() instance for whole-shell media drops.
-->
<template>
  <div
    ref="editorRoot"
    :class="['editor', themeClass, densityClass]"
    @dragover.prevent="dnd.onDragOver"
    @dragleave.prevent="dnd.onDragLeave"
    @drop.prevent="dnd.onDrop"
  >
    <AppTitleBar />

    <LoginView
      v-if="!authed"
      v-model="pin"
      v-model:pin-confirm="pinConfirm"
      :error="loginError"
      :busy="loginBusy"
      :needs-setup="needsSetup"
      @submit="login"
    />

    <template v-else>
      <ConnectionBanner :server-ok="serverOk" />
      <AppShell
        :panels="panels"
        :stream-open="streamOpen"
        :dock-open="dockOpen"
        v-model:nav-collapsed="navCollapsed"
        v-model:inspector-sheet-open="inspectorSheetOpen"
        @toggle-panel="togglePanel"
        @toggle-inspector="inspectorSheetOpen = !inspectorSheetOpen"
        @open-palette="paletteOpen = true"
        @open-settings="openSettings"
        @open-help="togglePanel('help')"
      >
      <template #main>
        <Canvas />
      </template>

      <template #dock>
        <aside v-if="dockOpen" class="twitch-dock" @submit.prevent>
          <div class="dock-head">
            <span class="dock-title">
              <MessageSquare class="h-3.5 w-3.5" />
              Twitch Dock
            </span>
            <Input
              ref="dockInputEl"
              v-model="dockChannelDraft"
              class="dock-ch"
              placeholder="channel"
              @keydown.enter.prevent="saveDockChannel"
              @change="saveDockChannel"
            />
            <Button variant="ghost" size="icon" class="h-7 w-7" type="button" @click="dockOpen = false">
              <X class="h-4 w-4" />
            </Button>
          </div>
          <iframe
            v-if="dockChannelLive && dockChatUrl"
            class="dock-chat"
            :src="dockChatUrl"
            :key="'chat-' + dockChannelLive"
            frameborder="0"
            referrerpolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
          ></iframe>
          <iframe
            v-if="dockChannelLive && dockPlayerUrl"
            class="dock-player"
            :src="dockPlayerUrl"
            :key="'player-' + dockChannelLive"
            frameborder="0"
            referrerpolicy="no-referrer"
            allowfullscreen
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
          ></iframe>
          <div v-else-if="!dockChannelLive" class="dock-empty muted">
            Enter a channel name and press Enter.
          </div>
        </aside>
      </template>

      <template #overlays>
        <Transition name="fluent-panel">
          <PresetPanel v-if="panels.presets" :open="true" @close="panels.presets = false" />
        </Transition>
        <Transition name="fluent-panel">
          <TrashPanel v-if="panels.trash" :open="true" @close="panels.trash = false" />
        </Transition>
        <Transition name="fluent-panel">
          <ObsSourcesPanel v-if="panels.obs" :open="true" @close="panels.obs = false" />
        </Transition>
        <Transition name="fluent-float">
          <ObsPreviewPanel v-if="panels.obsPreview" :open="true" @close="panels.obsPreview = false" />
        </Transition>
        <Transition name="fluent-panel">
          <Settings v-if="panels.settings" :open="true" :initial-tab="settingsTab" @close="closeSettings" />
        </Transition>
        <Transition name="fluent-panel">
          <HelpPanel
            v-if="panels.help"
            :open="true"
            @close="panels.help = false"
            @start-tour="startTour"
          />
        </Transition>
        <Transition name="fluent-panel">
          <EmotePanel v-if="panels.stickers" :open="true" @close="panels.stickers = false" />
        </Transition>
        <Transition name="fluent-panel">
          <SoundPadPanel v-if="panels.soundpad" :open="true" @close="panels.soundpad = false" />
        </Transition>
        <Transition name="fluent-panel">
          <TwitchHubPanel
            v-if="panels.twitch"
            :open="true"
            :channel="streamChannel"
            @close="panels.twitch = false"
          />
        </Transition>
        <Transition name="fluent-panel">
          <TwitchPastes v-if="panels.pastes" :open="true" @close="panels.pastes = false" />
        </Transition>
        <Transition name="fluent-panel">
          <JeetbotPanel v-if="panels.jeetbot" :open="true" @close="panels.jeetbot = false" />
        </Transition>
        <Transition name="fluent-panel">
          <SpotifyPanel v-if="panels.spotify" :open="true" @close="panels.spotify = false" />
        </Transition>
        <Transition name="fluent-panel">
          <DonationLogPanel v-if="panels.donations" :open="true" @close="panels.donations = false" />
        </Transition>

        <TwitchStream
          :channel="streamChannel"
          :open="streamOpen"
          @close="streamOpen = false"
        />

        <YoutubeManager />
        <SoundPlayer />
        <ToastNotifications />

        <Modal
          :open="streamModalOpen"
          title="Open your Twitch stream"
          confirm-label="Open stream"
          confirm-class="primary"
          @confirm="confirmStreamChannel"
          @cancel="streamModalOpen = false"
        >
          <div style="display:flex;flex-direction:column;gap:10px">
            <p class="muted small" style="margin:0">
              Enter your Twitch channel name. The stream will open as a
              picture-in-picture player inside the editor.
            </p>
            <Input
              v-model="streamChannelInput"
              placeholder="your channel name (e.g. aptixtw)"
              class="text-[15px] h-10"
              @keydown.enter="confirmStreamChannel"
            />
          </div>
        </Modal>
      </template>
    </AppShell>

      <CommandPalette
        v-model:open="paletteOpen"
        @action="onPaletteAction"
      />
      <OnboardingTour
        :open="tourOpen"
        @done="finishTour"
        @skip="finishTour"
        @prepare-step="onTourStep"
      />
      <DndGhost :active="dnd.dragOver.value" :file-count="dnd.dragFileCount.value" />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, provide, watch, nextTick } from 'vue'
import { MessageSquare, X } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { socket } from '../../services/ws.js'
import { useDnd } from '../../features/dnd.js'
import { useUiPrefs } from '@/features/uiPrefs.js'
import { useI18n } from '@/i18n'
import AppShell from '../shell/AppShell.vue'
import AppTitleBar from '../shell/AppTitleBar.vue'
import ConnectionBanner from '../shell/ConnectionBanner.vue'
import CommandPalette from '../shell/CommandPalette.vue'
import OnboardingTour from '../shell/OnboardingTour.vue'
import HelpPanel from '../shell/HelpPanel.vue'
import DndGhost from '../shell/DndGhost.vue'
import LoginView from '../shell/LoginView.vue'
import Canvas from './Canvas.vue'
import PresetPanel from './PresetPanel.vue'
import TrashPanel from './TrashPanel.vue'
import ObsSourcesPanel from './ObsSourcesPanel.vue'
import ObsPreviewPanel from './ObsPreviewPanel.vue'
import Settings from './Settings.vue'
import EmotePanel from './EmotePanel.vue'
import SoundPadPanel from './SoundPadPanel.vue'
import TwitchHubPanel from './TwitchHubPanel.vue'
import TwitchStream from './TwitchStream.vue'
import TwitchPastes from './TwitchPastes.vue'
import JeetbotPanel from './JeetbotPanel.vue'
import SpotifyPanel from './SpotifyPanel.vue'
import DonationLogPanel from './DonationLogPanel.vue'
import YoutubeManager from './YoutubeManager.vue'
import SoundPlayer from './SoundPlayer.vue'
import Modal from '../ui/Modal.vue'
import ToastNotifications from '../ui/ToastNotifications.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const scene = useSceneStore()
const { t } = useI18n()
const { prefs, densityClass, applyAccentToDocument, isPinned, setTourDone } = useUiPrefs()
const authed = ref(false)
const pin = ref('')
const pinConfirm = ref('')
const loginError = ref('')
const loginBusy = ref(false)
const needsSetup = ref(false)
const navCollapsed = ref(!!prefs.navCollapsed)
const inspectorSheetOpen = ref(false)
const paletteOpen = ref(false)
const tourOpen = ref(false)
const tourOpenedInspector = ref(false)
const serverOk = ref(true)
const editorRoot = ref(null)
let pingTimer = null
const themeClass = computed(() => 'theme-' + (scene.settings.theme || 'dark'))

watch(navCollapsed, (v) => { prefs.navCollapsed = !!v })
watch(() => prefs.navCollapsed, (v) => { if (navCollapsed.value !== !!v) navCollapsed.value = !!v })
watch(
  () => [prefs.accentId, prefs.customAccent, themeClass.value, authed.value],
  () => {
    if (editorRoot.value) applyAccentToDocument(editorRoot.value)
  }
)

const dnd = useDnd()
provide('dnd', dnd)
provide('openCommandPalette', () => { paletteOpen.value = true })

const panels = reactive({
  presets: false, trash: false, obs: false, obsPreview: false, settings: false, help: false, stickers: false,
  soundpad: false, twitch: false, pastes: false, jeetbot: false, spotify: false, donations: false
})
const settingsTab = ref('')

function openSettings(tab) {
  settingsTab.value = tab || 'connector'
  for (const k of Object.keys(panels)) {
    if (k === 'obsPreview') continue
    if (k === 'settings') continue
    if (isPinned(k)) continue
    panels[k] = false
  }
  panels.settings = true
}

function closeSettings() {
  panels.settings = false
  settingsTab.value = ''
}

const streamChannel = ref(localStorage.getItem('omo_twitch_channel') || '')
const streamOpen = ref(false)
const streamModalOpen = ref(false)
const streamChannelInput = ref('')
const dockOpen = ref(false)
const dockChannelDraft = ref(localStorage.getItem('omo_twitch_channel') || '')
const dockChannelLive = ref(localStorage.getItem('omo_twitch_channel') || '')
const dockInputEl = ref(null)

const dockChatUrl = computed(() => {
  const ch = (dockChannelLive.value || '').trim().replace(/^#/, '').toLowerCase()
  if (!ch) return ''
  return `/api/twitch/embed-chat?channel=${encodeURIComponent(ch)}`
})
const dockPlayerUrl = computed(() => {
  const ch = (dockChannelLive.value || '').trim().replace(/^#/, '').toLowerCase()
  if (!ch) return ''
  return `/api/twitch/embed?channel=${encodeURIComponent(ch)}`
})

function saveDockChannel() {
  const ch = dockChannelDraft.value.trim().replace(/^#/, '').toLowerCase()
  if (!ch) return
  dockChannelDraft.value = ch
  dockChannelLive.value = ch
  localStorage.setItem('omo_twitch_channel', ch)
  streamChannel.value = ch
  scene.updateSettings({ twitchChannel: ch })
}

function togglePanel(name) {
  if (name === 'stream') {
    if (streamOpen.value) { streamOpen.value = false; return }
    if (!streamChannel.value) {
      streamChannelInput.value = ''
      streamModalOpen.value = true
    } else streamOpen.value = true
    return
  }
  if (name === 'dock') {
    dockOpen.value = !dockOpen.value
    if (dockOpen.value && !dockChannelDraft.value) {
      dockChannelDraft.value = streamChannel.value
    }
    return
  }
  if (name === 'obsPreview') {
    panels.obsPreview = !panels.obsPreview
    return
  }
  const wasOpen = panels[name]
  // Close non-pinned panels; keep pinned ones open
  for (const k of Object.keys(panels)) {
    if (k === 'obsPreview') continue
    if (k === name) continue
    if (isPinned(k)) continue
    panels[k] = false
  }
  panels[name] = !wasOpen
  if (name === 'settings' && !panels.settings) settingsTab.value = ''
}

function onPaletteAction(id) {
  if (id === 'tour') {
    startTour()
    return
  }
  if (id === 'help') {
    togglePanel('help')
    return
  }
  togglePanel(id)
}

function startTour() {
  for (const k of Object.keys(panels)) {
    if (k === 'obsPreview') continue
    if (isPinned(k)) continue
    panels[k] = false
  }
  navCollapsed.value = false
  if (scene.performMode) scene.togglePerformMode()
  tourOpen.value = true
}

function finishTour() {
  setTourDone(true)
  tourOpen.value = false
  if (tourOpenedInspector.value) {
    inspectorSheetOpen.value = false
    tourOpenedInspector.value = false
  }
}

async function onTourStep(id) {
  if (id === 'inspector' && !inspectorSheetOpen.value) {
    const narrow = window.matchMedia('(max-width: 1279px)').matches
    if (narrow) {
      inspectorSheetOpen.value = true
      tourOpenedInspector.value = true
      await nextTick()
    }
  }
}

watch(authed, async (v) => {
  if (!v || prefs.tourDone || tourOpen.value) return
  await nextTick()
  window.setTimeout(() => {
    if (authed.value && !prefs.tourDone) tourOpen.value = true
  }, 450)
})

function onObsCanvasSelect() {
  for (const k of Object.keys(panels)) {
    if (k === 'obsPreview') continue
    panels[k] = false
  }
  panels.obs = true
}

function confirmStreamChannel() {
  const ch = streamChannelInput.value.trim().replace(/^#/, '').toLowerCase()
  if (!ch) return
  streamChannel.value = ch
  localStorage.setItem('omo_twitch_channel', ch)
  streamModalOpen.value = false
  streamOpen.value = true
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (authed.value) paletteOpen.value = !paletteOpen.value
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '?' || e.key === '/' || e.code === 'Slash')) {
    e.preventDefault()
    if (authed.value) togglePanel('help')
    return
  }
  const tag = (e.target && e.target.tagName) || ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
    if (e.key === 'Escape' && scene.performMode) {
      e.preventDefault()
      scene.togglePerformMode()
    }
    return
  }
  // SoundPad: F1–F10 play, Shift+Fn preview (global while logged in)
  if (e.key.startsWith('F')) {
    const n = parseInt(e.key.slice(1), 10)
    if (n >= 1 && n <= 10) {
      e.preventDefault()
      const slot = scene.soundpad?.[n - 1]
      if (!slot?.src) return
      const vol = slot.volume ?? 1
      if (e.shiftKey) scene.previewSound({ src: slot.src, volume: vol, slotId: n - 1 })
      else scene.sendSoundPlay({ src: slot.src, volume: vol, slotId: n - 1 })
      return
    }
  }
  if (e.key === 'Escape') {
    scene.stopAllSounds()
  }
  if (e.key === 'Escape' && paletteOpen.value) {
    e.preventDefault()
    paletteOpen.value = false
    return
  }
  if (e.key === 'Escape' && scene.performMode) {
    e.preventDefault()
    scene.togglePerformMode()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault(); scene.undo()
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault(); scene.redo()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); scene.forceSave()
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (scene.selectedId) { e.preventDefault(); scene.deleteLayer(scene.selectedId) }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    if (scene.selectedId) { e.preventDefault(); scene.duplicateLayer(scene.selectedId) }
  } else if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p')) {
    e.preventDefault()
    scene.togglePerformMode()
  }
}

async function login() {
  loginError.value = ''
  loginBusy.value = true
  try {
    if (needsSetup.value) {
      if (!pin.value || pin.value !== pinConfirm.value) {
        loginError.value = t('login.setupMismatch')
        return
      }
      const r = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin.value, pinConfirm: pinConfirm.value })
      }).then((x) => x.json())
      if (!r.ok) { loginError.value = r.error || t('login.setupFailed'); return }
      localStorage.setItem('omo_token', r.token)
      scene.connect(r.token)
      needsSetup.value = false
      authed.value = true
      return
    }
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.value })
    }).then((x) => x.json())
    if (!r.ok) {
      if (r.needsSetup) needsSetup.value = true
      loginError.value = r.error || t('login.failed')
      return
    }
    localStorage.setItem('omo_token', r.token)
    scene.connect(r.token)
    authed.value = true
  } finally {
    loginBusy.value = false
  }
}

async function pingServer() {
  try {
    const hello = await fetch('/api/hello').then((r) => r.json())
    serverOk.value = !!hello?.ok
    if (hello?.needsSetup != null) needsSetup.value = !!hello.needsSetup
  } catch {
    serverOk.value = false
  }
}

onMounted(async () => {
  if (editorRoot.value) applyAccentToDocument(editorRoot.value)
  window.addEventListener('keydown', onKey)
  window.addEventListener('omo-obs-select', onObsCanvasSelect)
  pingServer()
  pingTimer = setInterval(pingServer, 15000)

  const token = localStorage.getItem('omo_token')
  if (token && !needsSetup.value) {
    scene.connect(token)
    await new Promise(r => setTimeout(r, 1000))
    if (!socket.connected) {
      scene.disconnect()
      localStorage.removeItem('omo_token')
      return
    }
    await new Promise(r => setTimeout(r, 1000))
    if (socket.connected) {
      authed.value = true
    } else {
      scene.disconnect()
      localStorage.removeItem('omo_token')
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('omo-obs-select', onObsCanvasSelect)
  if (pingTimer) clearInterval(pingTimer)
})
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}
.twitch-dock {
  flex: 0 0 360px;
  width: 360px;
  max-width: 40vw;
  background: var(--fluent-acrylic);
  border-left: 1px solid var(--fluent-stroke);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  z-index: 2;
}
.dock-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--fluent-stroke);
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.dock-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.dock-ch { flex: 1; font-size: 12px; min-width: 0; height: 28px; }
.dock-chat { flex: 1; min-height: 0; border: 0; background: #0e0e10; }
.dock-player { flex: 0 0 200px; height: 200px; border: 0; border-top: 1px solid var(--fluent-stroke); background: #000; }
.dock-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-size: 12px;
  text-align: center;
}
</style>
