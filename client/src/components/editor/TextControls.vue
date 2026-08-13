<!--
  TextControls.vue
  Full styling for text layers: content, font family/size/color, bold/italic,
  alignment, outline (color + thickness), shadow (on/off + params), background
  color + opacity, border radius. The text content can also be edited inline by
  double-clicking the layer on the stage.
-->
<template>
  <fieldset v-if="layer?.type === 'text' || layer?.type === 'timer' || layer?.type === 'counter'" class="fluent-fieldset">
    <legend>{{ layer?.type === 'text' ? 'Text' : 'Style' }}</legend>

    <template v-if="layer?.type === 'text'">
      <label>Content
        <textarea rows="2" :value="tx.content" @change="set('content', $event.target.value)"></textarea>
      </label>
      <p class="hint muted small">Tip: double-click the text on the stage to edit it in place.</p>
    </template>

    <div class="row2">
      <label>Font
        <select :value="tx.fontFamily" @change="set('fontFamily', $event.target.value)">
          <option v-for="f in FONTS" :key="f" :value="f" :style="{ fontFamily: f }">{{ labelFont(f) }}</option>
        </select>
      </label>
      <label>Size
        <input type="number" min="8" max="400" :value="tx.fontSize"
               @change="set('fontSize', +$event.target.value)" />
      </label>
    </div>

    <div class="row2">
      <label>Color
        <input type="color" :value="tx.fontColor" @input="set('fontColor', $event.target.value)" />
      </label>
      <label>Align
        <select :value="tx.textAlign" @change="set('textAlign', $event.target.value)">
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
    </div>

    <div class="btn-group">
      <Button size="icon" class="h-8 w-8" :variant="tx.bold ? 'default' : 'secondary'" @click="set('bold', !tx.bold)"><b>B</b></Button>
      <Button size="icon" class="h-8 w-8" :variant="tx.italic ? 'default' : 'secondary'" @click="set('italic', !tx.italic)"><i>I</i></Button>
    </div>

    <div class="sub-section">
      <div class="sub-title">Outline</div>
      <div class="row2">
        <label>Color
          <input type="color" :value="tx.outlineColor" @input="set('outlineColor', $event.target.value)" />
        </label>
        <label>Thickness (0 = off)
          <input type="range" min="0" max="10" step="0.5" :value="tx.outlineWidth"
                 @input="set('outlineWidth', +$event.target.value)" />
          <span class="muted small">{{ tx.outlineWidth }}</span>
        </label>
      </div>
    </div>

    <div class="sub-section">
      <label class="row">
        <input type="checkbox" :checked="tx.shadow" @change="set('shadow', $event.target.checked)" />
        <span>Shadow</span>
      </label>
      <template v-if="tx.shadow">
        <div class="row2">
          <label>Color
            <input type="color" :value="tx.shadowColor" @input="set('shadowColor', $event.target.value)" />
          </label>
          <label>Blur
            <input type="number" min="0" max="50" :value="tx.shadowBlur"
                   @change="set('shadowBlur', +$event.target.value)" />
          </label>
        </div>
        <div class="row2">
          <label>Offset X
            <input type="number" min="-50" max="50" :value="tx.shadowOffsetX"
                   @change="set('shadowOffsetX', +$event.target.value)" />
          </label>
          <label>Offset Y
            <input type="number" min="-50" max="50" :value="tx.shadowOffsetY"
                   @change="set('shadowOffsetY', +$event.target.value)" />
          </label>
        </div>
      </template>
    </div>

    <div class="sub-section">
      <div class="sub-title">Background</div>
      <div class="row2">
        <label>Color
          <input type="color" :value="tx.bgColor" @input="set('bgColor', $event.target.value)" />
        </label>
        <label>Opacity (0 = clear)
          <input type="range" min="0" max="1" step="0.05" :value="tx.bgOpacity"
                 @input="set('bgOpacity', +$event.target.value)" />
          <span class="muted small">{{ Math.round((tx.bgOpacity ?? 0) * 100) }}%</span>
        </label>
      </div>
      <label>Corner radius
        <input type="range" min="0" max="80" :value="tx.borderRadius"
               @input="set('borderRadius', +$event.target.value)" />
        <span class="muted small">{{ tx.borderRadius }}px</span>
      </label>
    </div>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '../../stores/scene.js'
import { Button } from '@/components/ui/button'

const props = defineProps({ layer: Object })
const scene = useSceneStore()
const tx = computed(() => props.layer?.text || {})

const FONTS = [
  'Inter, "Segoe UI", Arial, sans-serif',
  'Arial, sans-serif',
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, serif',
  '"Times New Roman", Times, serif',
  '"Courier New", Courier, monospace',
  'Verdana, Geneva, sans-serif',
  'Tahoma, Geneva, sans-serif',
  '"Trebuchet MS", Helvetica, sans-serif',
  'Impact, Charcoal, sans-serif',
  '"Comic Sans MS", "Comic Sans", cursive',
  '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  '"Lucida Console", Monaco, monospace',
  '"Gill Sans", "Gill Sans MT", Calibri, sans-serif'
]
function labelFont(f) {
  // Show a friendly name: first quoted family, else first word.
  const m = f.match(/"([^"]+)"/)
  return m ? m[1] : f.split(',')[0].trim()
}
function set(key, value) {
  scene.updateLayer(props.layer.id, { text: { ...tx.value, [key]: value } })
}
</script>

<style scoped>
.small { font-size: 10px; }
.hint { margin: 4px 0 6px; line-height: 1.4; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
label.row { flex-direction: row; align-items: center; gap: 8px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sub-section { border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.sub-title { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; }
.btn-group { display: flex; gap: 6px; }
textarea { resize: vertical; font-family: inherit; }
input[type="color"] { height: 28px; padding: 0; cursor: pointer; }
</style>
