<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'

const TOUR_STEPS = ['welcome', 'cmdbar', 'layers', 'canvas', 'inspector', 'tools', 'statusbar', 'help']
const PAD = 10
const CARD_W = 380

const props = defineProps({
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['done', 'skip', 'prepare-step'])

const { t } = useI18n()
const step = ref(0)
const hole = reactive({ x: 0, y: 0, w: 0, h: 0, visible: false })
const cardPos = reactive({ left: 24, top: 80, centered: true })
const reduceMotion = ref(false)

const stepId = computed(() => TOUR_STEPS[step.value] || 'welcome')
const isLast = computed(() => step.value >= TOUR_STEPS.length - 1)
const title = computed(() => t('tour.' + stepId.value + '.title'))
const body = computed(() => t('tour.' + stepId.value + '.body'))
const progress = computed(() => t('tour.progress', { n: step.value + 1, total: TOUR_STEPS.length }))

function prefersReduce() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function measure() {
  const id = stepId.value
  if (id === 'welcome') {
    hole.visible = false
    cardPos.centered = true
    return
  }
  const el = document.querySelector(`[data-tour="${id}"]`)
  if (!el) {
    hole.visible = false
    cardPos.centered = true
    return
  }
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  if (r.width < 8 || r.height < 8 || cs.display === 'none' || cs.visibility === 'hidden') {
    hole.visible = false
    cardPos.centered = true
    return
  }
  hole.x = Math.max(8, r.left - PAD)
  hole.y = Math.max(8, r.top - PAD)
  hole.w = Math.min(window.innerWidth - hole.x - 8, r.width + PAD * 2)
  hole.h = Math.min(window.innerHeight - hole.y - 8, r.height + PAD * 2)
  hole.visible = true
  placeCard(r)
}

function placeCard(r) {
  cardPos.centered = false
  const margin = 16
  const cardH = 230
  let left = r.left
  left = Math.min(Math.max(margin, left), window.innerWidth - CARD_W - margin)
  const below = r.bottom + 14
  const above = r.top - cardH - 14
  let top
  if (below + cardH < window.innerHeight - margin) top = below
  else if (above > margin) top = above
  else top = Math.min(window.innerHeight - cardH - margin, Math.max(margin, r.top + 12))
  cardPos.left = left
  cardPos.top = top
}

async function go(i) {
  step.value = Math.max(0, Math.min(TOUR_STEPS.length - 1, i))
  emit('prepare-step', TOUR_STEPS[step.value])
  await nextTick()
  await new Promise((r) => setTimeout(r, 90))
  requestAnimationFrame(() => requestAnimationFrame(measure))
}

function next() {
  if (isLast.value) emit('done')
  else go(step.value + 1)
}

function back() {
  if (step.value > 0) go(step.value - 1)
}

function skip() {
  emit('skip')
}

function onKey(e) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    skip()
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault()
    next()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    back()
  }
}

watch(() => props.open, async (v) => {
  if (!v) return
  reduceMotion.value = prefersReduce()
  step.value = 0
  emit('prepare-step', 'welcome')
  await nextTick()
  requestAnimationFrame(measure)
})

watch(stepId, async () => {
  if (!props.open) return
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(measure))
})

onMounted(() => {
  reduceMotion.value = prefersReduce()
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', measure)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="tour-root"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'tour-title'"
    >
      <div class="tour-dim" :class="{ cut: hole.visible }" />
      <div
        v-if="hole.visible"
        class="tour-hole"
        :class="{ pulse: !reduceMotion }"
        :style="{
          left: hole.x + 'px',
          top: hole.y + 'px',
          width: hole.w + 'px',
          height: hole.h + 'px',
          transitionDuration: reduceMotion ? '0ms' : '420ms'
        }"
      />
      <div
        class="tour-card"
        :class="{ centered: cardPos.centered }"
        :style="cardPos.centered
          ? { width: CARD_W + 'px' }
          : { left: cardPos.left + 'px', top: cardPos.top + 'px', width: CARD_W + 'px', transitionDuration: reduceMotion ? '0ms' : '420ms' }"
      >
        <div class="tour-kicker">{{ progress }}</div>
        <h2 id="tour-title" class="tour-title">{{ title }}</h2>
        <p class="tour-body">{{ body }}</p>
        <div class="tour-actions">
          <Button size="sm" variant="ghost" class="mr-auto" @click="skip">{{ t('tour.skip') }}</Button>
          <Button size="sm" variant="secondary" :disabled="step === 0" @click="back">{{ t('tour.back') }}</Button>
          <Button size="sm" @click="next">{{ isLast ? t('tour.done') : t('tour.next') }}</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 230;
  pointer-events: auto;
}
.tour-dim {
  position: absolute;
  inset: 0;
  background: rgba(8, 10, 14, 0.58);
}
.tour-dim.cut {
  background: transparent;
}
.tour-hole {
  position: absolute;
  border-radius: 12px;
  border: 2px solid var(--fluent-accent);
  box-shadow: 0 0 0 9999px rgba(8, 10, 14, 0.62), 0 0 28px color-mix(in srgb, var(--fluent-accent) 45%, transparent);
  pointer-events: none;
  transition-property: left, top, width, height;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
.tour-hole.pulse {
  animation: tour-pulse 1.8s ease-in-out infinite;
}
@keyframes tour-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 9999px rgba(8, 10, 14, 0.62),
      0 0 0 0 color-mix(in srgb, var(--fluent-accent) 50%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 9999px rgba(8, 10, 14, 0.62),
      0 0 0 12px color-mix(in srgb, var(--fluent-accent) 0%, transparent);
  }
}
.tour-card {
  position: absolute;
  z-index: 1;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--fluent-stroke);
  background: var(--fluent-acrylic);
  box-shadow: var(--fluent-elevation);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  color: var(--text);
  transition-property: left, top;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
.tour-card.centered {
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
}
.tour-kicker {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fluent-accent);
  margin-bottom: 6px;
}
.tour-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 650;
  line-height: 1.25;
}
.tour-body {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-dim);
}
.tour-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .tour-hole,
  .tour-card {
    transition: none !important;
    animation: none !important;
  }
}
</style>
