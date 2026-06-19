<!--
  Settings.vue
  OBS WebSocket connect/disconnect toggle. The moderator flips the switch
  (local draft), then presses Save to actually connect/disconnect and persist
  `obsEnabled` into scene.settings — which the server reads on boot to
  auto-reconnect after restarts. The live link status (scene.obsConnected)
  is shown separately as a status dot, since the websocket can drop/reconnect
  independently of the moderator's intent.
-->
<template>
  <div class="qs-panel" v-if="open">
    <div class="qs-head">
      <span class="qs-title">⚙ Settings</span>
      <span class="spacer"></span>
      <button class="btn-sm muted" @click="$emit('close')" title="Close">✕</button>
    </div>

    <div class="qs-body">
      <!-- OBS WebSocket connect/disconnect -->
      <div class="section-title">OBS WebSocket</div>
      <div class="obs-row">
        <button
          type="button"
          class="switch"
          role="switch"
          :aria-checked="obsDraft ? 'true' : 'false'"
          :class="{ on: obsDraft, busy: obsBusy }"
          :disabled="obsBusy"
          @click="obsDraft = !obsDraft"
          :title="obsDraft ? 'Click Save to connect' : 'Click Save to disconnect'"
        >
          <span class="knob"></span>
        </button>
        <div class="obs-text">
          <span class="status-line">
            <strong>{{ obsDraft ? 'Connect on Save' : 'Disconnect on Save' }}</strong>
            <span class="dot" :class="scene.obsConnected ? 'live' : 'off'" :title="scene.obsConnected ? 'Live link to OBS' : 'No live link'"></span>
          </span>
          <small class="muted">
            Live status: {{ scene.obsConnected ? 'connected' : 'disconnected' }}.
            Reads native source boundaries for the ⬚ OBS overlay. Host/password
            come from OBS_HOST / OBS_PASSWORD env vars (set before launch).
          </small>
        </div>
      </div>
      <div class="obs-actions">
        <button class="btn-sm primary" :disabled="obsBusy || obsDraft === s.obsEnabled" @click="saveObs">
          {{ obsBusy ? 'Working…' : 'Save' }}
        </button>
        <button class="btn-sm" :disabled="obsBusy || obsDraft === s.obsEnabled" @click="obsDraft = s.obsEnabled">Reset</button>
        <span v-if="obsDraft !== s.obsEnabled" class="dirty muted small">unsaved change</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const props = defineProps({ open: { type: Boolean, default: false } })
defineEmits(['close'])

const scene = useSceneStore()
const s = computed(() => scene.settings)
const obsBusy = ref(false)

// Local draft of the OBS intent. Seeded from the persisted setting when the
// panel opens, and re-synced if the server ever changes it out from under us.
const obsDraft = ref(!!s.value.obsEnabled)
watch(() => props.open, (o) => { if (o) obsDraft.value = !!s.value.obsEnabled })
watch(() => s.value.obsEnabled, (v) => { if (v !== obsDraft.value && !obsBusy.value) obsDraft.value = !!v })

// OBS bridge commit: send intent to the server. scene.toggleObs persists
// obsEnabled AND fires the connect/disconnect request; the authoritative
// live-link state arrives via the 'obs-sources' WS message.
async function saveObs() {
  if (obsBusy.value || obsDraft.value === s.value.obsEnabled) return
  obsBusy.value = true
  try {
    await scene.toggleObs(obsDraft.value)
  } catch (e) {
    // Revert the draft so the UI matches the (unchanged) server state.
    obsDraft.value = !!s.value.obsEnabled
  } finally {
    obsBusy.value = false
  }
}
</script>

<style scoped>
.qs-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 360px;
  max-height: calc(100vh - 100px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 97;
  overflow: hidden;
}
.qs-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.qs-title { font-weight: 600; }
.spacer { flex: 1; }
.qs-body {
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.section-title:first-child { border-top: none; padding-top: 0; }

/* --- OBS toggle switch --- */
.obs-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.switch {
  flex: none;
  width: 42px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--bg-3);
  position: relative;
  transition: background 0.15s;
  margin-top: 1px;
}
.switch.on { background: var(--accent); }
.switch:hover { background: var(--bg-2); }
.switch.on:hover { background: var(--accent-2); }
.switch:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
  transition: transform 0.15s;
}
.switch.on .knob { transform: translateX(18px); }
.switch.busy { opacity: 0.6; cursor: progress; }
.obs-text { display: flex; flex-direction: column; gap: 2px; }
.status-line { display: flex; align-items: center; gap: 6px; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-3);
}
.dot.live { background: var(--ok); border-color: var(--ok); }
.dot.off { background: transparent; }
.obs-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 52px;
}
.dirty { font-style: italic; }
.small { font-size: 11px; }
.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.btn-sm:hover:not(:disabled) { background: var(--hover); }
.btn-sm:disabled { opacity: 0.5; cursor: default; }
.btn-sm.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn-sm.primary:hover:not(:disabled) { background: var(--accent-2); }
</style>
