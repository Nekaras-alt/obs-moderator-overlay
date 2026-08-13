<script setup>

import { ref, computed, onMounted, onUnmounted } from 'vue'

import { Copy, Link2, Radio } from '@lucide/vue'

import { useSceneStore } from '@/stores/scene.js'

import { Button } from '@/components/ui/button'

import { Badge } from '@/components/ui/badge'

import { Separator } from '@/components/ui/separator'

import { cn } from '@/lib/utils'

import { useI18n } from '@/i18n'



const emit = defineEmits(['open-settings'])



const scene = useSceneStore()

const { t } = useI18n()

const obsUrl = ref('')

const modUrl = ref('')

const alertsUrl = ref('')

const copied = ref('')

const serverOk = ref(true)

const net = ref({ isTailscale: false, preferredHost: 'localhost', port: 8090 })

const connector = ref({ profile: 'direct', joinCode: '', paired: false, rttMs: null, region: '', hosts: 0 })

const health = ref(null)

const obsLink = ref({

  browserConnected: false,

  nativeConnected: false,

  frameBridge: { enabled: false, clients: 0, frameId: 0, ageMs: null, port: 8092 }

})

let timer = null

let obsTimer = null

let healthTimer = null



const visibleMods = computed(() => (scene.presence || []).slice(0, 3))

const extraMods = computed(() => Math.max(0, (scene.presence || []).length - 3))

const presenceTitle = computed(() => {

  const mods = scene.presence || []

  if (!mods.length) return 'No moderators online'

  return mods.map((m) => m.displayName).join(', ')

})

const obsLinkLabel = computed(() => {

  const parts = []

  parts.push(obsLink.value.browserConnected ? 'Browser ✓' : 'Browser —')

  if (obsLink.value.nativeConnected) {

    const fb = obsLink.value.frameBridge

    parts.push(fb.frameId ? `Native ✓ #${fb.frameId}` : 'Native ✓')

  } else if (obsLink.value.frameBridge.enabled) {

    parts.push(`Native wait :${obsLink.value.frameBridge.port}`)

  } else {

    parts.push('Native off')

  }

  return parts.join(' · ')

})

const obsLinkOk = computed(() => obsLink.value.browserConnected || obsLink.value.nativeConnected)



const healthFrameOn = computed(() => !!health.value?.frameBridge?.enabled)

const healthProfile = computed(() => health.value?.connector?.profile || connector.value.profile || '—')

const healthBadgeLabel = computed(() => {

  const fb = healthFrameOn.value ? t('status.frameOn') : t('status.frameOff')

  return `${fb} · ${healthProfile.value}`

})

const healthTooltip = computed(() => {

  const h = health.value

  if (!h) return t('status.healthUnavailable')

  const parts = [

    `ok: ${h.ok}`,

    `mode: ${h.mode || '—'}`,

    `profile: ${h.connector?.profile || '—'}`,

    `frameBridge: ${h.frameBridge?.enabled ? 'on' : 'off'}`,

    h.frameBridge?.port != null ? `port: ${h.frameBridge.port}` : null,

    h.connector?.rttMs != null ? `rttMs: ${h.connector.rttMs}` : null,

    h.buildStamp ? `build: ${h.buildStamp}` : null

  ].filter(Boolean)

  return parts.join('\n')

})



function avatarColor(seed) {

  const n = parseInt(String(seed || '0').slice(0, 6), 16) || 0x3b82f6

  return `hsl(${n % 360} 65% 42%)`

}

function initials(name) {

  return String(name || '?').slice(0, 2).toUpperCase()

}



async function refreshHealth() {

  try {

    const h = await fetch('/api/health').then((r) => r.json())

    if (h?.ok) health.value = h

  } catch (_) { /* keep */ }

}



async function refreshNetwork() {

  const token = localStorage.getItem('omo_token') || ''

  const headers = token ? { Authorization: 'Bearer ' + token } : {}

  try {

    const hello = await fetch('/api/hello').then((r) => r.json())

    serverOk.value = !!hello?.ok

  } catch (_) { serverOk.value = false }



  try {

    const info = await fetch('/api/network-info').then((x) => x.json())

    net.value = info || net.value

  } catch (_) { /* keep */ }



  try {

    const st = await fetch('/api/connector/status').then((x) => x.json())

    let overlay = st.overlay?.url || st.relay?.remoteOverlayUrl || ''

    connector.value = {

      profile: st.profile || 'direct',

      joinCode: st.relay?.joinCode || '',

      paired: !!st.relay?.paired,

      rttMs: st.relay?.rttMs ?? null,

      region: st.preferredRegion || '',

      hosts: (st.relay?.hosts || []).length,

      remoteOverlayUrl: overlay,

      overlayNeedsToken: !!st.overlay?.needsToken

    }

  } catch (_) { /* keep */ }



  const port = location.port || (location.protocol === 'https:' ? '443' : '80')

  let tokenStr = ''

  try {

    const r = await fetch('/api/viewer-token', { headers }).then((x) => x.json())

    tokenStr = r?.token || ''

  } catch (_) { /* ignore */ }



  obsUrl.value = `${location.protocol}//localhost:${port}/obs?t=${tokenStr}`

  alertsUrl.value = `${location.protocol}//localhost:${port}/multi-alerts?t=${tokenStr}`

  if (connector.value.overlayNeedsToken && connector.value.remoteOverlayUrl && tokenStr) {
    const base = connector.value.remoteOverlayUrl
    if (!/[?&]t=/.test(base)) {
      connector.value.remoteOverlayUrl = base + (base.includes('?') ? '&' : '?') + 't=' + tokenStr
    }
  }



  let modHost = location.hostname

  if (modHost === 'localhost' || modHost === '127.0.0.1') {

    modHost = net.value.preferredHost || net.value.ip || 'localhost'

  }

  modUrl.value = `${location.protocol}//${modHost}:${port}/`

}



async function refreshObsLink() {

  try {

    const st = await fetch('/api/obs-plugin/status').then((x) => x.json())

    if (!st?.ok) return

    obsLink.value = {

      browserConnected: !!st.browserConnected,

      nativeConnected: !!st.nativeConnected,

      frameBridge: {

        enabled: !!st.frameBridge?.enabled,

        clients: Number(st.frameBridge?.clients || 0),

        frameId: Number(st.frameBridge?.frameId || 0),

        ageMs: st.frameBridge?.ageMs ?? null,

        port: Number(st.frameBridge?.port || 8092)

      }

    }

  } catch (_) { /* keep */ }

}



async function copy(text, flag) {

  try {

    await navigator.clipboard.writeText(text)

    copied.value = flag

    setTimeout(() => { if (copied.value === flag) copied.value = '' }, 1500)

  } catch (_) {}

}



function openConnectorSettings() {

  emit('open-settings', 'connector')

}



onMounted(() => {

  refreshNetwork()

  refreshObsLink()

  refreshHealth()

  timer = setInterval(refreshNetwork, 30000)

  obsTimer = setInterval(refreshObsLink, 1500)

  healthTimer = setInterval(refreshHealth, 5000)

  document.addEventListener('visibilitychange', () => {

    if (document.visibilityState === 'visible') {

      refreshNetwork()

      refreshObsLink()

      refreshHealth()

    }

  })

})

onUnmounted(() => {

  if (timer) clearInterval(timer)

  if (obsTimer) clearInterval(obsTimer)

  if (healthTimer) clearInterval(healthTimer)

})

</script>



<template>

  <footer

    role="contentinfo"

    aria-label="Status bar"

    data-tour="statusbar"

    :class="cn(

      'flex shrink-0 items-center gap-2 border-t border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] px-3 text-xs backdrop-blur-md'

    )"

    :style="{ height: 'var(--shell-status-h)' }"

  >

    <span

      class="h-2 w-2 shrink-0 rounded-full"

      :class="scene.connected && serverOk ? 'bg-[var(--ok)]' : 'bg-[var(--danger)]'"

      :title="serverOk ? 'Server reachable' : 'Server unreachable'"

    />

    <span>{{ scene.connected ? t('status.connected') : t('status.disconnected') }}</span>

    <Badge

      v-if="net.isTailscale"

      variant="secondary"

      class="border-[color-mix(in_srgb,var(--fluent-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--fluent-accent)_18%,transparent)] text-[var(--fluent-accent)]"

    >

      Tailscale

    </Badge>

    <Badge

      v-if="connector.profile === 'relay' || connector.joinCode"

      variant="secondary"

      class="cursor-pointer"

      :title="connector.joinCode ? 'Click to copy join code' : 'Relay'"

      @click="connector.joinCode && copy(connector.joinCode, 'join')"

    >

      Relay{{ connector.region && connector.region !== 'auto' ? '·' + connector.region : '' }}{{ connector.joinCode ? ' ' + connector.joinCode : '' }}{{ connector.rttMs != null ? ' · ' + connector.rttMs + 'ms' : '' }}{{ connector.hosts > 1 ? ' · ×' + connector.hosts : '' }}

    </Badge>

    <Badge

      variant="secondary"

      class="cursor-pointer font-normal"

      :class="healthFrameOn

        ? 'border-[color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-[var(--ok)]'

        : 'text-[var(--text-dim)]'"

      :title="healthTooltip"

      @click="openConnectorSettings"

    >

      {{ t('status.host') }} · {{ healthBadgeLabel }}

    </Badge>

    <Separator orientation="vertical" class="mx-1 h-4" />



    <Badge

      variant="secondary"

      class="max-w-[280px] truncate font-normal"

      :class="obsLinkOk

        ? 'border-[color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-[var(--ok)]'

        : 'text-[var(--text-dim)]'"

      :title="obsLinkLabel"

    >

      OBS plugin · {{ obsLinkLabel }}

    </Badge>



    <Button variant="ghost" size="sm" class="h-6 gap-1 px-2 text-[11px]" title="Copy OBS Browser Source URL" @click="copy(obsUrl, 'obs')">

      <Radio class="h-3.5 w-3.5" /> OBS Source

    </Button>

    <Button
      v-if="connector.remoteOverlayUrl"
      variant="ghost"
      size="sm"
      class="h-6 gap-1 px-2 text-[11px]"
      title="Copy overlay URL for streamer plugin (Browser remote)"
      @click="copy(connector.remoteOverlayUrl, 'overlay')"
    >

      <Link2 class="h-3.5 w-3.5" /> Streamer overlay

    </Button>

    <Button variant="ghost" size="sm" class="h-6 gap-1 px-2 text-[11px]" title="Copy Moderator URL" @click="copy(modUrl, 'mod')">

      <Link2 class="h-3.5 w-3.5" /> Moderator

    </Button>

    <Button variant="ghost" size="sm" class="h-6 gap-1 px-2 text-[11px]" title="Copy Multi-Alerts URL" @click="copy(alertsUrl, 'alerts')">

      <Copy class="h-3.5 w-3.5" /> Multi-Alerts

    </Button>

    <span v-if="copied" class="text-[var(--text-dim)]">copied!</span>



    <div class="flex-1" />



    <div class="flex items-center gap-1" :title="presenceTitle">

      <div

        v-for="(m, i) in visibleMods"

        :key="m.sessionId"

        class="-ml-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[var(--panel)] text-[9px] font-bold text-white first:ml-0"

        :style="{ background: avatarColor(m.avatarSeed), zIndex: 10 - i }"

      >{{ initials(m.displayName) }}</div>

      <div v-if="extraMods > 0" class="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--bg-3)] text-[9px] text-[var(--text-dim)]">

        +{{ extraMods }}

      </div>

      <span class="ml-1 text-[var(--text-dim)]">{{ scene.moderatorCount || 0 }}</span>

    </div>

  </footer>

</template>


