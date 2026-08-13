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
          <span>{{ tr('ctx.aspectRatio') }} <small class="muted">({{ tr('props.aspectHint') }})</small></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Align &amp; arrange</legend>
        <div class="btn-grid">
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Align left" @click="apply(alignH(t, 'left'))">
            <AlignLeft class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Center horizontally" @click="apply(alignH(t, 'center'))">
            <AlignCenterHorizontal class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Align right" @click="apply(alignH(t, 'right'))">
            <AlignRight class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Align top" @click="apply(alignV(t, 'top'))">
            <AlignStartVertical class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Center vertically" @click="apply(centerOnStage(t))">
            <AlignCenterVertical class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Align bottom" @click="apply(alignV(t, 'bottom'))">
            <AlignEndVertical class="h-4 w-4" />
          </Button>
        </div>
        <div class="btn-grid">
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Top-left corner" @click="apply(stickCorner(t,'tl'))">
            <ArrowUpLeft class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Top-right corner" @click="apply(stickCorner(t,'tr'))">
            <ArrowUpRight class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Bottom-left corner" @click="apply(stickCorner(t,'bl'))">
            <ArrowDownLeft class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" class="h-8 w-8" title="Bottom-right corner" @click="apply(stickCorner(t,'br'))">
            <ArrowDownRight class="h-4 w-4" />
          </Button>
        </div>
        <div class="btn-grid btn-grid-wide">
          <Button variant="secondary" size="sm" class="gap-1" title="Flip horizontal" @click="apply(flipH(t))">
            <FlipHorizontal2 class="h-3.5 w-3.5" /> Mirror H
          </Button>
          <Button variant="secondary" size="sm" class="gap-1" title="Flip vertical" @click="apply(flipV(t))">
            <FlipVertical2 class="h-3.5 w-3.5" /> Mirror V
          </Button>
          <Button variant="secondary" size="sm" class="gap-1" title="Scale up (keep ratio)" @click="apply(scaleAspect(t, 1.1))">
            <ZoomIn class="h-3.5 w-3.5" /> Ratio
          </Button>
          <Button variant="secondary" size="sm" class="gap-1" title="Scale down (keep ratio)" @click="apply(scaleAspect(t, 1/1.1))">
            <ZoomOut class="h-3.5 w-3.5" /> Ratio
          </Button>
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
            <span class="reveal-icon">
              <Eye v-if="layer.audienceVisible" class="h-4 w-4" />
              <Lock v-else class="h-4 w-4" />
            </span>
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

      <fieldset v-if="layer.type === 'timer'" class="fluent-fieldset">
        <legend>{{ tr('props.timer') }}</legend>
        <label>{{ tr('props.timerSeconds') }}
          <input
            type="number"
            min="1"
            max="86400"
            :value="layer.timerSeconds ?? 300"
            @change="set('timerSeconds', Math.max(1, Math.floor(+$event.target.value || 300)))"
          />
        </label>
        <div class="btn-grid btn-grid-wide" style="margin-top:8px">
          <Button size="sm" @click="startTimer">{{ tr('props.timerStart') }}</Button>
          <Button size="sm" variant="secondary" @click="resetTimer">{{ tr('props.timerReset') }}</Button>
        </div>
        <p class="hint muted small" style="margin:6px 0 0">
          {{ layer.timerEndsAt && layer.timerEndsAt > Date.now() ? tr('props.timerRunning') : tr('props.timerIdle') }}
        </p>
      </fieldset>

      <fieldset v-if="layer.type === 'counter'" class="fluent-fieldset">
        <legend>{{ tr('props.counter') }}</legend>
        <label>{{ tr('props.counterValue') }}
          <input
            type="number"
            :value="layer.counterValue ?? 0"
            @change="set('counterValue', Math.floor(+$event.target.value || 0))"
          />
        </label>
        <div class="btn-grid btn-grid-wide" style="margin-top:8px">
          <Button size="sm" variant="secondary" @click="bumpCounter(-1)">−</Button>
          <Button size="sm" variant="secondary" @click="bumpCounter(1)">+</Button>
        </div>
      </fieldset>

      <fieldset v-if="layer.type === 'browser' || layer.type === 'chatis'" class="browser-props fluent-fieldset">
        <legend>{{ layer.type === 'chatis' ? 'ChatIS (legacy)' : 'Browser Source' }}</legend>
        <p v-if="browserCfg.source === 'chatis'" class="hint muted small">Created from ChatIS wizard</p>
        <label v-if="layer.type === 'chatis'">Channel
          <input :value="layer.chatis?.channel" @change="setBrowserField('channel', $event.target.value)" />
        </label>
        <label>URL
          <input :value="browserCfg.url" @change="setBrowserField('url', $event.target.value)" />
        </label>
        <div class="grid2">
          <label>Width
            <input type="number" min="50" max="3840" :value="browserCfg.width ?? t.w"
                   @change="setBrowserSize('width', +$event.target.value)" />
          </label>
          <label>Height
            <input type="number" min="50" max="2160" :value="browserCfg.height ?? t.h"
                   @change="setBrowserSize('height', +$event.target.value)" />
          </label>
        </div>
        <label>Custom CSS
          <textarea rows="5" :value="browserCfg.customCss || ''"
                    placeholder="body { background-color: rgba(0,0,0,0); }"
                    @change="setBrowserField('customCss', $event.target.value)"></textarea>
        </label>
        <label class="row">
          <input type="checkbox" :checked="!!browserCfg.controlAudioViaObs"
                 @change="setBrowserField('controlAudioViaObs', $event.target.checked)" />
          <span>Control audio via OBS</span>
        </label>
        <p v-if="browserCfg.controlAudioViaObs" class="hint muted small">
          Works only for proxied widgets (DonationAlerts / Custom CSS). Direct embeds cannot change cross-origin volume.
        </p>
        <template v-if="!!browserCfg.controlAudioViaObs">
          <label>Volume
            <input type="range" min="0" max="1" step="0.02" :value="browserCfg.volume ?? 1"
                   @input="setBrowserField('volume', +$event.target.value)" />
          </label>
          <label class="row">
            <input type="checkbox" :checked="!!browserCfg.muted"
                   @change="setBrowserField('muted', $event.target.checked)" />
            <span>Mute</span>
          </label>
        </template>
        <div class="btn-grid browser-actions">
          <button type="button" @click="refreshBrowser">Refresh cache of current page</button>
          <a v-if="browserCfg.url" class="open-link" :href="browserCfg.url" target="_blank" rel="noopener">Open URL ↗</a>
        </div>
      </fieldset>

      <fieldset v-if="layer.type === 'multiBrowser'" class="browser-props fluent-fieldset">
        <legend>Multi Browser Source</legend>
        <p class="hint muted small">One widget URL per line (DonationAlerts, Donatex, ChatIS, …).</p>
        <label>URLs
          <textarea
            rows="6"
            :value="(layer.multiBrowser?.urls || []).join('\n')"
            @change="setMultiUrls($event.target.value)"
          ></textarea>
        </label>
        <div class="grid2">
          <label>Width
            <input type="number" min="50" max="3840" :value="layer.multiBrowser?.width ?? t.w"
                   @change="setMultiSize('width', +$event.target.value)" />
          </label>
          <label>Height
            <input type="number" min="50" max="2160" :value="layer.multiBrowser?.height ?? t.h"
                   @change="setMultiSize('height', +$event.target.value)" />
          </label>
        </div>
        <label class="row">
          <input type="checkbox" :checked="layer.multiBrowser?.queueEnabled !== false"
                 @change="setMultiField('queueEnabled', $event.target.checked)" />
          <span>Queue overlapping alerts</span>
        </label>
        <template v-if="layer.multiBrowser?.queueEnabled !== false">
          <label>Idle gap (ms)
            <input type="number" min="0" step="100" :value="layer.multiBrowser?.idleMs ?? 900"
                   @change="setMultiField('idleMs', +$event.target.value)" />
          </label>
          <label>Min hold (ms)
            <input type="number" min="0" step="100" :value="layer.multiBrowser?.minHoldMs ?? 2500"
                   @change="setMultiField('minHoldMs', +$event.target.value)" />
          </label>
          <label>Max hold (ms)
            <input type="number" min="1000" step="1000" :value="layer.multiBrowser?.maxHoldMs ?? 60000"
                   @change="setMultiField('maxHoldMs', +$event.target.value)" />
          </label>
          <p class="hint muted small">
            First alert claims the slot; others wait muted/hidden, then play in order.
          </p>
        </template>
        <button type="button" @click="refreshMulti">Refresh cache</button>
      </fieldset>

      <!-- Temporary object (auto-delete countdown) -->
      <fieldset>
        <legend>{{ tr('props.temporary') }}</legend>
        <div v-if="scene.ttlRemaining[layer.id] > 0" class="ttl-active">
          <span class="ttl-clock"><Timer class="inline h-3.5 w-3.5" /> {{ tr('props.ttlRemaining', { n: ttlCountdown }) }}</span>
          <button class="danger" @click="scene.cancelTtl(layer.id)">{{ tr('props.ttlCancel') }}</button>
        </div>
        <div v-else class="ttl-idle">
          <p class="hint muted small">{{ tr('props.ttlHint') }}</p>
          <div class="ttl-presets">
            <button v-for="p in TTL_PRESETS" :key="p" @click="scene.startTtl(layer.id, p)">
              +{{ p }}s
            </button>
          </div>
          <label class="row">
            <span>{{ tr('props.ttlCustom') }}</span>
            <input type="number" min="1" step="1" v-model.number="customTtl" style="width:80px" />
            <button :disabled="!customTtl" @click="startCustomTtl">{{ tr('props.ttlStart') }}</button>
          </label>
        </div>
      </fieldset>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  Eye, Lock, Timer,
  AlignLeft, AlignRight, AlignCenterHorizontal, AlignCenterVertical,
  AlignStartVertical, AlignEndVertical,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  FlipHorizontal2, FlipVertical2, ZoomIn, ZoomOut
} from '@lucide/vue'
import { useSceneStore } from '../../stores/scene.js'
import { COLOR_LABELS, buildChatisUrlFromConfig, defaultChatisConfig, defaultBrowserConfig, defaultMultiBrowserConfig } from '@shared/schema.js'
import { alignH, alignV, centerOnStage, stickCorner, flipH, flipV, scaleAspect } from '../../features/transforms.js'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import VideoControls from './VideoControls.vue'
import YoutubeSettings from './YoutubeSettings.vue'
import AudioControls from './AudioControls.vue'
import TextControls from './TextControls.vue'

const scene = useSceneStore()
const { t: tr } = useI18n()
const layer = computed(() => scene.selected)
const t = computed(() => layer.value?.transform || {})
// Media types whose fill is driven by the maintainRatio toggle.
const isMedia = computed(() => ['image', 'gif', 'video', 'emote', 'youtube'].includes(layer.value?.type))
function set(key, value) { scene.updateLayer(layer.value.id, { [key]: value }) }
function setT(key, value) { scene.updateLayer(layer.value.id, { transform: { ...layer.value.transform, [key]: value } }) }
function apply(newTransform) { scene.updateLayer(layer.value.id, { transform: newTransform }) }
function startTimer() {
  const l = layer.value
  if (!l || l.type !== 'timer') return
  const secs = Math.max(1, Math.floor(Number(l.timerSeconds) || 300))
  scene.updateLayer(l.id, { timerSeconds: secs, timerEndsAt: Date.now() + secs * 1000 })
}
function resetTimer() {
  const l = layer.value
  if (!l || l.type !== 'timer') return
  scene.updateLayer(l.id, { timerEndsAt: null })
}
function bumpCounter(delta) {
  const l = layer.value
  if (!l || l.type !== 'counter') return
  scene.updateLayer(l.id, { counterValue: Math.floor(Number(l.counterValue) || 0) + delta })
}

const browserCfg = computed(() => {
  const l = layer.value
  if (!l) return {}
  return l.type === 'chatis' ? (l.chatis || {}) : (l.browser || {})
})
function setBrowserField(key, value) {
  const l = layer.value
  if (!l) return
  if (l.type === 'chatis') {
    const chatis = { ...l.chatis, [key]: value }
    if (key === 'channel') {
      chatis.url = buildChatisUrlFromConfig(defaultChatisConfig(String(value).trim()))
    }
    scene.updateLayer(l.id, { chatis })
  } else {
    scene.updateLayer(l.id, { browser: { ...defaultBrowserConfig(l.browser || {}), [key]: value } })
  }
}
/** OBS Width/Height also resize the stage transform box. */
function setBrowserSize(dim, value) {
  const l = layer.value
  if (!l) return
  const n = Math.max(50, Number(value) || 50)
  const key = l.type === 'chatis' ? 'chatis' : 'browser'
  const cfg = { ...(l[key] || {}), [dim]: n }
  const transform = {
    ...l.transform,
    ...(dim === 'width' ? { w: n } : { h: n })
  }
  scene.updateLayer(l.id, { [key]: cfg, transform })
}
function refreshBrowser() {
  const l = layer.value
  if (!l) return
  const key = l.type === 'chatis' ? 'chatis' : 'browser'
  const cfg = { ...(l[key] || {}), refreshKey: ((l[key]?.refreshKey) || 0) + 1 }
  scene.updateLayer(l.id, { [key]: cfg })
}
function setMultiUrls(raw) {
  const l = layer.value
  if (!l || l.type !== 'multiBrowser') return
  const urls = String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  scene.updateLayer(l.id, {
    multiBrowser: defaultMultiBrowserConfig({ ...(l.multiBrowser || {}), urls })
  })
}
function setMultiField(key, value) {
  const l = layer.value
  if (!l || l.type !== 'multiBrowser') return
  scene.updateLayer(l.id, {
    multiBrowser: defaultMultiBrowserConfig({ ...(l.multiBrowser || {}), [key]: value })
  })
}
function setMultiSize(dim, value) {
  const l = layer.value
  if (!l || l.type !== 'multiBrowser') return
  const n = Math.max(50, Number(value) || 50)
  const multiBrowser = defaultMultiBrowserConfig({ ...(l.multiBrowser || {}), [dim]: n })
  const transform = {
    ...l.transform,
    ...(dim === 'width' ? { w: n } : { h: n })
  }
  scene.updateLayer(l.id, { multiBrowser, transform })
}
function refreshMulti() {
  const l = layer.value
  if (!l || l.type !== 'multiBrowser') return
  scene.updateLayer(l.id, {
    multiBrowser: defaultMultiBrowserConfig({
      ...(l.multiBrowser || {}),
      refreshKey: ((l.multiBrowser?.refreshKey) || 0) + 1
    })
  })
}

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
  height: 100%;
}
.head { padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--border); }
.body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.body::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.empty { padding: 16px; font-size: 13px; }
fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
legend { font-size: 12px; color: var(--text-dim); padding: 0 4px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
label.row { flex-direction: row; align-items: center; gap: 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.btn-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
.btn-grid-wide { grid-template-columns: repeat(2, 1fr); }
.btn-grid :deep(button) { min-width: 0; }
.keep-row { margin-top: 8px; }
.keep-row small { font-size: 10px; }
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
.browser-props textarea { width: 100%; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.browser-actions { grid-template-columns: 1fr; }
.browser-actions .open-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
  font-size: 12px;
  color: var(--accent, #3b82f6);
}
.hint { margin: 0 0 6px; }
.small { font-size: 11px; }
</style>
