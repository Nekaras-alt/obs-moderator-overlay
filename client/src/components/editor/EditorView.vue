<!--
  EditorView.vue
  PIN gate → moderator editor shell:
  Toolbar (top), Layers (left), Canvas (center), Properties (right),
  StatusBar (footer).
  Floating overlays (Presets / Trash / OBS / Settings) dock top-right and
  are mutually exclusive — only one shows at a time.

  Owns the single useDnd() instance: drag-over/drop are bound on this root
  so the WHOLE shell accepts media drops (not just the narrow toolbar). The
  composable is provided to Toolbar, which still hosts the preload dialog
  + file picker since it already owns the Modal chrome.
-->
<template>
  <div
    :class="['editor', themeClass]"
    @dragover.prevent="dnd.onDragOver"
    @dragleave.prevent="dnd.onDragLeave"
    @drop.prevent="dnd.onDrop"
  >
    <!-- PIN LOGIN -->
    <div v-if="!authed" class="login">
      <form @submit.prevent="login">
        <h1>OBS Moderator Overlay</h1>
        <p class="muted">Enter the PIN shown in the server console.</p>
        <input v-model="pin" type="text" inputmode="numeric" placeholder="PIN" autofocus />
        <button class="primary" type="submit">Connect</button>
        <p v-if="loginError" class="error">{{ loginError }}</p>
      </form>
    </div>

    <!-- EDITOR SHELL -->
    <template v-else>
      <Toolbar
        :panels="panels"
        @toggle-panel="togglePanel"
      />
      <div class="editor-body">
        <LayersPanel />
        <Canvas />
        <PropertiesPanel />
      </div>
      <StatusBar />

      <!-- Floating overlays: dock top-right, mutually exclusive. -->
      <PresetPanel :open="panels.presets" @close="panels.presets = false" />
      <TrashPanel :open="panels.trash" @close="panels.trash = false" />
      <ObsSourcesPanel :open="panels.obs" @close="panels.obs = false" />
      <Settings :open="panels.settings" @close="panels.settings = false" />
      <EmotePanel :open="panels.stickers" @close="panels.stickers = false" />

      <!-- One floating control window per YouTube layer. Each appears
           automatically when a video is added and disappears when deleted. -->
      <YoutubeManager />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, provide } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { socket } from '../../services/ws.js'
import { useDnd } from '../../features/dnd.js'
import Toolbar from './Toolbar.vue'
import LayersPanel from './LayersPanel.vue'
import Canvas from './Canvas.vue'
import PropertiesPanel from './PropertiesPanel.vue'
import StatusBar from './StatusBar.vue'
import PresetPanel from './PresetPanel.vue'
import TrashPanel from './TrashPanel.vue'
import ObsSourcesPanel from './ObsSourcesPanel.vue'
import Settings from './Settings.vue'
import EmotePanel from './EmotePanel.vue'
import YoutubeManager from './YoutubeManager.vue'

const scene = useSceneStore()
const authed = ref(false)
const pin = ref('')
const loginError = ref('')

// Single dnd instance for the whole shell. Drag-over/drop handlers are
// attached to this root element (see template), and the composable is
// provided so Toolbar can render the preload dialog + drive the file
// picker without re-creating its own drop logic.
const dnd = useDnd()
provide('dnd', dnd)

// Floating panel state. These all dock top-right, so only one shows at a
// time: opening one closes the others (mutual exclusion for the same region).
const panels = reactive({ presets: false, trash: false, obs: false, settings: false, stickers: false })
function togglePanel(name) {
  const wasOpen = panels[name]
  for (const k of Object.keys(panels)) panels[k] = false
  panels[name] = !wasOpen
}

const themeClass = computed(() => 'theme-' + (scene.settings.theme || 'dark'))

async function login() {
  loginError.value = ''
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: pin.value })
  }).then((x) => x.json())
  if (!r.ok) { loginError.value = r.error || 'Login failed'; return }
  localStorage.setItem('omo_token', r.token)
  scene.connect(r.token)
  authed.value = true
}

onMounted(async () => {
  const token = localStorage.getItem('omo_token')
  if (token) {
    // Prove the cached token is still valid before trusting it. We connect the
    // WS and wait up to 2s for it to open. If the server rejects the token
    // (closes 4001) or the connection never opens, the token is stale — clear
    // it and fall through to the PIN form.
    scene.connect(token)
    const opened = await new Promise((resolve) => {
      const off = socket.onStatus((v) => {
        off()
        resolve(v)
      })
      setTimeout(() => { off(); resolve(false) }, 2000)
    })
    if (opened) {
      authed.value = true
    } else {
      scene.disconnect()
      localStorage.removeItem('omo_token')
    }
  }
})
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}
.editor-body {
  flex: 1;
  display: grid;
  grid-template-columns: 260px 1fr 300px;
  min-height: 0;
}
.login {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 320px;
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 28px;
  border-radius: 12px;
  box-shadow: var(--shadow);
}
.login h1 { margin: 0 0 4px; font-size: 20px; }
.login input { text-align: center; font-size: 18px; letter-spacing: 4px; }
.error { color: var(--danger); margin: 0; font-size: 13px; text-align: center; }
</style>
