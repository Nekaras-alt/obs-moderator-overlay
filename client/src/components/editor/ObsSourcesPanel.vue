<!--
  ObsSourcesPanel.vue
  Floating overlay: OBS scenes, sources, Program/Preview layout target,
  connect toggle. Clicking a source highlights its canvas bound.
-->
<template>
  <div class="obs-panel" v-if="open">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Monitor class="h-4 w-4" />
        OBS Sources
      </span>
      <span
        class="conn-dot"
        :class="scene.obsConnected ? 'on' : 'off'"
        :title="scene.obsConnected ? 'Connected to OBS' : 'Disconnected'"
      ></span>
      <span v-if="connecting" class="muted small">connecting…</span>
      <span v-else-if="!scene.obsConnected" class="muted small">offline</span>
      <span class="spacer"></span>
      <Button
        size="sm"
        variant="secondary"
        @click="scene.toggleObs(!scene.settings.obsEnabled)"
        :title="scene.settings.obsEnabled ? 'Disconnect from OBS' : 'Connect to OBS'"
      >
        <Power class="h-3.5 w-3.5" />
        {{ scene.settings.obsEnabled ? 'Disconnect' : 'Connect' }}
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" title="Close panel" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="body">
      <div v-if="!scene.settings.obsEnabled" class="empty muted">
        Connect to OBS to see and toggle native sources/scenes.
        <br />
        <small>Enable Tools → WebSocket Server in OBS (default port 4455).</small>
      </div>

      <template v-else>
        <div v-if="scene.obsStudioMode" class="section">
          <div class="sub-title">Layout target (Studio Mode)</div>
          <div class="target-row">
            <button
              type="button"
              class="target-btn"
              :class="{ active: scene.obsLayoutTarget !== 'preview' }"
              @click="setTarget('program')"
            >Program</button>
            <button
              type="button"
              class="target-btn"
              :class="{ active: scene.obsLayoutTarget === 'preview' }"
              @click="setTarget('preview')"
            >Preview</button>
          </div>
          <p class="hint muted small">
            Bounds on the canvas follow this scene.
            Program: {{ scene.obsProgramScene || '—' }}
            · Preview: {{ scene.obsPreviewScene || '—' }}
          </p>
        </div>

        <div v-if="scenes.length" class="section">
          <div class="sub-title">Scenes</div>
          <div class="scene-list">
            <button
              v-for="s in scenes"
              :key="s.name"
              :class="['scene-btn', { active: s.active, preview: s.preview && !s.active }]"
              @click="switchScene(s.name)"
              :title="s.active ? 'Current program scene' : 'Switch program to this scene'"
            >
              <span class="scene-dot" :class="{ live: s.active, prev: s.preview }"></span>
              {{ s.name }}
            </button>
          </div>
        </div>

        <div class="section">
          <div class="sub-title">Sources ({{ scene.obsLayoutTarget }})</div>
          <div class="source-list list-stagger" v-if="sources.length">
            <ContextMenu v-for="src in sources" :key="src.scene + '/' + src.id">
              <ContextMenuTrigger as-child>
                <div
                  class="source-row"
                  :class="{ selected: scene.obsSelectedId === src.id }"
                  @click="selectSource(src)"
                >
                  <button
                    :class="['vis-toggle', { on: src.visible, off: !src.visible }]"
                    @click.stop="toggleSource(src)"
                    :disabled="busy[src.name]"
                    :title="src.visible ? 'Hide in OBS' : 'Show in OBS'"
                  >
                    <Eye v-if="src.visible" class="h-3.5 w-3.5" />
                    <EyeOff v-else class="h-3.5 w-3.5" />
                  </button>
                  <span class="source-name" :class="{ dim: !src.visible }">{{ src.name }}</span>
                  <span class="source-dim muted">{{ src.w }}×{{ src.h }}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem @select="selectSource(src)">
                  {{ t('ctx.selectSource') }}
                </ContextMenuItem>
                <ContextMenuItem @select="toggleSource(src)">
                  {{ src.visible ? t('ctx.hideSource') : t('ctx.showSource') }}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
          <div v-else class="empty muted small">No sources in the current scene.</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { Monitor, Power, Eye, EyeOff, X } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'

defineProps({ open: { type: Boolean, default: true } })
defineEmits(['close'])

const scene = useSceneStore()
const { t } = useI18n()

const sources = computed(() =>
  [...(scene.obsSources || [])].sort((a, b) => (b.index || 0) - (a.index || 0))
)
const connecting = computed(() => !scene.obsConnected && !!scene.settings.obsEnabled)

const scenes = ref([])
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

function selectSource(src) {
  scene.selectObsSource(src.id)
}

async function setTarget(target) {
  await scene.setObsLayoutTarget(target)
  fetchScenes()
}

async function toggleSource(src) {
  if (busy[src.name]) return
  busy[src.name] = true
  try {
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

function onCanvasSelect(e) {
  const id = e?.detail?.id
  if (id != null) scene.selectObsSource(id)
}

watch(() => scene.obsConnected, (v) => { if (v) fetchScenes() }, { immediate: true })
watch(() => scene.obsSources, () => { if (scene.obsConnected) fetchScenes() })

onMounted(() => {
  if (scene.obsConnected) fetchScenes()
  window.addEventListener('omo-obs-select', onCanvasSelect)
})
onUnmounted(() => {
  window.removeEventListener('omo-obs-select', onCanvasSelect)
})
</script>

<style scoped>
.obs-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 320px;
  max-height: calc(100vh - 100px);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow: hidden;
}
.conn-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.conn-dot.on { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
.conn-dot.off { background: var(--danger); }
.small { font-size: 11px; font-weight: 400; }
.hint { margin: 6px 0 0; line-height: 1.35; }

.body {
  overflow-y: auto;
  min-height: 0;
}
.section { padding: 8px 12px; border-bottom: 1px solid var(--fluent-stroke); }
.section:last-child { border-bottom: none; }
.sub-title {
  font-size: 11px; font-weight: 600; color: var(--text-dim);
  text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px;
}
.target-row { display: flex; gap: 6px; }
.target-btn {
  flex: 1; padding: 6px 8px; border-radius: 6px; font-size: 12px;
  border: 1px solid var(--fluent-stroke); background: var(--bg-3); color: var(--text); cursor: pointer;
}
.target-btn.active { background: var(--fluent-accent); border-color: var(--fluent-accent); color: #fff; font-weight: 600; }
.scene-list { display: flex; flex-direction: column; gap: 4px; }
.scene-btn {
  display: flex; align-items: center; gap: 8px;
  text-align: left; padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--fluent-stroke); background: var(--bg-3);
  color: var(--text); cursor: pointer; font-size: 12px;
}
.scene-btn:hover { background: var(--fluent-reveal); }
.scene-btn.active {
  background: var(--fluent-accent); border-color: var(--fluent-accent);
  color: #fff; font-weight: 600;
}
.scene-btn.preview { border-color: #f59e0b; }
.scene-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-dim); flex: none; }
.scene-dot.live { background: #fff; box-shadow: 0 0 5px #fff; }
.scene-dot.prev { background: #f59e0b; }

.source-list { display: flex; flex-direction: column; gap: 3px; }
.source-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 4px;
  cursor: pointer;
}
.source-row:hover { background: var(--fluent-reveal); }
.source-row.selected { background: color-mix(in srgb, var(--fluent-accent) 18%, transparent); outline: 1px solid color-mix(in srgb, var(--fluent-accent) 50%, transparent); }
.vis-toggle {
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid var(--fluent-stroke); background: var(--bg-3);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  padding: 0;
  color: var(--text);
}
.vis-toggle:disabled { opacity: .5; cursor: wait; }
.vis-toggle.on { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
.vis-toggle.off { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
.source-name { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-name.dim { opacity: .5; }
.source-dim { font-size: 10px; flex-shrink: 0; font-variant-numeric: tabular-nums; }

.empty { padding: 14px 12px; font-size: 12px; line-height: 1.5; }
</style>
