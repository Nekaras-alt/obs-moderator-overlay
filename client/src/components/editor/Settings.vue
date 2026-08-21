<!--
  Settings.vue — Fluent Settings: OBS WebSocket + Appearance (Phase 3/5).
-->
<template>
  <div class="qs-panel" v-if="open" role="dialog" :aria-label="t('panel.settings')">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <Settings2 class="h-4 w-4" />
        {{ t('panel.settings') }}
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('common.close')" :aria-label="t('common.close')" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <Tabs v-model="tab" class="min-h-0 flex-1 overflow-hidden">
      <TabsList class="h-auto min-h-0 flex-wrap justify-start gap-y-1">
        <TabsTrigger value="obs" class="flex-none">{{ t('settings.tab.obs') }}</TabsTrigger>
        <TabsTrigger value="security" class="flex-none">{{ t('settings.tab.security') }}</TabsTrigger>
        <TabsTrigger value="connector" class="flex-none">{{ t('settings.tab.connector') }}</TabsTrigger>
        <TabsTrigger value="appearance" class="flex-none">{{ t('settings.tab.appearance') }}</TabsTrigger>
        <TabsTrigger value="layout" class="flex-none">{{ t('settings.tab.layout') }}</TabsTrigger>
      </TabsList>

      <div class="qs-scroll">
        <TabsContent value="obs" class="qs-body">
          <div class="section-title">{{ t('settings.obs.title') }}</div>
          <div class="obs-row">
            <Switch
              :checked="obsDraft"
              :disabled="obsBusy"
              :class="{ 'opacity-60 cursor-wait': obsBusy }"
              :title="obsDraft ? t('settings.obs.saveConnect') : t('settings.obs.saveDisconnect')"
              @update:checked="obsDraft = $event"
            />
            <div class="obs-text">
              <span class="status-line">
                <strong>{{ obsDraft ? t('settings.obs.connectOnSave') : t('settings.obs.disconnectOnSave') }}</strong>
                <span
                  class="dot"
                  :class="scene.obsConnected ? 'live' : 'off'"
                  :title="scene.obsConnected ? t('settings.obs.liveLink') : t('settings.obs.noLiveLink')"
                ></span>
              </span>
              <small class="muted">
                {{ t('settings.obs.liveStatus') }}: {{ scene.obsConnected ? t('status.connected').toLowerCase() : t('status.disconnected').toLowerCase() }}.
                {{ t('settings.obs.hint') }}
              </small>
            </div>
          </div>
          <div class="obs-actions">
            <Button size="sm" :disabled="obsBusy || obsDraft === s.obsEnabled" @click="saveObs">
              {{ obsBusy ? t('settings.working') : t('settings.save') }}
            </Button>
            <Button size="sm" variant="secondary" :disabled="obsBusy || obsDraft === s.obsEnabled" @click="obsDraft = s.obsEnabled">
              {{ t('settings.reset') }}
            </Button>
            <Badge v-if="obsDraft !== s.obsEnabled" variant="secondary">{{ t('settings.unsaved') }}</Badge>
          </div>
        </TabsContent>

        <TabsContent value="security" class="qs-body">
          <div class="section-title">{{ t('settings.pin.title') }}</div>
          <small class="muted">{{ t('settings.pin.hint') }}</small>
          <label class="pin-field">
            <span>{{ t('settings.pin.current') }}</span>
            <input v-model="pinCurrent" type="password" autocomplete="current-password" />
          </label>
          <label class="pin-field">
            <span>{{ t('settings.pin.new') }}</span>
            <input v-model="pinNew" type="password" autocomplete="new-password" />
          </label>
          <label class="pin-field">
            <span>{{ t('settings.pin.confirm') }}</span>
            <input v-model="pinNewConfirm" type="password" autocomplete="new-password" />
          </label>
          <div class="obs-actions">
            <Button size="sm" :disabled="pinBusy" @click="savePin">
              {{ pinBusy ? t('settings.working') : t('settings.pin.save') }}
            </Button>
          </div>
          <p v-if="pinMsg" class="m-0 text-sm" :class="pinOk ? 'text-[var(--ok)]' : 'text-[var(--danger)]'">{{ pinMsg }}</p>
        </TabsContent>

        <TabsContent value="connector" class="qs-body">
          <div class="section-title">{{ t('settings.connector.title') }}</div>
          <small class="muted">{{ t('settings.connector.hint') }}</small>
          <small class="muted">{{ t('settings.connector.streamerPluginHint') }}</small>
          <div class="conn-now">
            <span class="status-line">
              <span class="dot" :class="transports.activeId ? 'live' : 'off'"></span>
              <strong>{{ nowUsingLabel }}</strong>
            </span>
            <div class="obs-actions">
              <Button size="sm" :disabled="connBusy || !activeOverlayBase" @click="copyActiveOverlay">{{ copyActiveLabel }}</Button>
              <Button size="sm" variant="secondary" :disabled="connBusy" @click="autoProfile">{{ t('settings.connector.auto') }}</Button>
            </div>
            <small v-if="betterHint" class="muted warn-hint">{{ betterHint }}</small>
          </div>
          <small class="muted disclaimer">{{ t('settings.connector.disclaimer') }}</small>

          <details
            v-for="meta in CONNECTOR_TRANSPORTS"
            :key="meta.id"
            class="conn-spoiler"
            :open="spoilerIsOpen(meta.id)"
            @toggle="onSpoilerToggle(meta.id, $event)"
          >
            <summary>
              <span class="spoiler-name">{{ t('settings.connector.transport.' + meta.id) }}</span>
              <Badge
                :class="transportBadgeClass(transportItem(meta.id))"
              >{{ transportBadgeLabel(transportItem(meta.id)) }}</Badge>
            </summary>
            <p class="conn-who">{{ t('settings.connector.who.' + meta.id) }}</p>
            <ol class="hs-steps">
              <li v-for="n in meta.steps" :key="n">{{ t(`settings.connector.steps.${meta.id}.${n}`) }}</li>
            </ol>
            <small v-if="meta.steam" class="muted">
              <a class="doc-link" :href="meta.steam" target="_blank" rel="noopener noreferrer">{{ t('settings.connector.steamPage') }}</a>
            </small>
            <small v-if="meta.docs" class="muted">
              <button type="button" class="doc-link" @click="openDoc(meta.docs)">{{ t('settings.connector.docsMore') }}</button>
            </small>
            <p v-if="meta.id === 'porthole'" class="conn-who muted">{{ t('settings.connector.portholeNote') }}</p>

            <template v-if="meta.id === 'headscale'">
              <Input v-model="headscaleUrl" class="h-8" placeholder="https://headscale.example" />
              <div class="obs-actions">
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="saveHeadscale">{{ t('settings.save') }}</Button>
              </div>
            </template>
            <template v-if="meta.id === 'wireguard'">
              <textarea v-model="wgConf" class="wg-area" rows="5" :placeholder="t('settings.connector.wgPlaceholder')" />
              <div class="obs-actions">
                <Button size="sm" :disabled="connBusy || !wgConf.trim()" @click="saveWg">{{ t('settings.connector.saveWg') }}</Button>
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="useWgProfile">{{ t('settings.connector.useWg') }}</Button>
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="exportWg">{{ t('settings.connector.exportWg') }}</Button>
              </div>
              <small class="muted" v-if="conn.wireguard?.confPath">{{ conn.wireguard.confPath }}</small>
            </template>
            <template v-if="meta.id === 'cloudflare'">
              <Input v-model="cloudflareHostname" class="h-8" :placeholder="t('settings.connector.cfPlaceholder')" />
              <div class="obs-actions">
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="saveCloudflare">{{ t('settings.connector.saveCf') }}</Button>
              </div>
            </template>
            <template v-if="meta.id === 'relay'">
              <div class="join-hero" v-if="conn.relay?.joinCode">
                <div class="join-hero-label">{{ t('settings.connector.join') }}</div>
                <code class="join-hero-code">{{ conn.relay.joinCode }}</code>
                <Button size="sm" :disabled="connBusy" @click="copyJoin">{{ copyJoinLabel }}</Button>
                <small class="muted" v-if="conn.relay?.paired">{{ t('settings.connector.paired') }}</small>
                <small class="muted" v-else-if="relayConnected">{{ t('settings.connector.waitingMod') }}</small>
                <small class="muted" v-if="conn.relay?.rttMs != null">RTT {{ conn.relay.rttMs }}ms</small>
              </div>
              <div class="section-title">{{ t('settings.connector.region') }}</div>
              <div class="seg">
                <Button size="sm" :variant="preferredRegion === 'auto' ? 'default' : 'secondary'" @click="setRegion('auto')">auto</Button>
                <Button size="sm" :variant="preferredRegion === 'ru' ? 'default' : 'secondary'" @click="setRegion('ru')">RU</Button>
                <Button size="sm" :variant="preferredRegion === 'eu' ? 'default' : 'secondary'" @click="setRegion('eu')">EU</Button>
              </div>
              <div class="obs-actions">
                <Button size="sm" :disabled="connBusy" @click="startRelay">{{ t('settings.connector.startRelay') }}</Button>
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="stopRelay">{{ t('settings.connector.stopRelay') }}</Button>
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="probeRelays">{{ t('settings.connector.probe') }}</Button>
              </div>
              <div v-if="probes.length" class="probe-list">
                <div v-for="p in probes" :key="p.id" class="probe-row">
                  <span>{{ p.region || p.id }}</span>
                  <span :class="p.ok ? 'ok' : 'bad'">{{ p.ok ? (p.rttMs + 'ms') : 'fail' }}</span>
                </div>
              </div>
              <small class="muted" v-if="!hasRelayUrls">{{ t('settings.connector.needRelays') }}</small>
              <textarea v-model="relaysText" class="wg-area" rows="3" :placeholder="t('settings.connector.relaysPlaceholder')" />
              <div class="obs-actions">
                <Button size="sm" variant="secondary" :disabled="connBusy" @click="saveRelays">{{ t('settings.connector.saveRelays') }}</Button>
              </div>
            </template>

            <label class="overlay-field">
              <span>{{ t('settings.connector.overlayField') }}</span>
              <div class="overlay-copy-row">
                <input class="overlay-input" readonly :value="displayOverlay(transportItem(meta.id))" />
                <Button
                  size="sm"
                  variant="secondary"
                  :disabled="!overlayBase(transportItem(meta.id))"
                  @click="copyItemOverlay(transportItem(meta.id))"
                >{{ copyItemLabel(meta.id) }}</Button>
              </div>
            </label>
          </details>

          <details
            class="conn-spoiler"
            :open="spoilerIsOpen('advanced')"
            @toggle="onSpoilerToggle('advanced', $event)"
          >
            <summary>
              <span class="spoiler-name">{{ t('settings.connector.advanced') }}</span>
            </summary>
            <label class="row-check">
              <input type="checkbox" :checked="!!conn.harden || hardenDraft" @change="toggleHarden($event.target.checked)" />
              <span>{{ t('settings.connector.harden') }}</span>
            </label>
            <small class="muted">{{ t('settings.connector.hardenHint') }}</small>
            <div class="section-title" style="margin-top:8px">{{ t('settings.connector.frames') }}</div>
            <small class="muted">{{ t('settings.connector.framesHint') }}</small>
            <small class="muted" v-if="frameStatus">
              Frames: {{ frameStatus.enabled ? 'on' : 'off' }}
              <template v-if="frameStatus.port"> · :{{ frameStatus.port }}</template>
              <template v-if="frameStatus.clients != null"> · clients {{ frameStatus.clients }}</template>
              <template v-if="frameStatus.frameId != null"> · id {{ frameStatus.frameId }}</template>
              <template v-if="frameStatus.browserConnected != null"> · browser {{ frameStatus.browserConnected ? '✓' : '—' }}</template>
              <template v-if="frameStatus.nativeConnected != null"> · native {{ frameStatus.nativeConnected ? '✓' : '—' }}</template>
            </small>
            <div class="obs-actions">
              <Button size="sm" :disabled="connBusy || frameStatus?.enabled" @click="startFrames">{{ t('settings.connector.framesOn') }}</Button>
              <Button size="sm" variant="secondary" :disabled="connBusy || !frameStatus?.enabled" @click="stopFrames">{{ t('settings.connector.framesOff') }}</Button>
              <Button size="sm" variant="secondary" :disabled="connBusy" @click="refreshConnector">{{ t('settings.connector.refreshStatus') }}</Button>
            </div>
          </details>
          <p v-if="connError" class="m-0 text-sm text-[var(--danger)]">{{ connError }}</p>
        </TabsContent>

        <TabsContent value="appearance" class="qs-body">
          <div class="section-title">{{ t('settings.theme') }}</div>
          <div class="seg">
            <Button size="sm" :variant="s.theme === 'dark' ? 'default' : 'secondary'" @click="scene.updateSettings({ theme: 'dark' })">{{ t('settings.theme.dark') }}</Button>
            <Button size="sm" :variant="s.theme === 'light' ? 'default' : 'secondary'" @click="scene.updateSettings({ theme: 'light' })">{{ t('settings.theme.light') }}</Button>
          </div>

          <div class="section-title">{{ t('settings.density') }}</div>
          <div class="seg">
            <Button size="sm" :variant="prefs.density === 'comfortable' ? 'default' : 'secondary'" @click="setDensity('comfortable')">{{ t('settings.density.comfortable') }}</Button>
            <Button size="sm" :variant="prefs.density === 'compact' ? 'default' : 'secondary'" @click="setDensity('compact')">{{ t('settings.density.compact') }}</Button>
          </div>

          <div class="section-title">{{ t('settings.accent') }}</div>
          <div class="accent-grid">
            <button
              v-for="p in ACCENT_PRESETS"
              :key="p.id"
              type="button"
              class="accent-swatch"
              :class="{ active: prefs.accentId === p.id }"
              :style="{ '--sw': p.color }"
              :title="p.label"
              :aria-label="p.label"
              :aria-pressed="prefs.accentId === p.id"
              @click="pickAccent(p.id)"
            ></button>
            <label class="accent-custom" :title="t('settings.accent.custom')">
              <input type="color" :value="customHex" @input="onCustomAccent" />
              <span>{{ t('settings.accent.custom') }}</span>
            </label>
          </div>
          <small class="muted">{{ t('settings.accent.hint') }}</small>

          <div class="section-title">{{ t('settings.language') }}</div>
          <div class="seg">
            <Button size="sm" :variant="locale === 'en' ? 'default' : 'secondary'" @click="setLocale('en')">English</Button>
            <Button size="sm" :variant="locale === 'ru' ? 'default' : 'secondary'" @click="setLocale('ru')">Русский</Button>
          </div>
        </TabsContent>

        <TabsContent value="layout" class="qs-body">
          <div class="section-title">{{ t('settings.ultrawide') }}</div>
          <label class="row-check">
            <input type="checkbox" :checked="prefs.toolsDock" @change="setToolsDock($event.target.checked)" />
            <span>{{ t('settings.toolsDock') }}</span>
          </label>
          <small class="muted">{{ t('settings.toolsDock.hint') }}</small>

          <div class="section-title" style="margin-top:8px">{{ t('settings.widths') }}</div>
          <div class="width-row">
            <label>{{ t('settings.width.nav') }}
              <input type="number" min="0" max="480" step="8" :value="prefs.navWidth || 0" @change="prefs.navWidth = numOrNull($event)" />
            </label>
            <label>{{ t('settings.width.inspector') }}
              <input type="number" min="0" max="480" step="8" :value="prefs.inspectorWidth || 0" @change="prefs.inspectorWidth = numOrNull($event)" />
            </label>
          </div>

          <div class="section-title" style="margin-top:8px">{{ t('settings.panelsVisibility') }}</div>
          <small class="muted">{{ t('settings.panelsVisibility.hint') }}</small>
          <label v-for="id in TOGGLEABLE_PANELS" :key="id" class="row-check">
            <input
              type="checkbox"
              :checked="isPanelEnabled(id)"
              @change="setPanelEnabled(id, $event.target.checked)"
            />
            <span>{{ panelVisibilityLabel(id) }}</span>
          </label>

          <div class="obs-actions" style="margin-top:8px">
            <Button size="sm" variant="secondary" @click="resetLayout">{{ t('settings.resetLayout') }}</Button>
          </div>
        </TabsContent>
      </div>
    </Tabs>
    <Dialog :open="docOpen" :title="docTitle" class="!w-[min(560px,94vw)]" @update:open="onDocOpen">
      <pre class="doc-md">{{ docBody }}</pre>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { Settings2, X } from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useUiPrefs, ACCENT_PRESETS, TOGGLEABLE_PANELS } from '@/features/uiPrefs.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'

const props = defineProps({
  open: { type: Boolean, default: false },
  initialTab: { type: String, default: '' }
})
defineEmits(['close'])

const scene = useSceneStore()
const s = computed(() => scene.settings)
const { prefs, setDensity, setAccent, setToolsDock, resetLayout, applyAccentToDocument, isPanelEnabled, setPanelEnabled } = useUiPrefs()
const { t, locale, setLocale } = useI18n()

const tab = ref('obs')
const docOpen = ref(false)
const docTitle = ref('')
const docBody = ref('')
watch(() => props.initialTab, (v) => {
  if (v) tab.value = v
}, { immediate: true })

function panelVisibilityLabel(id) {
  const keys = {
    spotify: 'panel.spotify',
    jeetbot: 'panel.jeetbot',
    pastes: 'panel.pastes',
    stream: 'panel.stream'
  }
  return t(keys[id] || id)
}
const CONNECTOR_TRANSPORTS = [
  { id: 'tailscale', steps: 8, docs: '/docs/TAILSCALE.md' },
  { id: 'headscale', steps: 8, docs: '/docs/HEADSCALE.md' },
  { id: 'netbird', steps: 8, docs: '' },
  { id: 'zerotier', steps: 8, docs: '' },
  { id: 'radmin', steps: 8, docs: '' },
  { id: 'porthole', steps: 8, docs: '/docs/PORTHOLE.md', steam: 'https://store.steampowered.com/app/4963920/Porthole__Local_Port_Sharing/' },
  { id: 'wireguard', steps: 7, docs: '/docs/CONNECTOR.md' },
  { id: 'cloudflare', steps: 6, docs: '' },
  { id: 'relay', steps: 7, docs: '/docs/CONNECTOR.md' }
]

const obsBusy = ref(false)
const obsDraft = ref(!!s.value.obsEnabled)
const pinCurrent = ref('')
const pinNew = ref('')
const pinNewConfirm = ref('')
const pinBusy = ref(false)
const pinMsg = ref('')
const pinOk = ref(false)
const conn = ref({})
const probes = ref([])
const connBusy = ref(false)
const connError = ref('')
const wgConf = ref('')
const headscaleUrl = ref('')
const cloudflareHostname = ref('')
const preferredRegion = ref('auto')
const hardenDraft = ref(false)
const relaysText = ref('')
const frameStatus = ref(null)
const copyFlash = ref(false)
const copyActiveFlash = ref(false)
const copyFlashId = ref('')
const viewerToken = ref('')
const spoilerState = ref({})
const overlayUrls = ref({})

const transports = computed(() => conn.value.transports || { activeId: null, recommendedId: null, hint: '', items: [] })
const defaultSpoiler = computed(() => transports.value.activeId || transports.value.recommendedId || 'tailscale')
const nowUsingLabel = computed(() => {
  const id = transports.value.activeId
  if (!id) return t('settings.connector.nowUsingNone')
  return t('settings.connector.nowUsing', { name: t('settings.connector.transport.' + id) })
})
const betterHint = computed(() => {
  const hint = transports.value.hint
  const rec = transports.value.recommendedId
  const active = transports.value.activeId
  if (hint && rec && rec !== active) {
    return t('settings.connector.hintInstalledNotLive', { name: t('settings.connector.transport.' + rec) })
  }
  return ''
})
const activeOverlayBase = computed(() => {
  const id = transports.value.activeId
  const item = (transports.value.items || []).find((i) => i.id === id)
  return overlayBase(item)
})
const copyActiveLabel = computed(() =>
  copyActiveFlash.value ? t('settings.connector.copied') : t('settings.connector.copyActiveOverlay')
)

const relayConnected = computed(() =>
  !!(conn.value.relay?.host?.connected || conn.value.relay?.hosts?.some((h) => h.connected))
)
const hasRelayUrls = computed(() => {
  const eps = conn.value.relay?.endpoints
  if (Array.isArray(eps) && eps.some((e) => e?.url)) return true
  return String(relaysText.value || '').trim().length > 0
})
const copyJoinLabel = computed(() =>
  copyFlash.value ? t('settings.connector.copied') : t('settings.connector.copyJoin')
)
const remoteOverlayUrl = computed(() => conn.value.relay?.remoteOverlayUrl || '')

function transportItem(id) {
  return (transports.value.items || []).find((i) => i.id === id) || { id, installed: false, up: false, live: false }
}

function spoilerIsOpen(id) {
  if (Object.prototype.hasOwnProperty.call(spoilerState.value, id)) return !!spoilerState.value[id]
  return id === defaultSpoiler.value
}

function onSpoilerToggle(id, e) {
  const el = e?.target
  if (!el || el.tagName !== 'DETAILS') return
  spoilerState.value = { ...spoilerState.value, [id]: el.open }
}

function transportBadgeLabel(item) {
  if (!item) return t('settings.connector.badge.offline')
  if (item.live && item.id === transports.value.activeId) return t('settings.connector.badge.live')
  if (item.live) return t('settings.connector.badge.up')
  if (item.installed) return t('settings.connector.badge.installed')
  return t('settings.connector.badge.offline')
}

function transportBadgeClass(item) {
  if (item?.live && item.id === transports.value.activeId) {
    return 'border-[color-mix(in_srgb,var(--ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-[var(--ok)]'
  }
  if (item?.installed) return ''
  return 'opacity-70'
}

function overlayBase(item) {
  if (!item) return ''
  return item.overlayUrl || (item.id === 'relay' ? remoteOverlayUrl.value : '') || ''
}

function withToken(base, needsToken) {
  if (!base) return ''
  if (!needsToken) return base
  const tok = viewerToken.value
  if (!tok) return base
  if (/[?&]t=/.test(base)) return base
  return base + (base.includes('?') ? '&' : '?') + 't=' + tok
}

function displayOverlay(item) {
  const id = item?.id
  if (id && overlayUrls.value[id]) return overlayUrls.value[id]
  return withToken(overlayBase(item), item?.needsToken !== false && item?.id !== 'relay')
}

function copyItemLabel(id) {
  return copyFlashId.value === id ? t('settings.connector.copied') : t('settings.connector.copyThisOverlay')
}

async function ensureViewerToken() {
  if (viewerToken.value) return viewerToken.value
  try {
    const token = localStorage.getItem('omo_token') || ''
    const r = await fetch('/api/viewer-token', {
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    }).then((x) => x.json())
    viewerToken.value = r?.token || ''
  } catch (_) { /* ignore */ }
  return viewerToken.value
}

async function pasteUrlFor(item) {
  const base = overlayBase(item)
  if (!base) return ''
  if (item?.id === 'relay' || item?.needsToken === false) return base
  await ensureViewerToken()
  return withToken(base, true)
}

async function copyText(text, flashKey) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    if (flashKey === 'active') {
      copyActiveFlash.value = true
      setTimeout(() => { copyActiveFlash.value = false }, 1600)
    } else if (flashKey) {
      copyFlashId.value = flashKey
      setTimeout(() => { if (copyFlashId.value === flashKey) copyFlashId.value = '' }, 1600)
    }
  } catch (_) {
    connError.value = t('settings.connector.copyFailed')
  }
}

async function copyItemOverlay(item) {
  const url = await pasteUrlFor(item)
  if (item?.id) overlayUrls.value = { ...overlayUrls.value, [item.id]: url }
  await copyText(url, item?.id)
}

async function copyActiveOverlay() {
  const id = transports.value.activeId
  const item = (transports.value.items || []).find((i) => i.id === id)
  const url = await pasteUrlFor(item)
  await copyText(url, 'active')
}

async function refreshConnector() {
  try {
    const st = await fetch('/api/connector/status').then((r) => r.json())
    conn.value = st
    if (Array.isArray(st.probes)) probes.value = st.probes
    headscaleUrl.value = st.headscaleUrl || headscaleUrl.value
    cloudflareHostname.value = st.cloudflareHostname || cloudflareHostname.value
    preferredRegion.value = st.preferredRegion || 'auto'
    hardenDraft.value = !!st.harden || !!st.bindHostOnly
    if (Array.isArray(st.relay?.endpoints)) {
      relaysText.value = st.relay.endpoints.map((e) => e.url).join('\n')
    }
  } catch (_) { /* ignore */ }
  try {
    await ensureViewerToken()
  } catch (_) { /* ignore */ }
  try {
    frameStatus.value = await fetch('/api/obs-plugin/frame-bridge').then((r) => r.json())
  } catch (_) {
    frameStatus.value = null
  }
}

let framePoll = null
watch(() => props.open, (o) => {
  if (framePoll) { clearInterval(framePoll); framePoll = null }
  if (o) {
    obsDraft.value = !!s.value.obsEnabled
    tab.value = 'obs'
    refreshConnector()
    framePoll = setInterval(() => { if (tab.value === 'connector') refreshConnector() }, 5000)
  }
})
watch(() => s.value.obsEnabled, (v) => { if (v !== obsDraft.value && !obsBusy.value) obsDraft.value = !!v })
watch(tab, (v) => { if (v === 'connector') refreshConnector() })
onUnmounted(() => { if (framePoll) clearInterval(framePoll) })

async function startFrames() {
  connBusy.value = true
  connError.value = ''
  try {
    const st = await fetch('/api/obs-plugin/frame-bridge/start', { method: 'POST' }).then((r) => r.json())
    if (!st.ok) throw new Error(st.error || 'failed')
    frameStatus.value = st
  } catch (e) {
    connError.value = e.message || String(e)
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function stopFrames() {
  connBusy.value = true
  try {
    const st = await fetch('/api/obs-plugin/frame-bridge/stop', { method: 'POST' }).then((r) => r.json())
    frameStatus.value = st
  } catch (e) {
    connError.value = e.message || String(e)
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}
const customHex = computed(() =>
  prefs.accentId === 'custom' && prefs.customAccent ? prefs.customAccent : '#0078d4'
)

function pickAccent(id) {
  setAccent(id)
  const el = document.querySelector('.editor')
  if (el) applyAccentToDocument(el)
}
function onCustomAccent(e) {
  const hex = e.target.value
  setAccent('custom', hex)
  const el = document.querySelector('.editor')
  if (el) applyAccentToDocument(el)
}
function numOrNull(e) {
  const n = Number(e.target.value)
  return n > 0 ? n : null
}

async function saveObs() {
  if (obsBusy.value || obsDraft.value === s.value.obsEnabled) return
  obsBusy.value = true
  try {
    await scene.toggleObs(obsDraft.value)
  } catch (e) {
    obsDraft.value = !!s.value.obsEnabled
  } finally {
    obsBusy.value = false
  }
}

async function savePin() {
  pinMsg.value = ''
  pinOk.value = false
  if (pinNew.value !== pinNewConfirm.value) {
    pinMsg.value = t('login.setupMismatch')
    return
  }
  pinBusy.value = true
  try {
    const token = localStorage.getItem('omo_token') || ''
    const r = await fetch('/api/pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({
        currentPin: pinCurrent.value,
        newPin: pinNew.value,
        newPinConfirm: pinNewConfirm.value
      })
    }).then((x) => x.json())
    if (!r.ok) {
      pinMsg.value = r.error || t('settings.pin.failed')
      return
    }
    pinOk.value = true
    pinMsg.value = t('settings.pin.saved')
    pinCurrent.value = ''
    pinNew.value = ''
    pinNewConfirm.value = ''
  } catch (e) {
    pinMsg.value = e.message || t('settings.pin.failed')
  } finally {
    pinBusy.value = false
  }
}

async function startRelay() {
  connBusy.value = true
  connError.value = ''
  try {
    const st = await fetch('/api/connector/host/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then((r) => r.json())
    if (!st.ok) throw new Error(st.error || t('settings.connector.relayFailed'))
    conn.value = st
  } catch (e) {
    connError.value = e.message || t('settings.connector.relayFailed')
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function autoProfile() {
  connBusy.value = true
  connError.value = ''
  try {
    const st = await fetch('/api/connector/host/auto', { method: 'POST' }).then((r) => r.json())
    if (!st.ok) throw new Error(st.error || 'failed')
    conn.value = st
  } catch (e) {
    connError.value = e.message || String(e)
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function stopRelay() {
  connBusy.value = true
  try {
    await fetch('/api/connector/host/stop', { method: 'POST' })
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function probeRelays() {
  connBusy.value = true
  try {
    const r = await fetch('/api/connector/probe', { method: 'POST' }).then((x) => x.json())
    probes.value = r.probes || []
  } finally {
    connBusy.value = false
  }
}

function copyJoin() {
  const code = conn.value.relay?.joinCode
  if (!code) return
  navigator.clipboard?.writeText(code).then(() => {
    copyFlash.value = true
    setTimeout(() => { copyFlash.value = false }, 1600)
  }).catch(() => {
    connError.value = t('settings.connector.copyFailed')
  })
}

async function saveCloudflare() {
  connBusy.value = true
  try {
    await fetch('/api/connector/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cloudflareHostname: cloudflareHostname.value })
    })
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function saveWg() {
  connBusy.value = true
  connError.value = ''
  try {
    const r = await fetch('/api/connector/wireguard', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conf: wgConf.value })
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'failed')
  } catch (e) {
    connError.value = e.message || String(e)
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function useWgProfile() {
  await fetch('/api/connector/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'wireguard' })
  })
  refreshConnector()
}

async function saveHeadscale() {
  connBusy.value = true
  try {
    await fetch('/api/connector/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ headscaleUrl: headscaleUrl.value })
    })
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function setRegion(region) {
  preferredRegion.value = region
  connBusy.value = true
  try {
    await fetch('/api/connector/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredRegion: region })
    })
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function toggleHarden(on) {
  hardenDraft.value = on
  connBusy.value = true
  try {
    await fetch('/api/connector/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harden: on, bindHostOnly: on })
    })
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function saveRelays() {
  connBusy.value = true
  connError.value = ''
  try {
    const urls = relaysText.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    const relays = urls.map((url, i) => ({
      id: i === 0 ? 'eu' : (i === 1 ? 'ru' : `r${i}`),
      url,
      region: i === 0 ? 'eu' : (i === 1 ? 'ru' : `r${i}`)
    }))
    const r = await fetch('/api/connector/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relays, multiHome: true, failover: true })
    }).then((x) => x.json())
    if (!r.ok) throw new Error(r.error || 'failed')
  } catch (e) {
    connError.value = e.message || String(e)
  } finally {
    connBusy.value = false
    refreshConnector()
  }
}

async function exportWg() {
  try {
    const text = await fetch('/api/connector/wireguard/export').then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error || 'export failed')
      return r.text()
    })
    wgConf.value = text
    await navigator.clipboard?.writeText(text)
  } catch (e) {
    connError.value = e.message || String(e)
  }
}

function onDocOpen(v) {
  docOpen.value = !!v
  if (!v) docBody.value = ''
}

async function openDoc(href) {
  const name = String(href || '').replace(/^\/docs\//, '').replace(/\\/g, '')
  if (!/^[\w.-]+\.md$/i.test(name)) return
  docTitle.value = name.replace(/\.md$/i, '')
  docBody.value = t('settings.working')
  docOpen.value = true
  try {
    const r = await fetch('/docs/' + encodeURIComponent(name))
    if (!r.ok) throw new Error('not found')
    docBody.value = await r.text()
  } catch (_) {
    docBody.value = t('settings.connector.docsFailed')
  }
}
</script>

<style scoped>
.qs-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 380px;
  max-height: calc(100vh - 100px);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 97;
  overflow: hidden;
}
.qs-scroll {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.qs-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.qs-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}
.obs-row { display: flex; gap: 12px; align-items: flex-start; }
.pin-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.pin-field input {
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--fluent-stroke);
  background: var(--bg);
  color: var(--text);
}
.join-hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--fluent-accent) 35%, transparent);
  background: color-mix(in srgb, var(--fluent-accent) 10%, transparent);
}
.join-hero-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}
.join-hero-code {
  font-size: 1.65rem;
  letter-spacing: 0.18em;
  font-weight: 700;
  text-align: center;
  padding: 6px 0;
}
.obs-text { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.status-line { display: flex; align-items: center; gap: 8px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-dim);
}
.dot.live { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
.obs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.seg { display: flex; gap: 6px; flex-wrap: wrap; }
.accent-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.accent-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--sw);
  padding: 0;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.15);
}
.accent-swatch.active {
  border-color: var(--text);
  box-shadow: 0 0 0 2px var(--fluent-accent);
}
.accent-custom {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}
.accent-custom input {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}
.row-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}
.width-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.width-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}
.width-row input { width: 100%; }
.probe-list { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
.probe-row { display: flex; justify-content: space-between; color: var(--text-dim); }
.probe-row .ok { color: var(--ok); }
.probe-row .bad { color: var(--danger); }
.wg-area {
  width: 100%;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  background: var(--fluent-layer);
  color: var(--text);
  border: 1px solid var(--fluent-stroke);
  border-radius: 6px;
  padding: 8px;
  resize: vertical;
}
.warn-hint { color: var(--warn, #c9a227); display: block; }
.disclaimer { display: block; margin-top: 4px; }
.conn-now {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--fluent-accent) 28%, transparent);
  background: color-mix(in srgb, var(--fluent-accent) 8%, transparent);
}
.conn-spoiler {
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  padding: 0 8px 8px;
  background: var(--fluent-layer, var(--bg-2));
}
.conn-spoiler summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  padding: 8px 2px;
  font-size: 12px;
  font-weight: 600;
}
.conn-spoiler summary::-webkit-details-marker { display: none; }
.conn-spoiler .spoiler-name { flex: 1; }
.conn-spoiler[open] summary { border-bottom: 1px solid var(--fluent-stroke); margin-bottom: 8px; }
.conn-who {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
}
.hs-steps {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  flex-direction: column;
  gap: 6px;
  line-height: 1.4;
}
.overlay-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 8px;
}
.overlay-copy-row { display: flex; gap: 6px; align-items: center; }
.overlay-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--fluent-stroke);
  background: var(--bg);
  color: var(--text);
  font-size: 11px;
}
.doc-link {
  display: inline;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  color: var(--fluent-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.doc-link:hover { opacity: 0.9; }
.doc-md {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  font-family: inherit;
  color: var(--text);
}
</style>
