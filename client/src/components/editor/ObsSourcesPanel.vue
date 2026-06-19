<!--
  ObsSourcesPanel.vue (M5/M10)
  Floating overlay (same shell as Queue/Presets/Trash) that lists OBS scenes
  and the current scene's sources with their visibility. The moderator can:
    - toggle source visibility in OBS (forwards to the obs-bridge write API)
    - switch the current program scene
    - connect/disconnect the obs-websocket link (also persisted in settings)
  Docked top-right by EditorView; mutually exclusive with the other overlays.
-->
<template>
  <div class="obs-panel" v-if="open">
    <div class="head">
      <span class="title">⬚ OBS Sources</span>
      <span
        class="conn-dot"
        :class="scene.obsConnected ? 'on' : 'off'"
        :title="scene.obsConnected ? 'Connected to OBS' : 'Disconnected'"
      ></span>
      <span v-if="connecting" class="muted small">connecting…</span>
      <span v-else-if="!scene.obsConnected" class="muted small">offline</span>
      <span class="spacer"></span>
      <button
        class="btn-sm"
        @click="scene.toggleObs(!scene.settings.obsEnabled)"
        :title="scene.settings.obsEnabled ? 'Disconnect from OBS' : 'Connect to OBS'"
      >
        {{ scene.settings.obsEnabled ? '⏻ Disconnect' : '⏻ Connect' }}
      </button>
      <button class="btn-sm muted" @click="$emit('close')" title="Close panel">✕</button>
    </div>

    <div class="body">
      <div v-if="!scene.settings.obsEnabled" class="empty muted">
        Connect to OBS to see and toggle native sources/scenes.
        <br />
        <small>Enable Tools → WebSocket Server in OBS (default port 4455).</small>
      </div>

      <template v-else>
        <!-- Scene selector -->
        <div v-if="scenes.length" class="section">
          <div class="sub-title">Scenes</div>
          <div class="scene-list">
            <button
              v-for="s in scenes"
              :key="s.name"
              :class="['scene-btn', { active: s.active }]"
              @click="switchScene(s.name)"
              :title="s.active ? 'Current program scene' : 'Switch to this scene'"
            >
              <span class="scene-dot" :class="{ live: s.active }"></span>
              {{ s.name }}
            </button>
          </div>
        </div>

        <!-- Sources in the current scene -->
        <div class="section">
          <div class="sub-title">Sources (current scene)</div>
          <div class="source-list" v-if="sources.length">
            <div v-for="src in sources" :key="src.scene + '/' + src.name" class="source-row">
              <button
                :class="['vis-toggle', { on: src.visible, off: !src.visible }]"
                @click="toggleSource(src)"
                :disabled="busy[src.name]"
                :title="src.visible ? 'Hide in OBS' : 'Show in OBS'"
              >
                {{ src.visible ? '👁' : '🚫' }}
              </button>
              <span class="source-name" :class="{ dim: !src.visible }">{{ src.name }}</span>
              <span class="source-dim muted">{{ src.w }}×{{ src.h }}</span>
            </div>
          </div>
          <div v-else class="empty muted small">No sources in the current scene.</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

defineProps({ open: { type: Boolean, default: true } })
defineEmits(['close'])

const scene = useSceneStore()

const sources = computed(() => scene.obsSources || [])
const connecting = computed(() => !scene.obsConnected && !!scene.settings.obsEnabled)

// Scene list — fetched from the server on demand (not part of the WS snapshot).
const scenes = ref([])
// Per-source busy flag so a toggle can't be double-fired before OBS replies.
const busy = reactive({})

function token() { return localStorage.getItem('omo_token') || '' }

async function fetchScenes() {
  if (!scene.obsConnected) { scenes.value = []; return }
  try {
    const r = await fetch('/api/obs/scenes', {
      headers: { Authorization: 'Bearer ' + token() }
    })
    const data = await r.json()
    scenes.value = data.scenes || []
  } catch (_) {
    scenes.value = []
  }
}

async function toggleSource(src) {
  if (busy[src.name]) return
  busy[src.name] = true
  try {
    // Each polled source carries the scene name it belongs to (.scene).
    const enabled = !src.visible
    const r = await fetch('/api/obs/item-enabled', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token()
      },
      body: JSON.stringify({ sceneName: src.scene, itemName: src.name, enabled })
    })
    const data = await r.json()
    if (!data.ok) console.warn('[obs-panel] toggle failed:', data.error)
  } catch (e) {
    console.warn('[obs-panel] toggle error:', e)
  } finally {
    busy[src.name] = false
  }
}

async function switchScene(name) {
  try {
    const r = await fetch('/api/obs/switch-scene', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token()
      },
      body: JSON.stringify({ sceneName: name })
    })
    const data = await r.json()
    if (!data.ok) console.warn('[obs-panel] switch failed:', data.error)
  } catch (e) {
    console.warn('[obs-panel] switch error:', e)
  }
}

// Refresh the scene list whenever OBS connects, and again whenever the polled
// sources change (a program-scene switch performed outside this panel).
watch(() => scene.obsConnected, (v) => { if (v) fetchScenes() }, { immediate: true })
watch(() => scene.obsSources, () => { if (scene.obsConnected) fetchScenes() })

onMounted(() => { if (scene.obsConnected) fetchScenes() })
</script>

<style scoped>
/* Same floating-overlay shell as Queue/Presets/Trash (docked top-right). */
.obs-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 320px;
  max-height: calc(100vh - 100px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
}
.head {
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.title { font-weight: 600; }
.spacer { flex: 1; }
.conn-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.conn-dot.on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.conn-dot.off { background: var(--danger); }
.small { font-size: 11px; font-weight: 400; }

.body {
  overflow-y: auto;
  min-height: 0;
}
.section { padding: 8px 12px; border-bottom: 1px solid var(--border); }
.section:last-child { border-bottom: none; }
.sub-title {
  font-size: 11px; font-weight: 600; color: var(--text-dim);
  text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px;
}
.scene-list { display: flex; flex-direction: column; gap: 4px; }
.scene-btn {
  display: flex; align-items: center; gap: 8px;
  text-align: left; padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg);
  color: var(--text); cursor: pointer; font-size: 12px;
  transition: all 0.15s;
}
.scene-btn:hover { background: var(--hover); }
.scene-btn.active {
  background: var(--accent); border-color: var(--accent);
  color: #fff; font-weight: 600;
}
.scene-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); flex: none; }
.scene-dot.live { background: #fff; box-shadow: 0 0 5px #fff; }

.source-list { display: flex; flex-direction: column; gap: 3px; }
.source-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 4px;
  transition: background 0.1s;
}
.source-row:hover { background: var(--hover); }
.vis-toggle {
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg);
  cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.vis-toggle:disabled { opacity: .5; cursor: wait; }
.vis-toggle.on { border-color: var(--ok); background: rgba(34, 197, 94, 0.1); }
.vis-toggle.off { border-color: var(--danger); background: rgba(239, 68, 68, 0.1); }
.source-name { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-name.dim { opacity: .5; }
.source-dim { font-size: 10px; flex-shrink: 0; font-variant-numeric: tabular-nums; }

.empty { padding: 14px 12px; font-size: 12px; line-height: 1.5; }

.btn-sm {
  padding: 4px 8px; border-radius: 6px; font-size: 11px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  cursor: pointer;
}
.btn-sm:hover { background: var(--hover); }
.btn-sm.muted { color: var(--text-dim); }
</style>
