<!--
  PropertiesPanel.vue (M1+M3)
  Edits the selected layer: name, numeric transform, opacity, alignment tools,
  flip/reflect, corner-stick, aspect-scale, color label, folder, visibility
  toggles, and media-specific controls (video/youtube/audio).
-->
<template>
  <div class="props">
    <div class="head">Properties</div>
    <div v-if="!scene.selected" class="empty muted">Select a layer to edit it.</div>
    <div v-else class="body">
      <label>Name
        <input :value="layer.name" @change="set('name', $event.target.value)" />
      </label>

      <fieldset>
        <legend>Transform (stage px)</legend>
        <div class="grid2">
          <label>X <input type="number" :value="t.x" @change="setT('x', +$event.target.value)" /></label>
          <label>Y <input type="number" :value="t.y" @change="setT('y', +$event.target.value)" /></label>
          <label>W <input type="number" :value="t.w" @change="setT('w', +$event.target.value)" /></label>
          <label>H <input type="number" :value="t.h" @change="setT('h', +$event.target.value)" /></label>
          <label>Rotation <input type="number" :value="t.rotation" @change="setT('rotation', +$event.target.value)" /></label>
          <label>Opacity
            <input type="range" min="0" max="1" step="0.05" :value="t.opacity"
                   @input="setT('opacity', +$event.target.value)" />
          </label>
        </div>
        <label v-if="isMedia" class="row keep-row">
          <input type="checkbox" :checked="layer.maintainRatio !== false"
                 @change="set('maintainRatio', $event.target.checked)" />
          <span>Keep proportions <small class="muted">(fit inside box, no stretch)</small></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Align &amp; arrange</legend>
        <div class="btn-grid">
          <button title="Align left" @click="apply(alignH(t, 'left'))">⇤</button>
          <button title="Center horizontally" @click="apply(alignH(t, 'center'))">↔</button>
          <button title="Align right" @click="apply(alignH(t, 'right'))">⇥</button>
          <button title="Align top" @click="apply(alignV(t, 'top'))">⇧</button>
          <button title="Center vertically" @click="apply(centerOnStage(t))">✛</button>
          <button title="Align bottom" @click="apply(alignV(t, 'bottom'))">⇩</button>
        </div>
        <div class="btn-grid">
          <button title="Top-left corner" @click="apply(stickCorner(t,'tl'))">⇖</button>
          <button title="Top-right corner" @click="apply(stickCorner(t,'tr'))">⇗</button>
          <button title="Bottom-left corner" @click="apply(stickCorner(t,'bl'))">⇙</button>
          <button title="Bottom-right corner" @click="apply(stickCorner(t,'br'))">⇘</button>
        </div>
        <div class="btn-grid">
          <button title="Flip horizontal" @click="apply(flipH(t))">Mirror H</button>
          <button title="Flip vertical" @click="apply(flipV(t))">Mirror V</button>
          <button title="Scale up (keep ratio)" @click="apply(scaleAspect(t, 1.1))">＋ ratio</button>
          <button title="Scale down (keep ratio)" @click="apply(scaleAspect(t, 1/1.1))">－ ratio</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Layer</legend>
        <label>Color label
          <select :value="layer.colorLabel" @change="set('colorLabel', $event.target.value)">
            <option v-for="c in COLOR_LABELS" :key="c.id" :value="c.id">{{ c.id }}</option>
          </select>
        </label>
        <label>Folder
          <select :value="layer.folder || ''" @change="set('folder', $event.target.value || null)">
            <option value="">— none —</option>
            <option v-for="f in scene.folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
      </fieldset>

      <!-- Audience reveal — prominent toggle -->
      <div class="reveal-section">
        <div class="reveal-row">
          <button
            class="reveal-btn"
            :class="layer.audienceVisible ? 'reveal-on' : 'reveal-off'"
            @click="set('audienceVisible', !layer.audienceVisible)"
          >
            <span class="reveal-icon">{{ layer.audienceVisible ? '👁' : '🔒' }}</span>
            <span class="reveal-label">{{ layer.audienceVisible ? 'VISIBLE TO AUDIENCE' : 'HIDDEN FROM AUDIENCE' }}</span>
          </button>
        </div>
        <div class="reveal-hint">
          {{ layer.audienceVisible ? 'This layer is shown on the OBS stream.' : 'Only you can see this layer. Click to reveal to audience.' }}
        </div>
      </div>

      <fieldset>
        <legend>Visibility</legend>
        <label class="row">
          <input type="checkbox" :checked="layer.visible"
                 @change="set('visible', $event.target.checked)" />
          <span>Show in editor</span>
        </label>
        <label class="row">
          <input type="checkbox" :checked="layer.locked"
                 @change="set('locked', $event.target.checked)" />
          <span>Locked</span>
        </label>
      </fieldset>

      <!-- Media-specific controls -->
      <VideoControls :layer="layer" />
      <YoutubeSettings :layer="layer" />
      <AudioControls :layer="layer" />
      <TextControls :layer="layer" />

      <!-- Temporary object (auto-delete countdown) -->
      <fieldset>
        <legend>Temporary object</legend>
        <div v-if="scene.ttlRemaining[layer.id] > 0" class="ttl-active">
          <span class="ttl-clock">⏱ {{ ttlCountdown }}s remaining</span>
          <button class="danger" @click="scene.cancelTtl(layer.id)">Cancel countdown</button>
        </div>
        <div v-else class="ttl-idle">
          <p class="hint muted small">Make this layer auto-delete after a countdown.</p>
          <div class="ttl-presets">
            <button v-for="p in TTL_PRESETS" :key="p" @click="scene.startTtl(layer.id, p)">
              +{{ p }}s
            </button>
          </div>
          <label class="row">
            <span>Custom (s)</span>
            <input type="number" min="1" step="1" v-model.number="customTtl" style="width:80px" />
            <button :disabled="!customTtl" @click="startCustomTtl">Start</button>
          </label>
        </div>
      </fieldset>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { COLOR_LABELS } from '@shared/schema.js'
import { alignH, alignV, centerOnStage, stickCorner, flipH, flipV, scaleAspect } from '../../features/transforms.js'
import VideoControls from './VideoControls.vue'
import YoutubeSettings from './YoutubeSettings.vue'
import AudioControls from './AudioControls.vue'
import TextControls from './TextControls.vue'

const scene = useSceneStore()
const layer = computed(() => scene.selected)
const t = computed(() => layer.value?.transform || {})
// Media types whose fill is driven by the maintainRatio toggle.
const isMedia = computed(() => ['image', 'gif', 'video', 'emote'].includes(layer.value?.type))
function set(key, value) { scene.updateLayer(layer.value.id, { [key]: value }) }
function setT(key, value) { scene.updateLayer(layer.value.id, { transform: { ...layer.value.transform, [key]: value } }) }
// Replace the whole transform with a computed one (from transform helpers).
function apply(newTransform) { scene.updateLayer(layer.value.id, { transform: newTransform }) }

// --- Temporary object (TTL) controls --------------------------------------
const TTL_PRESETS = [10, 30, 60, 120]
const customTtl = ref(30)
// Reactive seconds-remaining for the selected layer (drives the live readout).
const ttlCountdown = computed(() => {
  const id = layer.value?.id
  return id ? (scene.ttlRemaining[id] || 0) : 0
})
function startCustomTtl() {
  if (customTtl.value > 0 && layer.value) scene.startTtl(layer.value.id, customTtl.value)
}
</script>

<style scoped>
.props {
  background: var(--panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head { padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--border); }
.body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.empty { padding: 16px; font-size: 13px; }
fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
legend { font-size: 12px; color: var(--text-dim); padding: 0 4px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
label.row { flex-direction: row; align-items: center; gap: 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 6px; }
.keep-row { margin-top: 8px; }
.keep-row small { font-size: 10px; }
.btn-grid button { padding: 6px 0; font-size: 13px; }
input[type="number"], select { width: 100%; }

/* Audience reveal button */
.reveal-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px 0;
}
.reveal-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 16px;
  border: 2px solid;
  border-radius: 10px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.reveal-btn.reveal-on {
  background: rgba(34, 197, 94, 0.15);
  border-color: var(--ok);
  color: var(--ok);
}
.reveal-btn.reveal-on:hover {
  background: rgba(34, 197, 94, 0.25);
}
.reveal-btn.reveal-off {
  background: rgba(239, 68, 68, 0.1);
  border-color: var(--danger);
  color: var(--danger);
}
.reveal-btn.reveal-off:hover {
  background: rgba(239, 68, 68, 0.2);
}
.reveal-icon { font-size: 20px; line-height: 1; }
.reveal-label { flex: 1; text-align: left; }
.reveal-hint {
  font-size: 11px;
  color: var(--text-dim);
  padding: 0 4px;
  line-height: 1.4;
}

/* Temporary-object (TTL) section */
.ttl-active {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.ttl-clock {
  font-size: 15px;
  font-weight: 700;
  color: var(--danger, #ef4444);
  text-align: center;
  padding: 6px 0;
  font-variant-numeric: tabular-nums;
}
.ttl-active button.danger, .ttl-idle button {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.ttl-active button.danger {
  border-color: var(--danger, #ef4444);
  color: var(--danger, #ef4444);
}
.ttl-idle { display: flex; flex-direction: column; gap: 8px; }
.ttl-idle .hint { margin: 0; }
.ttl-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.ttl-presets button {
  flex: 1; min-width: 0;
  padding: 5px 0;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.ttl-presets button:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
