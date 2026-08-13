<!--
  AppCommandBar — Fluent CommandBar: Media + View + global actions.
  Tools/Panels live in AppNavigation. Media add logic ported from Toolbar.vue.
-->
<script setup>
import { ref, computed, reactive, inject, nextTick } from 'vue'
import {
  Plus, Type, Globe, MessageCircle, Megaphone, Timer, Hash, AlarmClock, Grid3x3,
  Magnet, Crosshair, MoveHorizontal, Ruler, Scan, Undo2, Redo2,
  Clapperboard, Sun, Moon, Save, Trash2, Eye, Search, CircleHelp
} from '@lucide/vue'
import { useSceneStore } from '@/stores/scene.js'
import { createBrowserLayerFromChatis, defaultBrowserConfig, defaultMultiBrowserConfig } from '@shared/schema.js'
import Modal from '@/components/ui/Modal.vue'
import ChatisConfigModal from '@/components/editor/ChatisConfigModal.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator as CtxSeparator
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

defineProps({
  showInspectorToggle: { type: Boolean, default: false },
  inspectorOpen: { type: Boolean, default: false }
})
defineEmits(['toggle-inspector', 'open-palette', 'open-help'])

const scene = useSceneStore()
const { t } = useI18n()
const dnd = inject('dnd')
const fileInput = ref(null)
const urlInput = ref('')
const saveDone = ref(false)
const saveBusy = ref(false)
let saveTimer = null

const promptOpen = ref(false)
const promptValue = ref('')
const promptInputEl = ref(null)
const browserForm = reactive({ width: 800, height: 600 })
const chatisOpen = ref(false)
const chatisDefaultChannel = computed(
  () => scene.settings.twitchChannel || localStorage.getItem('omo_twitch_channel') || ''
)
const multiOpen = ref(false)
const multiUrlsText = ref('')
const multiInputEl = ref(null)
const multiForm = reactive({ width: 800, height: 600, queueEnabled: true })
const tempOpen = ref(false)
const tempForm = reactive({ type: 'text', ttl: 30 })
const TTL_PRESETS = [10, 30, 60, 120, 0]

const s = computed(() => scene.settings)

async function openBrowserPrompt() {
  promptValue.value = 'https://'
  browserForm.width = 800
  browserForm.height = 600
  promptOpen.value = true
  await nextTick()
  promptInputEl.value?.focus?.()
  promptInputEl.value?.select?.()
}

async function commitBrowserPrompt() {
  const raw = String(promptValue.value || '').trim()
  promptOpen.value = false
  if (!/^https?:\/\//i.test(raw) || raw === 'https://' || raw === 'http://') return
  const w = Math.max(50, Number(browserForm.width) || 800)
  const h = Math.max(50, Number(browserForm.height) || 600)
  await scene.addLayer({
    type: 'browser',
    name: 'Browser Source',
    browser: defaultBrowserConfig({ url: raw, width: w, height: h, controlAudioViaObs: false }),
    transform: { x: 560, y: 240, w, h, rotation: 0, opacity: 1, flipH: false, flipV: false },
    maintainRatio: false
  })
}

async function commitChatis(cfg) {
  chatisOpen.value = false
  await scene.addLayer(createBrowserLayerFromChatis(cfg))
}

async function addText() { await scene.addLayer({ type: 'text' }) }
async function addTimer() { await scene.addLayer({ type: 'timer', timerSeconds: 300 }) }
async function addCounter() { await scene.addLayer({ type: 'counter', counterValue: 0 }) }
async function addChatis() { chatisOpen.value = true }
async function addMultiAlerts() {
  multiUrlsText.value = ''
  multiForm.width = 800
  multiForm.height = 600
  multiForm.queueEnabled = true
  multiOpen.value = true
  await nextTick()
  multiInputEl.value?.focus?.()
}

async function commitMultiPrompt() {
  const urls = String(multiUrlsText.value || '')
    .split(/\r?\n/).map((s) => s.trim()).filter((u) => /^https?:\/\//i.test(u))
  multiOpen.value = false
  if (!urls.length) return
  const w = Math.max(50, Number(multiForm.width) || 800)
  const h = Math.max(50, Number(multiForm.height) || 600)
  await scene.addLayer({
    type: 'multiBrowser',
    name: 'Multi Browser Source',
    multiBrowser: defaultMultiBrowserConfig({ urls, width: w, height: h, queueEnabled: !!multiForm.queueEnabled }),
    transform: { x: 560, y: 240, w, h, rotation: 0, opacity: 1, flipH: false, flipV: false },
    maintainRatio: false
  })
}

function addTemporary() {
  tempForm.type = 'text'
  tempForm.ttl = 30
  tempOpen.value = true
}
async function commitTemporary() {
  tempOpen.value = false
  await scene.addTemporaryLayer({ type: tempForm.type }, Math.max(0, Math.floor(tempForm.ttl || 0)))
}

function pickFiles() { fileInput.value?.click() }
async function onFiles(e) {
  await dnd.addFilesFromInput(Array.from(e.target.files || []))
  e.target.value = ''
}
function addFromUrl() {
  const url = urlInput.value.trim()
  if (!url) return
  dnd.addUrl(url)
  urlInput.value = ''
}
function cycleTheme() {
  themeFlash.value = true
  scene.updateSettings({ theme: s.value.theme === 'dark' ? 'light' : 'dark' })
  clearTimeout(themeFlashTimer)
  themeFlashTimer = setTimeout(() => { themeFlash.value = false }, 180)
}

const themeFlash = ref(false)
let themeFlashTimer = null

async function onSave() {
  if (saveBusy.value) return
  saveBusy.value = true
  try {
    const res = await scene.forceSave()
    if (res?.ok) {
      saveDone.value = true
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => (saveDone.value = false), 1500)
    }
  } finally {
    saveBusy.value = false
  }
}

async function clearAll() {
  if (!confirm('Move all layers to trash? You can restore them later.')) return
  await scene.clearWorkspace()
}
</script>

<template>
  <header
    role="banner"
    aria-label="Command bar"
    :class="cn(
      'relative flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] px-3 backdrop-blur-md'
    )"
    data-tour="cmdbar"
    :style="{ minHeight: 'var(--shell-command-h)' }"
  >
    <div class="flex items-center gap-2 pr-1">
      <span
        class="h-2.5 w-2.5 rounded-full"
        :class="scene.connected ? 'bg-[var(--ok)] shadow-[0_0_6px_var(--ok)]' : 'bg-[var(--danger)]'"
      />
      <span class="text-sm font-semibold">OBS Overlay</span>
      <span v-if="scene.connected" class="hidden text-xs text-[var(--text-dim)] sm:inline">
        {{ scene.layers.length }} layers
      </span>
    </div>

    <Separator orientation="vertical" class="mx-1 hidden h-6 sm:block" />

    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="inline-flex">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="secondary" size="sm" class="gap-1.5">
                <Plus class="h-4 w-4" /> {{ t('cmd.media') }}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-72">
              <DropdownMenuItem @select="pickFiles">
                <Plus class="h-4 w-4" /> {{ t('cmd.addMedia') }}
              </DropdownMenuItem>
              <input ref="fileInput" type="file" multiple accept="image/*,video/*,audio/*,.gif,.svg" hidden @change="onFiles" />
              <DropdownMenuSeparator />
              <div class="flex gap-1.5 px-2 py-1.5" @click.stop>
                <Input v-model="urlInput" class="h-7 text-xs" :placeholder="t('cmd.urlPlaceholder')" @keydown.enter="addFromUrl" />
                <Button size="sm" class="h-7" @click="addFromUrl">{{ t('cmd.addUrl') }}</Button>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="addText"><Type class="h-4 w-4" /> {{ t('cmd.textLayer') }}</DropdownMenuItem>
              <DropdownMenuItem @select="addTimer"><AlarmClock class="h-4 w-4" /> {{ t('cmd.addTimer') }}</DropdownMenuItem>
              <DropdownMenuItem @select="addCounter"><Hash class="h-4 w-4" /> {{ t('cmd.addCounter') }}</DropdownMenuItem>
              <DropdownMenuItem @select="openBrowserPrompt"><Globe class="h-4 w-4" /> {{ t('cmd.browserSource') }}</DropdownMenuItem>
              <DropdownMenuItem @select="addChatis"><MessageCircle class="h-4 w-4" /> {{ t('cmd.chatis') }}</DropdownMenuItem>
              <DropdownMenuItem @select="addMultiAlerts"><Megaphone class="h-4 w-4" /> {{ t('cmd.multiBrowser') }}</DropdownMenuItem>
              <DropdownMenuItem class="text-[#fca5a5]" @select="addTemporary"><Timer class="h-4 w-4" /> {{ t('cmd.temporaryLayer') }}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem @select="pickFiles"><Plus /> {{ t('cmd.addMedia') }}</ContextMenuItem>
        <ContextMenuItem @select="addText"><Type /> {{ t('ctx.addText') }}</ContextMenuItem>
        <CtxSeparator />
        <ContextMenuItem @select="addTimer"><AlarmClock /> {{ t('cmd.addTimer') }}</ContextMenuItem>
        <ContextMenuItem @select="addCounter"><Hash /> {{ t('cmd.addCounter') }}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="secondary" size="sm" class="gap-1.5">
          <Eye class="h-4 w-4" /> {{ t('cmd.view') }}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem :checked="s.gridEnabled" @update:checked="(v) => scene.updateSettings({ gridEnabled: !!v })">
          <Grid3x3 class="h-4 w-4" /> {{ t('view.grid') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.snapToGrid" @update:checked="(v) => scene.updateSettings({ snapToGrid: !!v })">
          <Magnet class="h-4 w-4" /> {{ t('view.snapGrid') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.snapToCenter" @update:checked="(v) => scene.updateSettings({ snapToCenter: !!v })">
          <Crosshair class="h-4 w-4" /> {{ t('view.snapCenter') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.snapToEdges" @update:checked="(v) => scene.updateSettings({ snapToEdges: !!v })">
          <MoveHorizontal class="h-4 w-4" /> {{ t('view.snapEdges') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem :checked="s.showDistances" @update:checked="(v) => scene.updateSettings({ showDistances: !!v })">
          {{ t('view.distances') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.showEdgePixels" @update:checked="(v) => scene.updateSettings({ showEdgePixels: !!v })">
          {{ t('view.edgePixels') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.showRulers" @update:checked="(v) => scene.updateSettings({ showRulers: !!v })">
          <Ruler class="h-4 w-4" /> {{ t('view.rulers') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.showSafeArea" @update:checked="(v) => scene.updateSettings({ showSafeArea: !!v })">
          <Scan class="h-4 w-4" /> {{ t('view.safeArea') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.showOffstageHatch !== false" @update:checked="(v) => scene.updateSettings({ showOffstageHatch: !!v })">
          {{ t('view.offstageHatch') }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem :checked="s.showObsBounds" @update:checked="(v) => scene.updateSettings({ showObsBounds: !!v })">
          {{ t('view.obsBounds') }}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Button
      v-if="showInspectorToggle"
      variant="secondary"
      size="sm"
      :class="inspectorOpen && 'bg-[var(--fluent-reveal)]'"
      @click="$emit('toggle-inspector')"
    >
      {{ t('cmd.inspectorBtn') }}
    </Button>

    <div class="ml-auto flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        data-tour="help"
        :title="t('cmd.help') + ' (Ctrl+Shift+/)'"
        :aria-label="t('cmd.help')"
        @click="$emit('open-help')"
      >
        <CircleHelp class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :title="t('cmd.palette') + ' (Ctrl+K)'"
        :aria-label="t('cmd.palette')"
        @click="$emit('open-palette')"
      >
        <Search class="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" :disabled="!scene.canUndo" title="Undo (Ctrl+Z)" @click="scene.undo()">
        <Undo2 class="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" :disabled="!scene.canRedo" title="Redo (Ctrl+Y)" @click="scene.redo()">
        <Redo2 class="h-4 w-4" />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        class="gap-1.5"
        :class="scene.performMode && 'bg-[var(--fluent-accent)] text-white hover:bg-[var(--fluent-accent-hover)]'"
        title="Perform mode (Esc to exit)"
        aria-pressed="false"
        @click="scene.togglePerformMode()"
      >
        <Clapperboard class="h-4 w-4" />
        {{ scene.performMode ? t('cmd.edit') : t('cmd.perform') }}
      </Button>
      <Button variant="ghost" size="icon" :title="'Theme: ' + s.theme" :aria-label="'Theme: ' + s.theme" @click="cycleTheme">
        <Moon v-if="s.theme === 'dark'" class="h-4 w-4" />
        <Sun v-else class="h-4 w-4" />
      </Button>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <Button variant="secondary" size="sm" class="gap-1.5" :disabled="saveBusy" @click="onSave">
            <Save class="h-4 w-4" />
            {{ saveDone ? t('cmd.saved') : t('cmd.save') }}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @select="onSave"><Save /> {{ t('ctx.save') }}</ContextMenuItem>
          <ContextMenuItem :disabled="!scene.canUndo" @select="scene.undo()"><Undo2 /> {{ t('ctx.undo') }}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <Button variant="destructive" size="sm" class="gap-1.5" :disabled="!scene.layers.length" @click="clearAll">
            <Trash2 class="h-4 w-4" /> {{ t('cmd.clear') }}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem destructive @select="clearAll"><Trash2 /> {{ t('ctx.clearScene') }}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>

    <Transition name="theme-fade">
      <div v-if="themeFlash" class="theme-flash-overlay" aria-hidden="true" />
    </Transition>

    <div
      v-if="dnd.dragOver.value"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[var(--fluent-accent)] bg-[color-mix(in_srgb,var(--fluent-accent)_18%,transparent)] font-semibold"
    >
      {{ t('dnd.drop') }}
    </div>

    <Modal
      :open="tempOpen"
      :title="t('cmd.tempModalTitle')"
      :confirm-label="t('cmd.tempModalConfirm')"
      :confirm-class="tempForm.ttl > 0 ? 'primary' : 'danger'"
      @confirm="commitTemporary"
      @cancel="tempOpen = false"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-xs">{{ t('cmd.tempType') }}
          <select v-model="tempForm.type">
            <option value="text">{{ t('cmd.tempTypeText') }}</option>
            <option value="image">{{ t('cmd.tempTypeImage') }}</option>
          </select>
        </label>
        <div class="flex flex-wrap gap-1.5">
          <Button
            v-for="p in TTL_PRESETS"
            :key="p"
            size="sm"
            :variant="tempForm.ttl === p ? 'default' : 'secondary'"
            @click="tempForm.ttl = p"
          >{{ p > 0 ? p + 's' : t('cmd.tempNoLimit') }}</Button>
        </div>
        <label class="flex flex-col gap-1 text-xs">{{ t('cmd.tempCustomTtl') }}
          <input type="number" min="0" step="1" v-model.number="tempForm.ttl" />
        </label>
      </div>
    </Modal>

    <Modal
      :open="promptOpen"
      title="Browser Source"
      confirm-label="Add"
      confirm-class="primary"
      @confirm="commitBrowserPrompt"
      @cancel="promptOpen = false"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-xs">URL (https://…)
          <input ref="promptInputEl" v-model="promptValue" @keydown.enter.prevent="commitBrowserPrompt" />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-xs">Width
            <input type="number" min="50" max="1920" v-model.number="browserForm.width" />
          </label>
          <label class="flex flex-col gap-1 text-xs">Height
            <input type="number" min="50" max="1080" v-model.number="browserForm.height" />
          </label>
        </div>
      </div>
    </Modal>

    <ChatisConfigModal
      :open="chatisOpen"
      :default-channel="chatisDefaultChannel"
      @cancel="chatisOpen = false"
      @confirm="commitChatis"
    />

    <Modal
      :open="multiOpen"
      title="Multi Browser Source"
      confirm-label="Add"
      confirm-class="primary"
      @confirm="commitMultiPrompt"
      @cancel="multiOpen = false"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-xs">URLs (one per line)
          <textarea
            ref="multiInputEl"
            v-model="multiUrlsText"
            rows="6"
            placeholder="https://…"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1 text-xs">Width
            <input type="number" min="50" max="1920" v-model.number="multiForm.width" />
          </label>
          <label class="flex flex-col gap-1 text-xs">Height
            <input type="number" min="50" max="1080" v-model.number="multiForm.height" />
          </label>
        </div>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" v-model="multiForm.queueEnabled" />
          Queue overlapping alerts (one source at a time)
        </label>
      </div>
    </Modal>

    <Modal
      :open="dnd.preloadOpen.value"
      title="Large media — preload first?"
      :confirm-label="'Upload ' + dnd.humanSize(dnd.preloadTotal.value) + ' now'"
      confirm-class="primary"
      cancel-label="Skip these"
      @confirm="dnd.confirmPreload()"
      @cancel="dnd.cancelPreload()"
    >
      <div class="flex flex-col gap-2.5">
        <p class="m-0">
          You're about to upload <strong>{{ dnd.preloadPending.value.length }}</strong>
          file(s) totalling <strong>{{ dnd.humanSize(dnd.preloadTotal.value) }}</strong>.
        </p>
        <ul class="m-0 max-h-35 list-none overflow-y-auto rounded-md border border-[var(--border)] p-0">
          <li
            v-for="(f, i) in dnd.preloadPending.value"
            :key="i"
            class="flex justify-between gap-3 border-b border-[var(--border)] px-2.5 py-1.5 text-xs last:border-0"
          >
            <span class="truncate">{{ f.name }}</span>
            <span class="shrink-0 text-[var(--text-dim)]">{{ dnd.humanSize(f.size) }}</span>
          </li>
        </ul>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" v-model="dnd.dontAskPreload.value" />
          Don't warn me again this session
        </label>
      </div>
    </Modal>
  </header>
</template>
