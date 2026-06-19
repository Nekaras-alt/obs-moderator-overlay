<!--
  Minimap.vue (M2)
  A scaled-down view of the whole 1920x1080 stage showing all layers as rects
  + a viewport rectangle for the current scroll position. Click to jump.
-->
<template>
  <div class="minimap" ref="root" @mousedown="onJump">
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

const props = defineProps({ scale: Number, scroll: Object })

const scene = useSceneStore()
const root = ref(null)

// Minimap renders the stage at 160px wide.
const MM_W = 160
const mmScale = MM_W / STAGE.W

const rects = computed(() =>
  scene.layers.map((l) => {
    const t = l.transform
    return { id: l.id, x: t.x * mmScale, y: t.y * mmScale, w: t.w * mmScale, h: t.h * mmScale }
  })
)

const vpStyle = computed(() => {
  const el = props.scroll
  if (!el) return { display: 'none' }
  const x = el.scrollLeft / props.scale * mmScale
  const y = el.scrollTop / props.scale * mmScale
  const w = el.clientWidth / props.scale * mmScale
  const h = el.clientHeight / props.scale * mmScale
  return { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }
})

function onJump(e) {
  const el = props.scroll
  const r = root.value.getBoundingClientRect()
  const x = (e.clientX - r.left) / mmScale * props.scale - el.clientWidth / 2
  const y = (e.clientY - r.top) / mmScale * props.scale - el.clientHeight / 2
  el.scrollTo({ left: x, top: y, behavior: 'smooth' })
}

// Re-render viewport rect on scroll.
let raf = 0
onMounted(() => {
  const el = props.scroll
  if (!el) return
  const upd = () => { raf = 0; root.value && (root.value._f = Date.now()) /* trigger reactivity */ ; tick.value++ }
  el.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd) })
})
const tick = ref(0)
</script>

<style scoped>
.minimap {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 160px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--shadow);
  z-index: 20;
}
.mm-stage { position: relative; width: 148px; height: 83px; background: #000; border-radius: 3px; overflow: hidden; }
.mm-layer { position: absolute; background: rgba(96,165,250,.6); border: 1px solid rgba(96,165,250,1); }
.mm-layer.sel { background: rgba(239,68,68,.8); border-color: #fff; }
.mm-viewport { position: absolute; border: 1.5px solid #fff; pointer-events: none; }
</style>
