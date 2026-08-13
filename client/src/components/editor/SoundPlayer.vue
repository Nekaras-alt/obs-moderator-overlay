<!--
  SoundPlayer.vue
  Hidden audio pool for SoundPad. Optional DynamicsCompressor for leveling.
-->
<template>
  <div class="sound-player" aria-hidden="true"></div>
</template>

<script setup>
import { watch, onUnmounted } from 'vue'
import { useSceneStore } from '../../stores/scene.js'

const scene = useSceneStore()
const activeEls = new Set()
let lastNonce = null
let audioCtx = null
let masterGain = null
let compressor = null
let compEnabled = false

/** Linear fader 0..1 → perceptual gain (gentler than linear). */
function logGain(v) {
  const x = Math.max(0, Math.min(1, Number(v) || 0))
  if (x <= 0) return 0
  return Math.pow(x, 1.6)
}

function ensureGraph(enableComp) {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!audioCtx) {
    audioCtx = new AC()
    masterGain = audioCtx.createGain()
    masterGain.gain.value = 1
    compressor = audioCtx.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 12
    compressor.ratio.value = 8
    compressor.attack.value = 0.003
    compressor.release.value = 0.25
    masterGain.connect(audioCtx.destination)
    compEnabled = false
  }
  if (enableComp !== compEnabled) {
    try { masterGain.disconnect() } catch (_) {}
    try { compressor.disconnect() } catch (_) {}
    if (enableComp) {
      masterGain.connect(compressor)
      compressor.connect(audioCtx.destination)
    } else {
      masterGain.connect(audioCtx.destination)
    }
    compEnabled = enableComp
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function stopAll() {
  for (const el of activeEls) {
    try { el.pause(); el.currentTime = 0; el.src = '' } catch (_) {}
  }
  activeEls.clear()
}

function play(src, volume, slotId, useCompressor) {
  if (!src) return
  const gain = logGain(volume ?? 1)
  const ctx = ensureGraph(!!useCompressor)

  if (ctx && masterGain) {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.src = src
    if (slotId != null) scene.playingSlotId = slotId
    activeEls.add(el)
    let source
    let g
    try {
      source = ctx.createMediaElementSource(el)
      g = ctx.createGain()
      g.gain.value = gain
      source.connect(g)
      g.connect(masterGain)
    } catch (_) {
      // Element already connected or CORS — fall back to element volume
      el.volume = gain
    }
    el.onended = () => {
      activeEls.delete(el)
      try { source?.disconnect(); g?.disconnect() } catch (_) {}
      el.src = ''
      if (scene.playingSlotId === slotId) scene.playingSlotId = null
    }
    el.play().catch(() => {
      activeEls.delete(el)
      el.src = ''
      if (scene.playingSlotId === slotId) scene.playingSlotId = null
    })
    return
  }

  const el = new Audio(src)
  el.volume = gain
  if (slotId != null) scene.playingSlotId = slotId
  activeEls.add(el)
  el.onended = () => {
    activeEls.delete(el)
    el.src = ''
    if (scene.playingSlotId === slotId) scene.playingSlotId = null
  }
  el.play().catch(() => {
    activeEls.delete(el)
    el.src = ''
    if (scene.playingSlotId === slotId) scene.playingSlotId = null
  })
}

watch(
  () => scene.pendingSound,
  (ps) => {
    if (!ps || ps.nonce === lastNonce) return
    lastNonce = ps.nonce
    if (ps.stopAll) {
      stopAll()
      scene.playingSlotId = null
    } else {
      const useComp = ps.compressor ?? !!scene.settings?.soundpadCompressor
      play(ps.src, ps.volume, ps.slotId, useComp)
    }
  },
  { flush: 'sync' }
)

onUnmounted(() => {
  stopAll()
  try { audioCtx?.close() } catch (_) {}
  audioCtx = null
})
</script>

<style scoped>
.sound-player { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }
</style>
