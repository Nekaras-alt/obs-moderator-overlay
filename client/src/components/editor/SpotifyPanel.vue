<!-- Local Spotify / media-key control — Fluent chrome (Phase 2) -->
<template>
  <div v-if="open" class="panel">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Music class="h-4 w-4" />
        Spotify (local)
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>
    <div class="body">
      <p class="muted hint">
        Управляет десктопным Spotify на ПК стримера через медиа-клавиши Windows.
        Premium и OAuth не нужны — приложение Spotify должно быть запущено.
      </p>
      <div class="controls">
        <Button variant="secondary" size="icon" title="Previous" @click="ctrl('previous')">
          <SkipBack class="h-4 w-4" />
        </Button>
        <Button size="icon" title="Play / Pause" @click="ctrl('playpause')">
          <Play class="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" title="Next" @click="ctrl('next')">
          <SkipForward class="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" title="Stop" @click="ctrl('stop')">
          <Square class="h-4 w-4" />
        </Button>
      </div>
      <div class="controls">
        <Button variant="outline" size="icon" title="Volume −" @click="ctrl('voldown')">
          <Volume1 class="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title="Volume +" @click="ctrl('volup')">
          <Volume2 class="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title="Mute" @click="ctrl('mute')">
          <VolumeX class="h-4 w-4" />
        </Button>
      </div>
      <p v-if="status" class="status" :class="{ err }">{{ status }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Music, X, SkipBack, SkipForward, Play, Square, Volume1, Volume2, VolumeX } from '@lucide/vue'
import { Button } from '@/components/ui/button'

defineProps({ open: Boolean })
defineEmits(['close'])

const status = ref('')
const err = ref(false)

function headers() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('omo_token') || ''), 'Content-Type': 'application/json' }
}

async function ctrl(action) {
  err.value = false
  status.value = ''
  try {
    const r = await fetch('/api/spotify/control', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ action })
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'failed')
    status.value = action + ' ✓'
  } catch (e) {
    err.value = true
    status.value = e.message
  }
}

onMounted(async () => {
  try {
    const r = await fetch('/api/spotify/status', { headers: headers() }).then((x) => x.json())
    if (r.hint) status.value = r.platform || 'ready'
  } catch (_) {}
})
</script>

<style scoped>
.panel {
  position: absolute;
  top: 52px;
  right: 16px;
  width: 320px;
  border-radius: 8px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.controls { display: flex; gap: 8px; flex-wrap: wrap; }
.hint { font-size: 11px; margin: 0; line-height: 1.4; }
.status { font-size: 12px; color: var(--ok); margin: 0; }
.status.err { color: var(--danger); }
</style>
