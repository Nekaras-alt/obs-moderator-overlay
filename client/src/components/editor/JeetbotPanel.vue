<!-- Jeetbot TTS panel — Fluent chrome (Phase 2) -->
<template>
  <div v-if="open" class="panel">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Bot class="h-4 w-4" />
        Jeetbot TTS
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>
    <div class="body">
      <p class="muted hint">
        Sends <code>!!!#voice text</code> to Twitch chat. Jeetbot dock on the streamer PC must be running.
        {{ allVoices.length ? `(${voices.length}/${allVoices.length} voices)` : '' }}
      </p>
      <label class="field">Voice
        <Input v-model="voiceQ" placeholder="Search voices…" @input="filterVoices" />
        <select v-model="voice">
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.group }} — {{ v.name }}</option>
        </select>
      </label>
      <textarea v-model="text" rows="4" placeholder="What should Jeetbot say?"></textarea>
      <div class="row">
        <Button :disabled="!text.trim() || busy" @click="speak">Speak</Button>
      </div>
      <p v-if="status" class="status" :class="{ err: err }">{{ status }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Bot, X } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

defineProps({ open: Boolean })
defineEmits(['close'])
const scene = useSceneStore()
const voices = ref([])
const allVoices = ref([])
const voice = ref('baya')
const voiceQ = ref('')
const text = ref('')
const busy = ref(false)
const status = ref('')
const err = ref(false)

function headers() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('omo_token') || ''), 'Content-Type': 'application/json' }
}

async function loadVoices() {
  try {
    const r = await fetch('/api/jeetbot/voices', { headers: headers() }).then((x) => x.json())
    allVoices.value = r.voices || []
    voices.value = allVoices.value
  } catch (_) { voices.value = [] }
}

function filterVoices() {
  const q = voiceQ.value.toLowerCase()
  voices.value = !q ? allVoices.value : allVoices.value.filter((v) =>
    v.id.includes(q) || v.name.toLowerCase().includes(q) || v.group.toLowerCase().includes(q)
  )
}

async function speak() {
  busy.value = true
  err.value = false
  status.value = ''
  try {
    const channel = scene.settings.twitchChannel || localStorage.getItem('omo_twitch_channel') || ''
    const r = await fetch('/api/jeetbot/speak', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text: text.value, voice: voice.value, channel })
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'failed')
    status.value = 'Sent via chat-bridge'
  } catch (e) {
    err.value = true
    status.value = e.message
  } finally {
    busy.value = false
  }
}

onMounted(loadVoices)
</script>

<style scoped>
.panel {
  position: absolute;
  top: 52px;
  right: 16px;
  width: 360px;
  border-radius: 8px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-2) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hint { font-size: 11px; margin: 0; line-height: 1.4; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.row { display: flex; justify-content: flex-end; }
.status { font-size: 12px; color: var(--ok); margin: 0; }
.status.err { color: var(--danger); }
textarea { resize: vertical; min-height: 72px; }
</style>
