<script setup>
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { Clapperboard, Square, BellRing, MessageSquare, Play, Pencil } from '@lucide/vue'
import AppCommandBar from './AppCommandBar.vue'
import AppNavigation from './AppNavigation.vue'
import AppInspector from './AppInspector.vue'
import AppStatusBar from './AppStatusBar.vue'
import { Sheet } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useSceneStore } from '@/stores/scene.js'
import { useUiPrefs } from '@/features/uiPrefs.js'
import { useI18n } from '@/i18n'

const props = defineProps({
  panels: { type: Object, default: () => ({}) },
  streamOpen: { type: Boolean, default: false },
  dockOpen: { type: Boolean, default: false },
  navCollapsed: { type: Boolean, default: false },
  inspectorSheetOpen: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle-panel', 'update:navCollapsed', 'update:inspectorSheetOpen', 'toggle-inspector', 'open-palette', 'open-settings', 'open-help'])

const scene = useSceneStore()
const { t } = useI18n()
const { prefs, densityClass } = useUiPrefs()
const isNarrow = useMediaQuery('(max-width: 1279px)')
const isWide = useMediaQuery('(min-width: 1601px)')
const isUltrawide = useMediaQuery('(min-width: 2560px)')

const showToolsDock = computed(() =>
  !!prefs.toolsDock && (isUltrawide.value || isWide.value) && !isNarrow.value && !scene.performMode
)

const navWidthPx = computed(() => {
  if (props.navCollapsed || isNarrow.value) return 56
  if (prefs.navWidth && Number(prefs.navWidth) > 0) return Number(prefs.navWidth)
  return isWide.value ? 280 : 240
})

const inspectorWidthPx = computed(() => {
  if (prefs.inspectorWidth && Number(prefs.inspectorWidth) > 0) return Number(prefs.inspectorWidth)
  return isWide.value ? 320 : 280
})

function onNavCollapsed(v) {
  emit('update:navCollapsed', v)
  prefs.navCollapsed = !!v
}

function playPad(i) {
  const slot = scene.soundpad?.[i]
  if (!slot?.src) return
  scene.sendSoundPlay({ src: slot.src, volume: slot.volume ?? 1, slotId: i })
}

function editPad(i) {
  emit('toggle-panel', 'soundpad')
  window.dispatchEvent(new CustomEvent('omo-soundpad-edit', { detail: { index: i } }))
}

function stopAllSounds() {
  scene.stopAllSounds()
}
</script>

<template>
  <div
    :class="cn('flex h-full min-h-0 flex-col', densityClass)"
    role="application"
    aria-label="OBS Moderator Overlay editor"
  >
    <a class="skip-link" href="#editor-canvas">Skip to canvas</a>

    <AppCommandBar
      v-show="!scene.performMode"
      :show-inspector-toggle="isNarrow && !scene.performMode"
      :inspector-open="inspectorSheetOpen"
      @toggle-inspector="$emit('toggle-inspector')"
      @open-palette="$emit('open-palette')"
      @open-help="$emit('open-help')"
    />

    <div class="flex min-h-0 min-w-0 flex-1">
      <div
        :class="cn(
          'flex min-h-0 min-w-0 flex-1',
          scene.performMode && '[&>*:not(.shell-main)]:hidden'
        )"
      >
        <AppNavigation
          v-show="!scene.performMode"
          :panels="panels"
          :stream-open="streamOpen"
          :dock-open="dockOpen"
          :collapsed="navCollapsed || isNarrow"
          :wide="isWide"
          :width-px="navWidthPx"
          :tools-in-dock="showToolsDock"
          @toggle-panel="$emit('toggle-panel', $event)"
          @update:collapsed="onNavCollapsed"
        />

        <main
          id="shell-main"
          class="shell-main relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--bg)] [&_.canvas]:h-full [&_.canvas]:w-full"
          data-tour="canvas"
          role="main"
          aria-label="Scene stage"
        >
          <slot name="main" />
        </main>

        <!-- Ultrawide Tools dock (third column) -->
        <aside
          v-if="showToolsDock"
          class="tools-dock flex min-h-0 w-[220px] shrink-0 flex-col border-l border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] backdrop-blur-md"
          data-tour="tools"
          aria-label="Pinned tools"
        >
          <div
            class="flex items-center border-b border-[var(--border)] px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]"
            :style="{ height: 'var(--shell-nav-head-h)' }"
          >
            Tools dock
          </div>
          <AppNavigation
            tools-only
            :panels="panels"
            :stream-open="streamOpen"
            :dock-open="dockOpen"
            :collapsed="false"
            :wide="false"
            :width-px="220"
            @toggle-panel="$emit('toggle-panel', $event)"
          />
        </aside>

        <AppInspector
          v-if="!isNarrow"
          :collapsed="scene.performMode"
          :wide="isWide"
          :width-px="inspectorWidthPx"
        />
      </div>

      <slot name="dock" />
    </div>

    <AppStatusBar v-show="!scene.performMode" @open-settings="$emit('open-settings', $event)" />

    <!-- Perform mode 2.0: exit chrome + floating SoundPad strip (canvas stays visible) -->
    <Transition name="perform-mode">
      <div
        v-if="scene.performMode"
        class="perform-exit"
        role="status"
        aria-live="polite"
      >
        <Clapperboard class="h-4 w-4 text-[var(--fluent-accent)]" />
        <span>{{ t('perform.hint') }}</span>
        <Button size="sm" variant="secondary" class="h-7" @click="scene.togglePerformMode()">
          {{ t('perform.exit') }}
        </Button>
      </div>
    </Transition>

    <Transition name="perform-mode">
      <div
        v-if="scene.performMode"
        class="perform-strip"
        role="toolbar"
        :aria-label="t('perform.strip')"
      >
        <div class="perform-pad">
          <ContextMenu v-for="(slot, i) in scene.soundpad" :key="i">
            <ContextMenuTrigger as-child>
              <button
                type="button"
                class="perform-pad-btn"
                :class="{ empty: !slot.src, playing: scene.playingSlotId === i }"
                :style="{ '--btn-color': slot.color || '#3b82f6' }"
                :disabled="!slot.src"
                :title="slot.name || (slot.src ? `F${i + 1}` : t('perform.empty'))"
                @click="playPad(i)"
              >
                <span class="perform-fkey">F{{ i + 1 }}</span>
                <span class="perform-name">{{ slot.name || (slot.src ? `Sound ${i + 1}` : '—') }}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem v-if="slot.src" @select="playPad(i)">
                <Play /> {{ t('ctx.play') }}
              </ContextMenuItem>
              <ContextMenuItem v-if="slot.src" @select="stopAllSounds">
                <Square /> {{ t('ctx.stop') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @select="editPad(i)">
                <Pencil /> {{ t('ctx.edit') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>
        <div class="perform-actions">
          <Button size="sm" variant="destructive" class="h-9 gap-1.5" @click="stopAllSounds">
            <Square class="h-3.5 w-3.5" /> {{ t('perform.stopAll') }}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            class="h-9 gap-1.5"
            :class="panels.donations && 'ring-1 ring-[var(--fluent-accent)]'"
            @click="$emit('toggle-panel', 'donations')"
          >
            <BellRing class="h-3.5 w-3.5" /> {{ t('panel.donations') }}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            class="h-9 gap-1.5"
            :class="panels.twitch && 'ring-1 ring-[var(--fluent-accent)]'"
            @click="$emit('toggle-panel', 'twitch')"
          >
            <MessageSquare class="h-3.5 w-3.5" /> {{ t('panel.twitch') }}
          </Button>
        </div>
      </div>
    </Transition>

    <Sheet
      :open="isNarrow && inspectorSheetOpen && !scene.performMode"
      title="Inspector"
      side="right"
      @update:open="$emit('update:inspectorSheetOpen', $event)"
    >
      <AppInspector flush :collapsed="false" :wide="false" :width-px="320" />
    </Sheet>

    <slot name="overlays" />
  </div>
</template>
