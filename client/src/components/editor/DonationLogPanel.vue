<!-- Donation log + queue controls. Fluent chrome (Phase 2). -->
<template>
  <div v-if="open" class="panel">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <BellRing class="h-4 w-4" />
        Multi-Alerts
      </span>
      <span class="spacer"></span>
      <Button size="sm" variant="secondary" v-if="!q.paused" aria-label="Pause queue" @click="ctrl('pause')">Pause</Button>
      <Button size="sm" variant="secondary" v-else aria-label="Resume queue" @click="ctrl('resume')">Resume</Button>
      <Button size="sm" variant="destructive" aria-label="Skip current" @click="ctrl('skip')">Skip</Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" aria-label="Close" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="body">
      <!-- Always-visible alert transport -->
      <div class="queue-bar" role="group" aria-label="Alert controls">
        <div class="queue-bar-label">{{ q.current ? 'Now playing' : (q.paused ? 'Queue paused' : 'Queue idle') }}</div>
        <div class="queue-bar-actions">
          <Button size="sm" variant="destructive" @click="ctrl('skip')">Skip</Button>
          <Button size="sm" variant="secondary" :disabled="!q.current" @click="ctrl('replay', q.current?.id)">Replay</Button>
          <Button size="sm" variant="secondary" v-if="!q.paused" @click="ctrl('pause')">Pause</Button>
          <Button size="sm" variant="secondary" v-else @click="ctrl('resume')">Resume</Button>
        </div>
      </div>

      <div class="cfg">
        <label class="check">
          <input type="checkbox" :checked="!!donations.enabled" @change="toggleEnabled" />
          Enable multi-alerts queue
        </label>
        <div class="row status-row">
          <Badge :variant="status.daLive ? 'default' : 'secondary'" :class="{ on: status.daLive }">
            DA {{ status.daLive ? 'live' : (status.daConnected ? 'token' : 'off') }}
          </Badge>
          <Badge :variant="(status.donatexLive || status.donatex?.hasToken) ? 'default' : 'secondary'">
            Donatex {{ status.donatexLive ? 'live' : (status.donatex?.hasToken ? 'ready' : 'off') }}
          </Badge>
        </div>
        <div class="row">
          <Button size="sm" :disabled="busy" @click="connectDa">Connect DonationAlerts</Button>
          <Button size="sm" variant="secondary" @click="disconnect('da')">Disconnect DA</Button>
          <Button size="sm" variant="secondary" @click="reconnectDonatex">Reconnect Donatex</Button>
        </div>
        <p class="muted hint">Donatex JWT + widgets are saved on the server — no re-entry needed.</p>
        <p class="muted hint">{{ t('donations.volumeNote') }}</p>
        <Button size="sm" @click="addMultiLayer">
          <Plus class="h-3.5 w-3.5" />
          Add Multi-Alerts layer to canvas
        </Button>
        <p v-if="dxHookHint" class="muted hint">{{ dxHookHint }}</p>
        <label class="block">Blocked words (comma-separated)
          <Input
            :model-value="(donations.blockedWords || []).join(', ')"
            @update:model-value="saveBlocked"
          />
        </label>
        <Button size="sm" variant="outline" @click="simulate">Simulate donation</Button>
        <p class="muted hint">OBS: put Multi-Alerts layer on canvas, or StatusBar → Multi-Alerts Browser Source URL.</p>
      </div>

      <div class="current" v-if="q.current">
        <strong>Playing:</strong> {{ q.current.user }} — {{ q.current.amount }} {{ q.current.currency }}
        <div class="muted">{{ q.current.message }}</div>
        <div class="row">
          <Button size="sm" variant="secondary" @click="ctrl('hide', q.current.id)">Hide</Button>
          <Button size="sm" variant="secondary" @click="ctrl('replay', q.current.id)">Replay</Button>
          <Button size="sm" variant="destructive" @click="ctrl('skip')">Skip</Button>
        </div>
      </div>
      <div class="muted small" v-else>Queue idle{{ q.paused ? ' (paused)' : '' }}</div>

      <h4>Pending ({{ (q.pending || []).length }})</h4>
      <ul class="list">
        <li v-for="a in q.pending" :key="a.id">
          <span>[{{ a.source }}] {{ a.user }} — {{ a.amount }}</span>
          <Button size="sm" variant="ghost" @click="ctrl('skip', a.id)">Skip</Button>
        </li>
      </ul>

      <h4>Log</h4>
      <ul class="list">
        <li v-for="a in log" :key="a.id" :class="{ blocked: a.blocked }">
          <span>[{{ a.source }}] {{ a.user }}: {{ a.message }}</span>
          <Button size="sm" variant="ghost" @click="ctrl('replay', a.id)">Replay</Button>
        </li>
      </ul>
      <p v-if="err" class="err">{{ err }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { BellRing, X, Plus } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

defineProps({ open: Boolean })
defineEmits(['close'])
const scene = useSceneStore()
const { t } = useI18n()
const q = computed(() => scene.donationQueue || { pending: [], log: [] })
const log = computed(() => q.value.log || [])
const donations = computed(() => scene.settings.donations || {})
const status = ref({})
const busy = ref(false)
const err = ref('')
const dxHookHint = ref('')

function headers() {
  return { Authorization: 'Bearer ' + (localStorage.getItem('omo_token') || ''), 'Content-Type': 'application/json' }
}

async function refreshStatus() {
  try {
    status.value = await fetch('/api/donations/status', { headers: headers() }).then((x) => x.json())
    if (status.value?.donatex?.hasWebhookSecret) {
      dxHookHint.value = `Webhook: POST ${location.origin}/api/donations/hooks/donatex`
    }
  } catch (_) {}
}

async function ctrl(action, id) {
  await fetch('/api/donations/ctrl', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ action, id })
  })
}

async function toggleEnabled(e) {
  await scene.updateSettings({
    donations: { ...donations.value, enabled: e.target.checked }
  })
  await fetch('/api/donations/sync-listener', { method: 'POST', headers: headers() })
  refreshStatus()
}

async function connectDa() {
  busy.value = true
  err.value = ''
  try {
    const r = await fetch('/api/donations/oauth/da/start', { headers: headers() }).then((x) => x.json())
    if (r.url) window.open(r.url, 'da-oauth', 'width=520,height=720')
    else throw new Error(r.error || 'OAuth not configured')
    setTimeout(refreshStatus, 2500)
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}

async function disconnect(which) {
  await fetch('/api/donations/auth?which=' + which, { method: 'DELETE', headers: headers() })
  refreshStatus()
}

async function reconnectDonatex() {
  await fetch('/api/donations/donatex/config', {
    method: 'POST', headers: headers(), body: '{}'
  })
  await fetch('/api/donations/donatex/reconnect', { method: 'POST', headers: headers() })
  await fetch('/api/donations/sync-listener', { method: 'POST', headers: headers() })
  refreshStatus()
}

async function addMultiLayer() {
  const dx = status.value?.donatex || {}
  const urls = [
    dx.widgetUrl || 'https://donatex.gg/widgets/donations/6d5b8a46-bdde-4171-ad59-2e55c4b7204a',
    dx.aiWidgetUrl || 'https://donatex.gg/widgets/ai-assistant/bc9a0c62-acfa-4a87-b6e5-fb615d5c9cde'
  ].filter(Boolean)
  try {
    const vt = await fetch('/api/viewer-token', { headers: headers() }).then((x) => x.json())
    if (vt?.token) urls.unshift(`${location.origin}/multi-alerts?t=${encodeURIComponent(vt.token)}`)
  } catch (_) {}
  await scene.addLayer({
    type: 'multiBrowser',
    name: 'Multi Browser Source',
    multiBrowser: {
      urls,
      refreshKey: 0,
      queueEnabled: true,
      width: 800,
      height: 600
    }
  })
  await scene.updateSettings({ donations: { ...donations.value, enabled: true } })
  await fetch('/api/donations/sync-listener', { method: 'POST', headers: headers() })
  refreshStatus()
}

async function saveBlocked(raw) {
  const words = String(raw).split(',').map((s) => s.trim()).filter(Boolean)
  await scene.updateSettings({ donations: { ...donations.value, blockedWords: words } })
}

async function simulate() {
  await fetch('/api/donations/simulate', {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ user: 'TestDonor', amount: 100, currency: 'RUB', message: 'Hello from Multi-Donation' })
  })
}

onMounted(() => {
  refreshStatus()
  reconnectDonatex()
})
watch(() => scene.donationQueue, refreshStatus)
</script>

<style scoped>
.panel {
  position: absolute;
  top: 52px;
  right: 16px;
  width: 420px;
  max-height: calc(100% - 80px);
  border-radius: 8px;
  z-index: 40;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.body {
  padding: 10px 12px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.queue-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--fluent-stroke);
  background: color-mix(in srgb, var(--fluent-accent) 12%, var(--bg-3));
  position: sticky;
  top: 0;
  z-index: 1;
}
.queue-bar-label {
  font-size: 12px;
  font-weight: 600;
}
.queue-bar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.current {
  background: color-mix(in srgb, var(--bg-3) 60%, transparent);
  border: 1px solid var(--fluent-stroke);
  padding: 8px;
  border-radius: 8px;
}
.list { list-style: none; margin: 0; padding: 0; }
.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid var(--fluent-stroke);
  font-size: 12px;
}
.list li.blocked { opacity: .5; text-decoration: line-through; }
.cfg { display: flex; flex-direction: column; gap: 6px; }
.hint { font-size: 11px; margin: 0; }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.block { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.check { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.err { color: var(--danger); font-size: 12px; margin: 0; }
h4 { margin: 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
</style>
