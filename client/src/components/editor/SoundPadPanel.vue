<!--
  SoundPadPanel.vue
  SoundPad — 10 big trigger buttons for quick reaction sounds. Docks top-right
  like the other panels. Two tabs:

    Pad   — the 10 buttons. LMB click = play on BOTH moderator + OBS (broadcast).
            Right-click (ПКМ) = open properties (configure, preview, play on stream).
            Empty slots open properties on click.
    Search — search MyInstants / UwUpad for sounds. Click ▶ = play on stream,
             ▶▷ = preview (moderator only), "→ Slot" assigns to a pad slot.

  Slot state is server-authoritative (persisted in scene.soundpad, survives
  restart). Playback is transient (not persisted) — see SoundPlayer.vue.
-->
<template>
  <div class="sp-panel" v-if="open">
    <div class="fluent-panel-head sp-head">
      <span class="fluent-panel-title">
        <Volume2 class="h-4 w-4" />
        {{ t('panel.soundpad') }}
      </span>
      <span class="spacer"></span>
      <Button size="sm" variant="destructive" class="stop-btn" title="Stop all (Esc)" @click="stopAll">
        <Square class="h-3.5 w-3.5" /> Stop
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('common.close')" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>
    <div class="sp-master-row">
      <label class="sp-master" title="Master volume">
        <span>Vol</span>
        <input type="range" min="0" max="1" step="0.02" :value="masterVol" @input="setMaster(+($event.target.value))" />
        <span class="sp-vol-val">{{ Math.round(masterVol * 100) }}%</span>
      </label>
      <label class="sp-comp" title="Level loud/quiet sounds">
        <input type="checkbox" :checked="compressorOn" @change="setCompressor($event.target.checked)" />
        Comp
      </label>
    </div>

    <!-- Mode tabs -->
    <div class="sp-tabs fluent-tabs">
      <button :class="{ active: tab === 'pad' }" @click="tab = 'pad'">Pad</button>
      <button :class="{ active: tab === 'search' }" @click="tab = 'search'">Search</button>
      <button :class="{ active: tab === 'favorites' }" @click="tab = 'favorites'">
        <Star class="h-3.5 w-3.5 inline" /> Favorites
      </button>
    </div>

    <Transition name="tab-fade" mode="out-in">
    <!-- PAD TAB -->
    <div v-if="tab === 'pad'" key="pad" class="sp-body">
      <div class="sp-pad-grid list-stagger">
        <ContextMenu v-for="(slot, i) in scene.soundpad" :key="i">
          <ContextMenuTrigger as-child>
            <div
              class="sp-pad-btn"
              :class="{ empty: !slot.src, editing: editing === i, playing: scene.playingSlotId === i, 'drag-over': dragOver === i }"
              :style="{ '--btn-color': slot.color || '#3b82f6' }"
              draggable="true"
              @click="onPadClick(slot, i)"
              @dragstart.stop="onSlotDragStart($event, i)"
              @dragover.stop.prevent="onSlotDragOver(i)"
              @dragleave.stop="onSlotDragLeave(i)"
              @drop.stop.prevent="onSlotDrop(i)"
              @dragend.stop="onSlotDragEnd"
            >
              <div class="sp-pad-label">
                <span class="sp-fkey">F{{ i + 1 }}</span>
                {{ slot.name || (slot.src ? 'Sound ' + (i + 1) : 'Empty') }}
              </div>
              <div class="sp-pad-meta" v-if="slot.src">
                <span class="sp-pad-vol"><Volume2 class="h-3 w-3 inline" /> {{ Math.round((slot.volume ?? 1) * 100) }}%</span>
              </div>
              <button class="sp-pad-edit" @click.stop="openEditor(i)" title="Properties"><Settings2 class="h-3.5 w-3.5" /></button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem v-if="slot.src" @select="onPadClick(slot, i)">
              <Play /> {{ t('ctx.play') }}
            </ContextMenuItem>
            <ContextMenuItem v-if="slot.src" @select="previewSlot(slot)">
              <Headphones /> {{ t('ctx.preview') }}
            </ContextMenuItem>
            <ContextMenuItem @select="openEditor(i)">
              <Settings2 /> {{ t('ctx.edit') }}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem v-if="slot.src" destructive @select="clearSlotAt(i)">
              <Trash2 /> {{ t('ctx.clearSlot') }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <p class="sp-hint muted small">
        F1–F10 = play on stream · Shift+F1–F10 = preview · Esc = Stop all · Click = play · Right-click = menu
      </p>
    </div>

    <!-- SEARCH TAB -->
    <div v-else-if="tab === 'search'" key="search" class="sp-body">
      <!-- Provider selector -->
      <div class="sp-provs">
        <button
          :class="{ active: searchProvider === 'myinstants' }"
          @click="switchProvider('myinstants')"
        >MyInstants</button>
        <button
          :class="{ active: searchProvider === 'uwupad' }"
          @click="switchProvider('uwupad')"
        >UwUpad</button>
      </div>

      <div class="sp-search-bar">
        <input
          v-model="searchQuery"
          class="sp-search-input"
          :placeholder="'Search sounds on ' + (searchProvider === 'uwupad' ? 'UwUpad' : 'MyInstants') + '…'"
          @input="onSearchInput"
          @keydown.enter="runSearch"
        />
        <Button size="sm" variant="secondary" :disabled="searchLoading" @click="runSearch">
          <Search class="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="destructive" title="Stop all sounds" @click="stopAll">
          <Square class="h-3.5 w-3.5" />
        </Button>
      </div>
      <div v-if="searchLoading" class="sp-status">Loading…</div>
      <div v-else-if="searchError" class="sp-error">{{ searchError }}</div>
      <div v-else-if="!searchResults.length && searchQuery" class="sp-status muted">No results.</div>
      <div v-else-if="!searchResults.length" class="sp-status muted">Type to search sounds.</div>
      <div v-else class="sp-search-list">
        <label class="sp-preview-vol muted small">
          Preview vol
          <input type="range" min="0" max="1" step="0.02" v-model.number="previewVol" />
          {{ Math.round(previewVol * 100) }}%
        </label>
        <div
          v-for="r in searchResults"
          :key="r.provider + ':' + r.id"
          class="sp-search-item"
        >
          <span class="sp-search-name" :title="r.name">{{ r.name }}</span>
          <div class="sp-search-actions">
            <Button size="sm" variant="secondary" title="Preview (moderator only)" @click.stop="onSearchPreview(r)">
              <Headphones class="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" title="Play on stream" @click.stop="onSearchClick(r)">
              <Play class="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" :title="isFavorite(r) ? 'Remove from favorites' : 'Add to favorites'" @click.stop="toggleFavorite(r)">
              <Star class="h-3.5 w-3.5" :class="{ filled: isFavorite(r) }" :fill="isFavorite(r) ? 'currentColor' : 'none'" />
            </Button>
            <select
              class="sp-slot-pick"
              @click.stop
              @change="assignToSlot($event, r)"
              title="Assign to pad slot"
            >
              <option value="">Slot…</option>
              <option v-for="i in 10" :key="i" :value="i - 1">Slot {{ i }}</option>
            </select>
          </div>
        </div>
      </div>
      <!-- Pagination controls -->
      <div v-if="searchResults.length" class="sp-pagination">
        <Button size="sm" variant="secondary" @click="prevPage" :disabled="searchPage <= 1">
          <ChevronLeft class="h-3.5 w-3.5" /> Prev
        </Button>
        <span class="sp-page-info muted small">Page {{ searchPage }} of {{ totalPages }} ({{ searchTotal }} sounds)</span>
        <Button size="sm" variant="secondary" @click="nextPage" :disabled="!searchHasMore">
          Next <ChevronRight class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>

    <!-- FAVORITES TAB -->
    <div v-else-if="tab === 'favorites'" key="favorites" class="sp-body">
      <div class="sp-fav-head">
        <span class="muted small">Recent plays & favorites</span>
        <Button size="sm" variant="destructive" title="Stop all sounds" @click="stopAll">
          <Square class="h-3.5 w-3.5" />
        </Button>
      </div>
      <div v-if="!favorites.length && !recentPlays.length" class="sp-status muted">
        No favorites or recent sounds yet. Star a sound in search to add it here.
      </div>
      <div v-if="favorites.length" class="sp-fav-section">
        <div class="sp-fav-title"><Star class="h-3.5 w-3.5 inline" /> Favorites</div>
        <div class="sp-search-list">
          <div v-for="r in favorites" :key="'fav:' + r.url" class="sp-search-item">
            <span class="sp-search-name" :title="r.name">{{ r.name }}</span>
            <div class="sp-search-actions">
              <Button size="sm" variant="secondary" title="Preview" @click.stop="onSearchPreview(r)">
                <Headphones class="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" title="Play on stream" @click.stop="onSearchClick(r)">
                <Play class="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Remove from favorites" @click.stop="removeFavorite(r)">
                <Star class="h-3.5 w-3.5" fill="currentColor" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="recentPlays.length" class="sp-fav-section">
        <div class="sp-fav-title"><Clock class="h-3.5 w-3.5 inline" /> Recent</div>
        <div class="sp-search-list">
          <div v-for="r in recentPlays" :key="'rec:' + r.url" class="sp-search-item">
            <span class="sp-search-name" :title="r.name">{{ r.name }}</span>
            <div class="sp-search-actions">
              <Button size="sm" variant="secondary" title="Preview" @click.stop="onSearchPreview(r)">
                <Headphones class="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" title="Play on stream" @click.stop="onSearchClick(r)">
                <Play class="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" :title="isFavorite(r) ? 'Remove from favorites' : 'Add to favorites'" @click.stop="toggleFavorite(r)">
                <Star class="h-3.5 w-3.5" :fill="isFavorite(r) ? 'currentColor' : 'none'" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- SLOT EDITOR / PROPERTIES (modal overlay within the panel) -->
    <div v-if="editing !== null" class="sp-editor">
      <div class="sp-editor-head">
        <span>Slot {{ editing + 1 }} — Properties</span>
        <Button variant="ghost" size="icon" class="h-7 w-7" @click="closeEditor">
          <X class="h-4 w-4" />
        </Button>
      </div>
      <div class="sp-editor-body">
        <label class="sp-field">
          <span>Name</span>
          <input v-model="editForm.name" placeholder="Sound name…" />
        </label>
        <label class="sp-field">
          <span>URL (direct .mp3 link)</span>
          <input v-model="editForm.src" placeholder="https://… or /uploads/…" />
        </label>
        <div class="sp-field-row">
          <label class="sp-field">
            <span>Volume</span>
            <input type="range" min="0" max="1" step="0.02" v-model.number="editForm.volume" />
            <span class="sp-vol-val">{{ Math.round(editForm.volume * 100) }}%</span>
          </label>
        </div>
        <div class="sp-field-row">
          <label class="sp-field">
            <span>Color</span>
            <input type="color" v-model="editForm.color" />
          </label>
        </div>
        <div class="sp-upload-row">
          <Button size="sm" variant="secondary" :disabled="uploading" @click="pickFile">
            <Upload class="h-3.5 w-3.5" />
            {{ uploading ? 'Uploading…' : 'Upload file' }}
          </Button>
          <input ref="fileInput" type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" hidden @change="onFile" />
        </div>
        <!-- Playback buttons: preview, play on stream, stop -->
        <div class="sp-play-row">
          <Button size="sm" variant="secondary" :disabled="!editForm.src" title="Play for moderator only (no stream)" @click="previewEdit">
            <Headphones class="h-3.5 w-3.5" /> Preview
          </Button>
          <Button size="sm" :disabled="!editForm.src" title="Play on stream + moderator" @click="playOnStream">
            <Play class="h-3.5 w-3.5" /> Play on stream
          </Button>
          <Button size="sm" variant="destructive" title="Stop all sounds" @click="stopEdit">
            <Square class="h-3.5 w-3.5" /> Stop
          </Button>
        </div>
        <!-- Waveform visualization -->
        <div v-if="editForm.src && waveform.length" class="sp-waveform">
          <div
            v-for="(peak, i) in waveform"
            :key="i"
            class="sp-wave-bar"
            :style="{ height: Math.max(2, peak * 100) + '%' }"
          ></div>
        </div>
      </div>
      <div class="sp-editor-foot">
        <Button size="sm" variant="destructive" @click="clearSlot">Clear</Button>
        <Button size="sm" @click="saveSlot">Save</Button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import {
  Volume2, Square, X, Star, Settings2, Search, Play, Headphones,
  ChevronLeft, ChevronRight, Clock, Upload, Trash2
} from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator
} from '@/components/ui/context-menu'

const { t } = useI18n()

const props = defineProps({ open: { type: Boolean, default: false } })
defineEmits(['close'])

const scene = useSceneStore()

const tab = ref('pad')
const previewVol = ref(0.5)
const masterVol = computed(() => typeof scene.settings.soundpadMasterVolume === 'number' ? scene.settings.soundpadMasterVolume : 0.5)
const compressorOn = computed(() => !!scene.settings.soundpadCompressor)
function setMaster(v) {
  scene.updateSettings({ soundpadMasterVolume: Math.round(v * 50) / 50 }) // snap to 2%
}
function setCompressor(on) {
  scene.updateSettings({ soundpadCompressor: !!on })
}
const editing = ref(null)
const editForm = ref({ name: '', src: '', volume: 1, color: '#3b82f6' })
const fileInput = ref(null)
const uploading = ref(false)
const waveform = ref([])

// --- Search state ---
const searchQuery = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
const searchError = ref('')
const searchProvider = ref('myinstants')
let searchTimer = null

// --- Pagination state ---
const searchPage = ref(1)
const searchTotal = ref(0)
const searchHasMore = ref(false)
const PER_PAGE = 20
const totalPages = computed(() => Math.max(1, Math.ceil(searchTotal.value / PER_PAGE)))

// --- Favorites & Recent (localStorage) ---
const favorites = ref([])
const recentPlays = ref([])

function loadFavorites() {
  try { favorites.value = JSON.parse(localStorage.getItem('omo_sound_favorites') || '[]') } catch (_) { favorites.value = [] }
  try { recentPlays.value = JSON.parse(localStorage.getItem('omo_sound_recent') || '[]') } catch (_) { recentPlays.value = [] }
}
function saveFavorites() {
  localStorage.setItem('omo_sound_favorites', JSON.stringify(favorites.value))
}
function saveRecent() {
  localStorage.setItem('omo_sound_recent', JSON.stringify(recentPlays.value))
}
function isFavorite(r) {
  return favorites.value.some(f => f.url === r.url)
}
function toggleFavorite(r) {
  if (isFavorite(r)) {
    favorites.value = favorites.value.filter(f => f.url !== r.url)
  } else {
    favorites.value.unshift({ name: r.name, url: r.url, provider: r.provider })
  }
  saveFavorites()
}
function removeFavorite(r) {
  favorites.value = favorites.value.filter(f => f.url !== r.url)
  saveFavorites()
}
function addRecent(r) {
  // Dedup by URL, move to front, cap at 20.
  recentPlays.value = [{ name: r.name, url: r.url, provider: r.provider }, ...recentPlays.value.filter(x => x.url !== r.url)].slice(0, 20)
  saveRecent()
}

loadFavorites()

function switchProvider(p) {
  searchProvider.value = p
  searchResults.value = []
  searchError.value = ''
  if (searchQuery.value.trim()) runSearch()
}

// --- Pad interactions ---
// LMB click = broadcast to both moderator + OBS.
// Right-click (ПКМ) = reka context menu (Play / Preview / Edit / Clear).
function onPadClick(slot, i) {
  if (!slot || !slot.src) {
    openEditor(i)
    return
  }
  scene.sendSoundPlay({ src: slot.src, volume: slot.volume ?? 1, slotId: i })
}

function previewSlot(slot) {
  if (!slot?.src) return
  scene.previewSound({ src: slot.src, volume: slot.volume ?? 1 })
}

async function clearSlotAt(i) {
  await scene.setSoundpadSlot(i, { name: '', src: '', volume: 1, color: '#3b82f6' })
  if (editing.value === i) closeEditor()
}

function stopAll() {
  scene.stopAllSounds()
}

function onKey(e) {
  if (e.key === 'Escape') stopAll()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('omo-soundpad-edit', onExternalEdit)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('omo-soundpad-edit', onExternalEdit)
})

function onExternalEdit(e) {
  const i = e?.detail?.index
  if (typeof i === 'number') openEditor(i)
}

// --- Drag-and-drop: swap sounds between pad slots ---
const dragFromSlot = ref(null)
const dragOver = ref(null)

function onSlotDragStart(e, i) {
  if (!scene.soundpad[i]?.src) { e.preventDefault(); return }
  dragFromSlot.value = i
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(i))
}

function onSlotDragOver(i) {
  if (dragFromSlot.value === null) return
  dragOver.value = i
}

function onSlotDragLeave(i) {
  if (dragOver.value === i) dragOver.value = null
}

function onSlotDrop(i) {
  dragOver.value = null
  const from = dragFromSlot.value
  dragFromSlot.value = null
  if (from === null || from === i) return
  // Optimistic swap: update local state immediately.
  const a = { ...scene.soundpad[from] }
  const b = { ...scene.soundpad[i] }
  scene.soundpad[from] = b
  scene.soundpad[i] = a
  // Persist to server fire-and-forget (no await — avoids 3s delay
  // from full-scene resync round-trips).
  scene.setSoundpadSlot(from, b)
  scene.setSoundpadSlot(i, a)
}

function onSlotDragEnd() {
  dragFromSlot.value = null
  dragOver.value = null
}

// --- Slot editor ---
function openEditor(i) {
  editing.value = i
  const slot = scene.soundpad[i] || {}
  editForm.value = {
    name: slot.name || '',
    src: slot.src || '',
    volume: slot.volume ?? 1,
    color: slot.color || '#3b82f6'
  }
  loadWaveform(slot.src)
}

async function loadWaveform(src) {
  waveform.value = []
  if (!src) return
  try {
    const r = await fetch('/api/sounds/waveform?url=' + encodeURIComponent(src))
    const data = await r.json()
    if (data.ok) waveform.value = data.peaks || []
  } catch (_) { /* best effort */ }
}

function closeEditor() {
  editing.value = null
}

function previewEdit() {
  if (!editForm.value.src) return
  scene.previewSound({ src: editForm.value.src, volume: editForm.value.volume })
}

// Play the sound being edited on the stream (broadcast to moderator + OBS).
function playOnStream() {
  if (!editForm.value.src) return
  scene.sendSoundPlay({ src: editForm.value.src, volume: editForm.value.volume })
}

// Stop all sounds (both moderator + OBS).
function stopEdit() {
  scene.stopAllSounds()
}

async function saveSlot() {
  const i = editing.value
  if (i === null) return
  await scene.setSoundpadSlot(i, { ...editForm.value })
  closeEditor()
}

async function clearSlot() {
  const i = editing.value
  if (i === null) return
  await scene.setSoundpadSlot(i, { name: '', src: '', volume: 1, color: '#3b82f6' })
  closeEditor()
}

// --- File upload ---
function pickFile() {
  fileInput.value?.click()
}

async function onFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const token = localStorage.getItem('omo_token') || ''
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: fd
    }).then((x) => x.json())
    if (r.ok) {
      editForm.value.src = r.url
      if (!editForm.value.name) editForm.value.name = r.name || ''
    } else {
      searchError.value = r.error || 'Upload failed'
    }
  } catch (err) {
    searchError.value = err.message
  } finally {
    uploading.value = false
    e.target.value = ''
  }
}

// --- Search (MyInstants via server proxy) ---
function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
}

async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q) { searchResults.value = []; searchError.value = ''; searchTotal.value = 0; searchHasMore.value = false; return }
  searchPage.value = 1
  await loadPage(1)
}

async function loadPage(page) {
  const q = searchQuery.value.trim()
  if (!q) return
  searchLoading.value = true
  searchError.value = ''
  try {
    const token = localStorage.getItem('omo_token') || ''
    const r = await fetch(
      '/api/sounds/search?provider=' + searchProvider.value + '&q=' + encodeURIComponent(q) + '&page=' + page,
      { headers: { Authorization: 'Bearer ' + token } }
    ).then((x) => x.json())
    if (r.ok) {
      searchResults.value = r.results || []
      searchTotal.value = r.count || 0
      searchHasMore.value = searchResults.value.length < searchTotal.value && page < totalPages.value
    } else {
      searchResults.value = []
      searchError.value = r.error || 'Search failed'
      searchTotal.value = 0
      searchHasMore.value = false
    }
  } catch (err) {
    searchResults.value = []
    searchError.value = err.message
  } finally {
    searchLoading.value = false
  }
}

function prevPage() {
  if (searchPage.value <= 1) return
  searchPage.value--
  loadPage(searchPage.value)
}

function nextPage() {
  if (!searchHasMore.value) return
  searchPage.value++
  loadPage(searchPage.value)
}

// Preview a search result = moderator only (no broadcast).
function onSearchPreview(r) {
  if (!r || !r.url) return
  scene.previewSound({ src: r.url, volume: previewVol.value })
  addRecent(r)
}

// Click a search result = broadcast play.
function onSearchClick(r) {
  if (!r || !r.url) return
  scene.sendSoundPlay({ src: r.url, volume: 1 })
  addRecent(r)
}

// Assign a search result to a pad slot.
async function assignToSlot(e, r) {
  const slotId = parseInt(e.target.value, 10)
  e.target.value = ''
  if (isNaN(slotId) || slotId < 0 || slotId > 9) return
  await scene.setSoundpadSlot(slotId, {
    name: r.name || '',
    src: r.url || '',
    volume: 1,
    color: r.color || '#3b82f6'
  })
}

// Reset search when panel closes.
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    editing.value = null
    searchQuery.value = ''
    searchResults.value = []
    searchError.value = ''
    searchPage.value = 1
    searchTotal.value = 0
    searchHasMore.value = false
  }
})
</script>

<style scoped>
.sp-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 380px;
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
.sp-master-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px 8px;
  border-bottom: 1px solid var(--fluent-stroke);
  flex-shrink: 0;
}
.sp-master { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); flex: 1; min-width: 0; }
.sp-master input[type="range"] { flex: 1; min-width: 110px; max-width: 160px; }
.sp-comp { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-dim); white-space: nowrap; }
.sp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.sp-title { font-weight: 600; }
.sp-vol-val { min-width: 32px; }
.stop-btn { font-weight: 600; }
.spacer { flex: 1; }
.sp-pad-btn {
  transition: transform .12s ease, box-shadow .12s ease, filter .12s ease;
}
.sp-pad-btn:active:not(.empty) { transform: scale(.96); }
.sp-pad-btn.playing {
  animation: sp-pulse .8s ease infinite;
  box-shadow: 0 0 0 2px var(--ok);
}
@keyframes sp-pulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  .sp-pad-btn, .sp-pad-btn.playing { animation: none; transition: none; }
}
.sp-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
}
.sp-tabs button {
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
.sp-tabs button.active {
  background: var(--panel);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.sp-body {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
}

/* Pad grid */
.sp-pad-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.sp-pad-btn {
  position: relative;
  min-height: 72px;
  border: 2px solid var(--btn-color, #3b82f6);
  border-radius: 10px;
  background: color-mix(in srgb, var(--btn-color, #3b82f6) 15%, var(--bg-3));
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  transition: transform .08s, background .15s;
  user-select: none;
}
.sp-pad-btn:hover {
  background: color-mix(in srgb, var(--btn-color, #3b82f6) 30%, var(--bg-3));
  transform: scale(1.03);
}
.sp-pad-btn:active { transform: scale(0.97); }
.sp-pad-btn.playing {
  animation: sp-pulse 0.6s ease-in-out infinite;
  box-shadow: 0 0 0 3px var(--btn-color, #3b82f6), 0 0 16px var(--btn-color, #3b82f6);
}
@keyframes sp-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--btn-color, #3b82f6), 0 0 8px rgba(59,130,246,.4); }
  50% { box-shadow: 0 0 0 4px var(--btn-color, #3b82f6), 0 0 20px var(--btn-color, #3b82f6); }
}
.sp-pad-btn.empty {
  border-style: dashed;
  border-color: var(--border);
  background: var(--bg);
  color: var(--text-dim);
}
.sp-pad-btn.empty:hover { background: var(--bg-3); }
.sp-pad-btn.drag-over {
  transform: scale(1.05);
  border-style: solid;
  border-width: 3px;
}
.sp-pad-label {
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  word-break: break-word;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.sp-fkey {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text-dim);
  opacity: 0.9;
}
.sp-pad-meta { font-size: 10px; color: var(--text-dim); }
.sp-pad-edit {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: rgba(0,0,0,.3);
  color: var(--text-dim);
  opacity: 0;
  transition: opacity .15s;
}
.sp-pad-btn:hover .sp-pad-edit { opacity: 1; }
.sp-pad-edit:hover { color: var(--text); background: rgba(0,0,0,.5); }

.sp-hint { margin: 10px 0 0; text-align: center; }

/* Search */
.sp-provs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.sp-provs button {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-dim);
  cursor: pointer;
}
.sp-provs button.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
  background: var(--panel);
}
.sp-search-bar { display: flex; gap: 6px; margin-bottom: 10px; }
.sp-fav-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.sp-fav-section { margin-bottom: 14px; }
.sp-fav-title { font-size: 12px; font-weight: 600; color: var(--text-dim); margin-bottom: 6px; }
.sp-search-input { flex: 1; font-size: 13px; }
.sp-search-list { display: flex; flex-direction: column; gap: 4px; }
.sp-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 10px 0 4px;
}
.sp-page-info { white-space: nowrap; }
.sp-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  cursor: pointer;
  transition: background .12s;
}
.sp-search-item:hover { background: var(--hover); }
.sp-search-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-search-actions { display: flex; gap: 4px; align-items: center; }
.sp-slot-pick {
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 4px;
  max-width: 70px;
}

/* Slot editor overlay */
.sp-editor {
  border-top: 2px solid var(--accent);
  background: var(--bg-2);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sp-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}
.sp-editor-body { display: flex; flex-direction: column; gap: 8px; }
.sp-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-dim);
}
.sp-field input[type="text"],
.sp-field input:not([type]) {
  font-size: 12px;
}
.sp-field-row { display: flex; gap: 10px; }
.sp-field-row .sp-field { flex: 1; }
.sp-field input[type="range"] { flex: 1; }
.sp-vol-val { font-size: 11px; min-width: 36px; }
.sp-upload-row { display: flex; gap: 8px; align-items: center; }
.sp-play-row { display: flex; gap: 8px; align-items: center; }
.sp-play-row :deep(button) { flex: 1; }
.sp-waveform {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 40px;
  padding: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.sp-wave-bar {
  flex: 1;
  background: var(--accent);
  border-radius: 1px;
  min-height: 2px;
}
.sp-editor-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.sp-status { text-align: center; padding: 20px; font-size: 13px; color: var(--text-dim); }
.sp-error { color: var(--danger); font-size: 12px; padding: 8px; text-align: center; }
</style>
