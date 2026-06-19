<!--
  EmotePanel.vue
  Stickers / Emotes picker (7TV · BetterTTV · FrankerFaceZ). Docks top-right
  like the other panels. Two modes:
    - Browse: provider-filtered search grid + global lists.
    - By URL/ID: paste a CDN URL or emote id; the client builds the link
      directly (works for all three).

  7TV: search + browse work anonymously via GraphQL. Connecting your 7TV
  account is optional and unlocks "My Emotes" — your personal emote sets.
  Your token stays server-side; the browser never sees it.

  Clicking an emote adds an `emote`-typed layer, which renders via <img> in
  both the editor and the OBS Browser Source. See client/src/features/emotes.js.
-->
<template>
  <div class="emote-panel" v-if="open">
    <div class="ep-head">
      <span class="ep-title">😀 Stickers</span>
      <span class="spacer"></span>
      <button class="btn-sm" @click="$emit('close')" title="Close">✕</button>
    </div>

    <!-- Mode tabs -->
    <div class="ep-tabs">
      <button :class="{ active: mode === 'browse' }" @click="mode = 'browse'">Browse</button>
      <button :class="{ active: mode === 'id' }" @click="mode = 'id'">By URL / ID</button>
    </div>

    <!-- Provider filter -->
    <div class="ep-provs">
      <button
        v-for="key in PROVIDER_KEYS"
        :key="key"
        :class="{ active: provider === key, dim: provider !== key }"
        :style="provider === key ? { borderColor: PROVIDERS[key].color, color: PROVIDERS[key].color } : null"
        :title="PROVIDERS[key].label"
        @click="provider = key"
      >{{ PROVIDERS[key].label }}</button>
    </div>

    <!-- 7TV Account row (only when provider is 7TV) -->
    <div v-if="provider === '7tv'" class="ep-account">
      <!-- Not connected -->
      <template v-if="!sevenConnected">
        <div class="ep-acct-row">
          <input
            v-model="sevenTokenInput"
            class="ep-acct-input"
            type="password"
            placeholder="Paste 7TV access token…"
            @keydown.enter="connect7tv"
          />
          <button class="btn-sm primary" :disabled="!sevenTokenInput.trim() || sevenLoading" @click="connect7tv">
            Connect
          </button>
        </div>
        <div v-if="sevenError" class="ep-error small">{{ sevenError }}</div>
        <p class="ep-hint muted small">
          Optional — enables "My Emotes" from your 7TV account.
          Get your token from 7tv.app → Settings.
        </p>
      </template>
      <!-- Connected -->
      <template v-else>
        <div class="ep-acct-row">
          <span class="ep-acct-ok">✓ {{ sevenUsername }}</span>
          <button class="btn-sm" @click="disconnect7tv">Disconnect</button>
        </div>
      </template>
    </div>

    <!-- BROWSE -->
    <div v-if="mode === 'browse'" class="ep-body">
      <!-- My Emotes / Global toggle (7TV only, when connected) -->
      <div v-if="provider === '7tv' && sevenConnected && !query" class="ep-sourcetoggle">
        <button :class="{ active: browseSource === 'my' }" @click="browseSource = 'my'">My Emotes</button>
        <button :class="{ active: browseSource === 'global' }" @click="browseSource = 'global'">Global</button>
      </div>

      <input
        v-model="query"
        class="ep-search"
        :placeholder="'Search ' + PROVIDERS[provider].label + '…'"
        @input="onSearch"
      />
      <div v-if="searchError" class="ep-error">{{ searchError }}</div>
      <div v-if="loading" class="ep-status">Loading…</div>
      <div v-else-if="!results.length" class="ep-status muted">
        {{ query ? 'No matches.' : 'Type to search, or browse the list.' }}
      </div>
      <div v-else class="ep-grid">
        <button
          v-for="e in results"
          :key="e.provider + ':' + e.id"
          class="ep-cell"
          :title="e.name + (e.animated ? ' (animated)' : '')"
          @click="pick(e)"
        >
          <img :src="e.url" :alt="e.name" loading="lazy" draggable="false" />
        </button>
      </div>
    </div>

    <!-- BY URL / ID -->
    <div v-else class="ep-body">
      <p class="ep-hint muted small">
        Paste a direct image URL <em>or</em> an emote ID for
        <strong>{{ PROVIDERS[provider].label }}</strong>. We'll build the CDN link for you.
      </p>
      <input
        v-model="idInput"
        class="ep-search"
        :placeholder="'emote id or https://…'"
        @keydown.enter="addFromId"
      />
      <div class="ep-idopts">
        <label v-if="provider !== '7tv'">
          <input type="checkbox" v-model="idStatic" />
          <span>Static (no animation)</span>
        </label>
        <label v-if="provider === 'ffz'">
          <input type="checkbox" v-model="idAnimated" />
          <span>Animated variant</span>
        </label>
      </div>
      <button class="btn-sm primary ep-add" :disabled="!idInput.trim()" @click="addFromId">
        Add to scene
      </button>
      <div v-if="idError" class="ep-error">{{ idError }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import {
  PROVIDERS, PROVIDER_KEYS, searchEmotes, globalEmotes, myEmotes,
  buildCdnUrl, addEmote, sevenLogin, sevenAccount, sevenLogout
} from '../../features/emotes.js'

const props = defineProps({ open: { type: Boolean, default: false } })
defineEmits(['close'])

const mode = ref('browse')
const provider = ref('bttv')
const query = ref('')
const results = ref([])
const loading = ref(false)
const searchError = ref('')

// By-URL/ID state
const idInput = ref('')
const idStatic = ref(false)
const idAnimated = ref(false)
const idError = ref('')

// 7TV account state
const sevenConnected = ref(false)
const sevenUsername = ref('')
const sevenTokenInput = ref('')
const sevenLoading = ref(false)
const sevenError = ref('')

// Browse source toggle: 'my' = user's emote sets, 'global' = curated list
const browseSource = ref('my')

let searchTimer = null

// Debounced search; empty query loads the browse source (My Emotes if
// connected + source=my, else global list).
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 200)
}

async function runSearch() {
  const cfg = PROVIDERS[provider.value]
  if (!cfg.search) { results.value = []; return }
  loading.value = true
  searchError.value = ''
  try {
    const q = query.value.trim()
    if (q) {
      results.value = await searchEmotes(provider.value, q)
    } else if (provider.value === '7tv' && sevenConnected.value && browseSource.value === 'my') {
      const data = await myEmotes('7tv')
      results.value = data.results || []
      // If the user got disconnected server-side, reflect it.
      if (!data.connected) { sevenConnected.value = false; sevenUsername.value = '' }
    } else if (cfg.global) {
      results.value = await globalEmotes(provider.value)
    } else {
      results.value = []
    }
  } catch (err) {
    results.value = []
    searchError.value = err.message
  } finally {
    loading.value = false
  }
}

// When switching provider, reset and reload.
watch(provider, () => {
  query.value = ''
  results.value = []
  searchError.value = ''
  if (mode.value === 'browse') runSearch()
})

// When switching browseSource, reload.
watch(browseSource, () => {
  if (mode.value === 'browse' && !query.value) runSearch()
})

// When 7TV connection status changes, reload if we're browsing.
watch(sevenConnected, () => {
  if (provider.value === '7tv' && mode.value === 'browse' && !query.value) runSearch()
})

// Initial load when the panel first opens + on provider change.
watch(() => [mode.value, provider.value], () => {
  if (mode.value === 'browse' && !query.value && PROVIDERS[provider.value].global && !results.value.length) {
    runSearch()
  }
}, { immediate: true })

// Probe 7TV account status on panel open (non-blocking).
watch(() => props.open, (isOpen) => {
  if (isOpen && provider.value === '7tv') probe7tv()
})
// Also probe when switching to 7TV while panel is open.
watch(provider, () => {
  if (provider.value === '7tv' && props.open) probe7tv()
})

async function probe7tv() {
  try {
    const data = await sevenAccount()
    sevenConnected.value = !!data.connected
    sevenUsername.value = data.username || ''
  } catch (_) {
    sevenConnected.value = false
    sevenUsername.value = ''
  }
}

async function connect7tv() {
  sevenError.value = ''
  sevenLoading.value = true
  try {
    const data = await sevenLogin(sevenTokenInput.value.trim())
    sevenConnected.value = true
    sevenUsername.value = data.username
    sevenTokenInput.value = ''
  } catch (err) {
    sevenError.value = err.message
  } finally {
    sevenLoading.value = false
  }
}

async function disconnect7tv() {
  try { await sevenLogout() } catch (_) { /* best effort */ }
  sevenConnected.value = false
  sevenUsername.value = ''
}

function pick(e) {
  addEmote(e).catch((err) => { searchError.value = err.message })
}

function addFromId() {
  idError.value = ''
  const built = buildCdnUrl(provider.value, idInput.value, {
    static: idStatic.value,
    animated: idAnimated.value
  })
  if (!built) { idError.value = 'Enter an emote id or URL.'; return }
  addEmote({ ...built, name: built.emoteId || 'Emote' })
    .then(() => { idInput.value = '' })
    .catch((err) => { idError.value = err.message })
}
</script>

<style scoped>
.emote-panel {
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
  z-index: 99;
  overflow: hidden;
}
.ep-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.ep-title { font-weight: 600; }
.spacer { flex: 1; }
.ep-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.ep-tabs button {
  flex: 1;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.ep-tabs button.active {
  background: var(--panel);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.ep-provs {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.ep-provs button {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.ep-provs button.dim { color: var(--text-dim); }

/* 7TV Account row */
.ep-account {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ep-acct-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ep-acct-input {
  flex: 1;
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
}
.ep-acct-ok {
  flex: 1;
  font-size: 12px;
  color: #22d3ee;
  font-weight: 500;
}

/* My Emotes / Global toggle */
.ep-sourcetoggle {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.ep-sourcetoggle button {
  padding: 3px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-dim);
  cursor: pointer;
}
.ep-sourcetoggle button.active {
  border-color: #22d3ee;
  color: #22d3ee;
  font-weight: 600;
}

.ep-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  overflow-y: auto;
  min-height: 180px;
}
.ep-search {
  width: 100%;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.ep-search:disabled { opacity: 0.5; }
.ep-status { font-size: 12px; color: var(--text-dim); padding: 8px 0; }
.ep-error { font-size: 12px; color: var(--danger); }
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 6px;
}
.ep-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.ep-cell:hover {
  background: var(--hover);
  border-color: var(--accent);
}
.ep-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.ep-hint { margin: 0; line-height: 1.45; }
.ep-idopts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ep-idopts label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.ep-add { align-self: flex-start; padding: 6px 14px; }

/* Shared small button (matches PresetPanel's .btn-sm) */
.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.btn-sm:hover { background: var(--hover); }
.btn-sm.primary { border-color: var(--accent); color: var(--accent); }
.btn-sm.primary:hover { background: rgba(59,130,246,0.15); }
.btn-sm:disabled { opacity: 0.45; cursor: default; }

.small { font-size: 11px; }
.muted { color: var(--text-dim); }
</style>
