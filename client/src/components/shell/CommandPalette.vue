<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import {
  Undo2, Redo2, Save, Clapperboard, Settings, LayoutTemplate, Trash2,
  Volume2, Sticker, Type, Moon, Search, AlarmClock, Hash, Star, BookOpen, GraduationCap
} from '@lucide/vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from 'reka-ui'
import { useSceneStore } from '@/stores/scene.js'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'

const props = defineProps({
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['update:open', 'action'])

const scene = useSceneStore()
const { t } = useI18n()
const query = ref('')
const activeIdx = ref(0)
const inputEl = ref(null)

const FAV_KEY = 'omo_palette_favorites'
const favorites = ref([])
try {
  favorites.value = JSON.parse(localStorage.getItem(FAV_KEY) || '[]') || []
} catch (_) {
  favorites.value = []
}
function isFavorite(id) {
  return favorites.value.includes(id)
}
function toggleFavorite(id) {
  if (isFavorite(id)) favorites.value = favorites.value.filter((x) => x !== id)
  else favorites.value = [...favorites.value, id]
  localStorage.setItem(FAV_KEY, JSON.stringify(favorites.value))
}

const commands = computed(() => [
  { id: 'undo', label: t('palette.undo'), icon: Undo2, run: () => scene.undo(), keywords: 'undo ctrl z' },
  { id: 'redo', label: t('palette.redo'), icon: Redo2, run: () => scene.redo(), keywords: 'redo ctrl y' },
  { id: 'save', label: t('palette.save'), icon: Save, run: () => scene.forceSave(), keywords: 'save ctrl s' },
  { id: 'perform', label: t('palette.perform'), icon: Clapperboard, run: () => scene.togglePerformMode(), keywords: 'perform presentation' },
  { id: 'theme', label: t('palette.theme'), icon: Moon, run: () => scene.updateSettings({ theme: scene.settings.theme === 'dark' ? 'light' : 'dark' }), keywords: 'theme dark light' },
  { id: 'add-text', label: t('palette.addText'), icon: Type, run: () => scene.addLayer({ type: 'text' }), keywords: 'text layer add' },
  { id: 'add-timer', label: t('palette.addTimer'), icon: AlarmClock, run: () => scene.addLayer({ type: 'timer', timerSeconds: 300 }), keywords: 'timer countdown add' },
  { id: 'add-counter', label: t('palette.addCounter'), icon: Hash, run: () => scene.addLayer({ type: 'counter', counterValue: 0 }), keywords: 'counter score add' },
  { id: 'settings', label: t('palette.settings'), icon: Settings, run: () => emit('action', 'settings'), keywords: 'settings preferences' },
  { id: 'help', label: t('palette.help'), icon: BookOpen, run: () => emit('action', 'help'), keywords: 'help handbook guide faq справка' },
  { id: 'tour', label: t('palette.tour'), icon: GraduationCap, run: () => emit('action', 'tour'), keywords: 'tour tutorial onboarding обучение' },
  { id: 'presets', label: t('palette.presets'), icon: LayoutTemplate, run: () => emit('action', 'presets'), keywords: 'presets' },
  { id: 'trash', label: t('palette.trash'), icon: Trash2, run: () => emit('action', 'trash'), keywords: 'trash delete' },
  { id: 'soundpad', label: t('palette.soundpad'), icon: Volume2, run: () => emit('action', 'soundpad'), keywords: 'sound pad' },
  { id: 'stickers', label: t('palette.stickers'), icon: Sticker, run: () => emit('action', 'stickers'), keywords: 'emotes stickers' }
])

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  let list = commands.value
  if (q) {
    list = list.filter((c) =>
      c.label.toLowerCase().includes(q) || (c.keywords || '').includes(q) || c.id.includes(q)
    )
  }
  // Favorites float to top
  return [...list].sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)))
})

watch(() => props.open, async (v) => {
  if (v) {
    query.value = ''
    activeIdx.value = 0
    await nextTick()
    inputEl.value?.focus?.()
  }
})

watch(filtered, () => { activeIdx.value = 0 })

function close() { emit('update:open', false) }

function run(cmd) {
  if (!cmd) return
  close()
  cmd.run()
}

function onKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(filtered.value.length - 1, activeIdx.value + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(0, activeIdx.value - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    run(filtered.value[activeIdx.value])
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[240] bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogContent
        class="fixed left-1/2 top-[18%] z-[250] w-[min(520px,92vw)] -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] shadow-[var(--fluent-elevation)] backdrop-blur-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        @keydown="onKey"
      >
        <DialogTitle class="sr-only">{{ t('cmd.palette') }}</DialogTitle>
        <div class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <Search class="h-4 w-4 shrink-0 text-[var(--text-dim)]" />
          <input
            ref="inputEl"
            v-model="query"
            class="h-9 w-full border-0 bg-transparent text-sm outline-none placeholder:text-[var(--text-dim)]"
            :placeholder="t('cmd.palette.placeholder')"
          />
          <kbd class="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">Esc</kbd>
        </div>
        <ul class="max-h-[320px] overflow-y-auto p-1 list-stagger" role="listbox">
          <ContextMenu v-for="(cmd, i) in filtered" :key="cmd.id">
            <ContextMenuTrigger as-child>
              <li
                role="option"
                :aria-selected="i === activeIdx"
                :class="cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                  i === activeIdx && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]'
                )"
                @mouseenter="activeIdx = i"
                @click="run(cmd)"
              >
                <component :is="cmd.icon" class="h-4 w-4 shrink-0" />
                <span class="flex-1">{{ cmd.label }}</span>
                <Star v-if="isFavorite(cmd.id)" class="h-3.5 w-3.5 text-[var(--fluent-accent)]" fill="currentColor" />
              </li>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="run(cmd)">{{ cmd.label }}</ContextMenuItem>
              <ContextMenuItem @select="toggleFavorite(cmd.id)">
                <Star /> {{ isFavorite(cmd.id) ? t('ctx.unpin') : t('ctx.pin') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <li v-if="!filtered.length" class="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
            {{ t('cmd.palette.empty') }}
          </li>
        </ul>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
