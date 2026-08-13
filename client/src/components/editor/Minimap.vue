<!--
  Minimap.vue — Fluent acrylic stage overview (editor chrome only).
-->
<template>
  <div
    class="minimap"
    ref="root"
    role="img"
    :aria-label="t('canvas.minimap')"
    :title="t('canvas.minimapHint')"
    @mousedown.prevent="onPointerDown"
  >
    <div class="mm-stage">
      <div
        v-for="l in rects"
        :key="l.id"
        class="mm-layer"
        :class="{ sel: l.id === scene.selectedId }"
        :style="{ left: l.x + 'px', top: l.y + 'px', width: l.w + 'px', height: l.h + 'px' }"
      ></div>
      <div class="mm-viewport" :style="vpStyle"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { STAGE } from '@shared/schema.js'
import { useI18n } from '@/i18n'

const props = defineProps({
  scale: Number,
  scroll: Object,
  /** Logical stage margin around 1920×1080 in the editor workspace (Canvas STAGE_MARGIN). */
  stageMargin: { type: Number, default: 0 }
})

const scene = useSceneStore()
const { t } = useI18n()
const root = ref(null)

const MM_W = 160
const mmScale = MM_W / STAGE.W

const rects = computed(() =>
  scene.layers.map((l) => {
    const tr = l.transform
    return { id: l.id, x: tr.x * mmScale, y: tr.y * mmScale, w: tr.w * mmScale, h: tr.h * mmScale }
  })
)

const vpStyle = computed(() => {
  const el = props.scroll
  if (!el) return { display: 'none' }
  void tick.value
  const margin = props.stageMargin || 0
  const x = (el.scrollLeft / props.scale - margin) * mmScale
  const y = (el.scrollTop / props.scale - margin) * mmScale
  const w = el.clientWidth / props.scale * mmScale
  const h = el.clientHeight / props.scale * mmScale
  return { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }
})

function jumpTo(e) {
  const el = props.scroll
  const r = root.value.getBoundingClientRect()
  const margin = props.stageMargin || 0
  const x = ((e.clientX - r.left) / mmScale + margin) * props.scale - el.clientWidth / 2
  const y = ((e.clientY - r.top) / mmScale + margin) * props.scale - el.clientHeight / 2
  el.scrollTo({ left: x, top: y })
}

function onPointerDown(e) {
  if (e.button !== 0) return
  jumpTo(e)
  const move = (ev) => jumpTo(ev)
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

let raf = 0
let onScroll = null
onMounted(() => {
  const el = props.scroll
  if (!el) return
  const upd = () => { raf = 0; tick.value++ }
  onScroll = () => { if (!raf) raf = requestAnimationFrame(upd) }
  el.addEventListener('scroll', onScroll)
})
onBeforeUnmount(() => {
  props.scroll?.removeEventListener?.('scroll', onScroll)
  if (raf) cancelAnimationFrame(raf)
})
const tick = ref(0)
</script>

<style scoped>
.minimap {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 160px;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--fluent-elevation);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 20;
  cursor: grab;
  transition: border-color var(--fluent-duration-fast) var(--fluent-ease);
}
.minimap:hover { border-color: color-mix(in srgb, var(--fluent-accent) 45%, var(--fluent-stroke)); }
.minimap:active { cursor: grabbing; }
.mm-stage {
  position: relative;
  width: 148px;
  height: 83px;
  background: #0a0a0b;
  border: 1px solid var(--fluent-stroke);
  border-radius: 4px;
  overflow: hidden;
}
.mm-layer {
  position: absolute;
  background: color-mix(in srgb, var(--fluent-accent) 45%, transparent);
  border: 1px solid color-mix(in srgb, var(--fluent-accent) 80%, transparent);
  border-radius: 1px;
  box-sizing: border-box;
}
.mm-layer.sel {
  background: color-mix(in srgb, var(--fluent-accent) 75%, transparent);
  border-color: #fff;
  box-shadow: 0 0 0 1px var(--fluent-accent);
  z-index: 2;
}
.mm-viewport {
  position: absolute;
  border: 1.5px solid #fff;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fluent-accent) 50%, transparent);
  background: color-mix(in srgb, var(--fluent-accent) 12%, transparent);
  pointer-events: none;
  z-index: 3;
}
</style>
