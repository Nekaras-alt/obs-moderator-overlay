<script setup>
import { PanelRight } from '@lucide/vue'
import PropertiesPanel from '@/components/editor/PropertiesPanel.vue'
import { cn } from '@/lib/utils'

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  wide: { type: Boolean, default: false },
  flush: { type: Boolean, default: false },
  widthPx: { type: Number, default: 0 }
})

const widthStyle = () => {
  if (props.flush) return { width: '100%', height: '100%' }
  const w = props.widthPx || (props.wide ? 320 : 280)
  return { width: w + 'px' }
}
</script>

<template>
  <aside
    v-show="!collapsed"
    role="complementary"
    aria-label="Inspector"
    data-tour="inspector"
    :class="cn(
      'flex min-h-0 flex-col bg-[var(--fluent-acrylic)] backdrop-blur-md transition-[width] duration-200',
      !flush && 'border-l border-[var(--fluent-stroke)]'
    )"
    :style="widthStyle()"
  >
    <div
      v-if="!flush"
      class="flex items-center gap-2 border-b border-[var(--border)] px-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]"
      :style="{ height: 'var(--shell-inspector-head-h)' }"
    >
      <PanelRight class="h-3.5 w-3.5" aria-hidden="true" />
      Inspector
    </div>
    <div class="min-h-0 flex-1 overflow-hidden [&_.props]:h-full [&_.props]:border-0 [&_.props]:bg-transparent [&_.props_.head]:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <PropertiesPanel />
    </div>
  </aside>
</template>
