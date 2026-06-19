<!--
  StatusBar.vue
  Bottom strip: shows the OBS Browser-Source URL + PIN for copy/paste, and the
  connection state. Helps the user wire up OBS without hunting for the console.
-->
<template>
  <div class="statusbar">
    <span :class="['dot', scene.connected ? 'on' : 'off']"></span>
    <span>{{ scene.connected ? 'Connected' : 'Disconnected — reconnecting…' }}</span>
    <span class="sep">·</span>
    <span class="muted">OBS Browser Source:</span>
    <code>{{ obsUrl }}</code>
    <button class="tiny" @click="copyObsUrl">Copy</button>
    <span v-if="copied" class="muted">copied!</span>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
const scene = useSceneStore()
const obsUrl = ref('')
const copied = ref(false)

onMounted(async () => {
  const r = await fetch('/api/viewer-token').then((x) => x.json()).catch(() => null)
  const host = location.hostname
  const port = location.port || (location.protocol === 'https:' ? 443 : 80)
  obsUrl.value = `${location.protocol}//${host}:${port}/obs?t=${r?.token || ''}`
})
async function copyObsUrl() {
  try { await navigator.clipboard.writeText(obsUrl.value); copied.value = true; setTimeout(() => (copied.value = false), 1500) } catch (_) {}
}
</script>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.on { background: var(--ok); }
.dot.off { background: var(--danger); }
.sep { color: var(--text-dim); }
code { background: var(--bg-3); padding: 2px 6px; border-radius: 4px; font-size: 11px; }
.tiny { padding: 2px 8px; font-size: 11px; }
</style>
