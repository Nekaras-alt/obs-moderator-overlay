<script setup>
import { computed } from 'vue'
import {
  Layers, PanelLeftClose, PanelLeft, Sticker, Volume2, MessageSquare,
  LayoutPanelLeft, Tv, ClipboardPaste, Bot, Music2, HeartHandshake,
  LayoutTemplate, Trash2, Monitor, Eye, Settings, Pin
} from '@lucide/vue'
import LayersPanel from '@/components/editor/LayersPanel.vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem
} from '@/components/ui/context-menu'
import { useSceneStore } from '@/stores/scene.js'
import { useUiPrefs } from '@/features/uiPrefs.js'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const props = defineProps({
  panels: { type: Object, default: () => ({}) },
  streamOpen: { type: Boolean, default: false },
  dockOpen: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
  wide: { type: Boolean, default: false },
  widthPx: { type: Number, default: 0 },
  toolsOnly: { type: Boolean, default: false },
  toolsInDock: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle-panel', 'update:collapsed'])

const scene = useSceneStore()
const { t } = useI18n()
const { isPinned, togglePinned, isPanelEnabled } = useUiPrefs()
const trashCount = computed(() => scene.trash.length)
const navWidth = computed(() => {
  if (props.widthPx) return props.widthPx + 'px'
  if (props.collapsed) return '56px'
  return props.wide ? '280px' : '240px'
})

const allTools = computed(() => [
  { id: 'stickers', label: t('panel.stickers'), icon: Sticker },
  { id: 'soundpad', label: t('panel.soundpad'), icon: Volume2 },
  { id: 'twitch', label: t('panel.twitch'), icon: MessageSquare },
  { id: 'dock', label: t('panel.dock'), icon: LayoutPanelLeft },
  { id: 'stream', label: t('panel.stream'), icon: Tv },
  { id: 'pastes', label: t('panel.pastes'), icon: ClipboardPaste },
  { id: 'jeetbot', label: t('panel.jeetbot'), icon: Bot },
  { id: 'spotify', label: t('panel.spotify'), icon: Music2 },
  { id: 'donations', label: t('panel.donations'), icon: HeartHandshake }
])

const tools = computed(() => allTools.value.filter((item) => isPanelEnabled(item.id)))

const overlayPanels = computed(() => [
  { id: 'presets', label: t('panel.presets'), icon: LayoutTemplate },
  { id: 'trash', label: t('panel.trash'), icon: Trash2 },
  { id: 'obs', label: t('panel.obsSources'), icon: Monitor },
  { id: 'obsPreview', label: t('panel.obsPreview'), icon: Eye },
  { id: 'settings', label: t('panel.settings'), icon: Settings }
])

function isActive(id) {
  if (id === 'stream') return props.streamOpen
  if (id === 'dock') return props.dockOpen
  return !!props.panels[id]
}

const itemH = 'h-[var(--shell-nav-item-h)]'
</script>

<template>
  <nav
    :class="cn(
      'flex min-h-0 flex-col border-r border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] backdrop-blur-md transition-[width] duration-200',
      toolsOnly && 'border-r-0 h-full w-full border-0 bg-transparent'
    )"
    :style="toolsOnly ? undefined : { width: navWidth }"
    :aria-label="toolsOnly ? 'Tools dock' : 'Navigation'"
  >
    <template v-if="!toolsOnly">
      <div
        class="flex items-center gap-2 border-b border-[var(--border)] px-2"
        :style="{ height: 'var(--shell-nav-head-h)' }"
      >
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          :title="collapsed ? t('nav.expand') : t('nav.collapse')"
          :aria-expanded="!collapsed"
          aria-controls="nav-layers-panel"
          @click="emit('update:collapsed', !collapsed)"
        >
          <PanelLeft v-if="collapsed" class="h-4 w-4" />
          <PanelLeftClose v-else class="h-4 w-4" />
        </Button>
        <div v-if="!collapsed" class="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold">
          <Layers class="h-4 w-4 shrink-0 text-[var(--fluent-accent)]" aria-hidden="true" />
          <span class="truncate">{{ t('nav.layers') }}</span>
          <Badge variant="secondary" class="ml-auto">{{ scene.layers.length }}</Badge>
        </div>
      </div>

      <div
        v-show="!collapsed"
        id="nav-layers-panel"
        data-tour="layers"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div class="min-h-0 flex-[1.4] overflow-hidden border-b border-[var(--border)] [&_.layers]:h-full [&_.layers]:border-0 [&_.layers]:bg-transparent [&_.layers_.head]:hidden">
          <LayersPanel />
        </div>

        <div v-if="!toolsInDock" class="shrink-0 overflow-y-auto p-2" data-tour="tools">
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]" id="nav-tools-label">{{ t('nav.tools') }}</p>
          <ContextMenu v-for="item in tools" :key="item.id">
            <ContextMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                :class="cn('mb-0.5 w-full justify-start gap-2 nav-press', itemH, isActive(item.id) && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]')"
                :aria-pressed="isActive(item.id)"
                @click="emit('toggle-panel', item.id)"
              >
                <component :is="item.icon" class="h-4 w-4" aria-hidden="true" />
                <span class="truncate">{{ item.label }}</span>
                <button
                  type="button"
                  class="ml-auto inline-flex h-5 w-5 items-center justify-center rounded opacity-40 hover:opacity-100"
                  :class="isPinned(item.id) && 'opacity-100 text-[var(--fluent-accent)]'"
                  :title="isPinned(item.id) ? 'Unpin panel' : 'Pin panel'"
                  :aria-label="(isPinned(item.id) ? 'Unpin ' : 'Pin ') + item.label"
                  @click.stop="togglePinned(item.id)"
                >
                  <Pin class="h-3 w-3" />
                </button>
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="emit('toggle-panel', item.id)">
                {{ isActive(item.id) ? t('ctx.close') : t('ctx.open') }}
              </ContextMenuItem>
              <ContextMenuItem @select="togglePinned(item.id)">
                <Pin /> {{ isPinned(item.id) ? t('ctx.unpin') : t('ctx.pin') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <Separator class="my-2" />
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">{{ t('nav.panels') }}</p>
          <ContextMenu v-for="item in overlayPanels" :key="item.id">
            <ContextMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                :class="cn('mb-0.5 w-full justify-start gap-2 nav-press', itemH, isActive(item.id) && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]')"
                :aria-pressed="isActive(item.id)"
                @click="emit('toggle-panel', item.id)"
              >
                <component :is="item.icon" class="h-4 w-4" aria-hidden="true" />
                <span class="truncate">{{ item.label }}</span>
                <Badge v-if="item.id === 'trash' && trashCount" variant="secondary" class="ml-auto">{{ trashCount }}</Badge>
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="emit('toggle-panel', item.id)">
                {{ isActive(item.id) ? t('ctx.close') : t('ctx.open') }}
              </ContextMenuItem>
              <ContextMenuItem @select="togglePinned(item.id)">
                <Pin /> {{ isPinned(item.id) ? t('ctx.unpin') : t('ctx.pin') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
        <div v-else class="shrink-0 overflow-y-auto p-2">
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">{{ t('nav.panels') }}</p>
          <ContextMenu v-for="item in overlayPanels" :key="item.id">
            <ContextMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                :class="cn('mb-0.5 w-full justify-start gap-2 nav-press', itemH, isActive(item.id) && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]')"
                :aria-pressed="isActive(item.id)"
                @click="emit('toggle-panel', item.id)"
              >
                <component :is="item.icon" class="h-4 w-4" aria-hidden="true" />
                <span class="truncate">{{ item.label }}</span>
                <Badge v-if="item.id === 'trash' && trashCount" variant="secondary" class="ml-auto">{{ trashCount }}</Badge>
              </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem @select="emit('toggle-panel', item.id)">
                {{ isActive(item.id) ? t('ctx.close') : t('ctx.open') }}
              </ContextMenuItem>
              <ContextMenuItem @select="togglePinned(item.id)">
                <Pin /> {{ isPinned(item.id) ? t('ctx.unpin') : t('ctx.pin') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
      </div>

      <div v-show="collapsed" class="flex flex-1 flex-col items-center gap-1 overflow-y-auto p-1.5" role="toolbar" aria-label="Collapsed tools">
        <ContextMenu v-for="item in [...tools, ...overlayPanels]" :key="item.id">
          <ContextMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-9 w-9"
              :class="isActive(item.id) && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]'"
              :title="item.label"
              :aria-label="item.label"
              :aria-pressed="isActive(item.id)"
              @click="emit('toggle-panel', item.id)"
            >
              <component :is="item.icon" class="h-4 w-4" />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem @select="emit('toggle-panel', item.id)">
              {{ isActive(item.id) ? t('ctx.close') : t('ctx.open') }}
            </ContextMenuItem>
            <ContextMenuItem @select="togglePinned(item.id)">
              <Pin /> {{ isPinned(item.id) ? t('ctx.unpin') : t('ctx.pin') }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </template>

    <!-- Tools-only dock column -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <ContextMenu v-for="item in tools" :key="item.id">
        <ContextMenuTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            :class="cn('mb-0.5 w-full justify-start gap-2 nav-press', itemH, isActive(item.id) && 'bg-[var(--fluent-reveal)] text-[var(--fluent-accent)]')"
            :aria-pressed="isActive(item.id)"
            @click="emit('toggle-panel', item.id)"
          >
            <component :is="item.icon" class="h-4 w-4" aria-hidden="true" />
            <span class="truncate">{{ item.label }}</span>
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @select="emit('toggle-panel', item.id)">
            {{ isActive(item.id) ? t('ctx.close') : t('ctx.open') }}
          </ContextMenuItem>
          <ContextMenuItem @select="togglePinned(item.id)">
            <Pin /> {{ isPinned(item.id) ? t('ctx.unpin') : t('ctx.pin') }}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </nav>
</template>
