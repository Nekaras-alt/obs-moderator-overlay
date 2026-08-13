<!--
  ChatIS setup wizard — Fluent Dialog (Phase 2).
  On confirm: builds v2 widget URL, copies it, emits config for Browser Source layer.
-->
<template>
  <Dialog
    :open="open"
    title="ChatIS Chat"
    description="Параметры как на is2511.com — создаст слой Browser Source"
    class="!w-[min(640px,96vw)] !max-h-[min(860px,calc(100vh-32px))]"
    @update:open="(v) => { if (!v) $emit('cancel') }"
  >
    <div class="body">
      <section class="sec">
        <h3>Channel</h3>
        <label class="field">
          <span>Twitch channel</span>
          <Input v-model="form.channel" placeholder="channel" autocomplete="off" @keydown.enter.prevent="onConfirm" />
        </label>
      </section>

      <section class="sec">
        <h3>Appearance</h3>
        <div class="cols">
          <label class="field">
            <span>Font size</span>
            <select v-model="form.size">
              <option v-for="s in CHATIS_SIZES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>Font</span>
            <select v-model="form.font">
              <option v-for="f in CHATIS_FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </label>
          <label v-if="form.font === '0'" class="field full">
            <span>Custom font name</span>
            <Input v-model="form.fontCustom" placeholder="Font Family" />
          </label>
          <label class="field">
            <span>Stroke</span>
            <select v-model="form.stroke">
              <option v-for="s in CHATIS_STROKES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>Shadow</span>
            <select v-model="form.shadow">
              <option v-for="s in CHATIS_SHADOWS" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>Emote scale (0–3)</span>
            <input v-model="form.emoteScale" type="number" min="0" max="3" step="0.1" placeholder="default" />
          </label>
        </div>
      </section>

      <section class="sec">
        <h3>Behavior</h3>
        <div class="checks">
          <label class="check"><input v-model="form.animate" type="checkbox" /><span>Animate</span></label>
          <label class="check"><input v-model="form.bots" type="checkbox" /><span>Show bots</span></label>
          <label class="check"><input v-model="form.fade" type="checkbox" /><span>Fade out messages</span></label>
          <label class="check"><input v-model="form.smallCaps" type="checkbox" /><span>Small caps</span></label>
          <label class="check"><input v-model="form.nlAfterName" type="checkbox" /><span>New line after name</span></label>
          <label class="check"><input v-model="form.hideNames" type="checkbox" /><span>Hide names</span></label>
          <label class="check"><input v-model="form.hideSpecialBadges" type="checkbox" /><span>Hide special badges</span></label>
          <label class="check"><input v-model="form.showHomies" type="checkbox" :disabled="form.hideSpecialBadges" /><span>Show Homies</span></label>
          <label class="check"><input v-model="form.markdown" type="checkbox" /><span>Markdown</span></label>
        </div>
        <div class="cols" style="margin-top:10px">
          <label class="field">
            <span>Fade out (seconds)</span>
            <input v-model.number="form.fadeSeconds" type="number" min="1" :disabled="!form.fade" />
          </label>
          <label class="field full">
            <span>Extra bot names</span>
            <Input v-model="form.botNames" placeholder="nightbot, streamelements" />
          </label>
        </div>
      </section>

      <section class="sec">
        <h3>Browser Source size</h3>
        <div class="cols">
          <label class="field">
            <span>Width (px)</span>
            <input v-model.number="form.width" type="number" min="100" max="1920" />
          </label>
          <label class="field">
            <span>Height (px)</span>
            <input v-model.number="form.height" type="number" min="100" max="1080" />
          </label>
        </div>
      </section>

      <section class="sec">
        <h3>Generated URL</h3>
        <div class="url-row">
          <input class="url-out" :value="previewUrl" readonly :placeholder="previewUrl ? '' : 'Enter a channel…'" />
          <Button type="button" variant="secondary" size="sm" :disabled="!previewUrl" @click="copyUrl">Copy</Button>
        </div>
        <p v-if="copied" class="copied">URL copied to clipboard</p>
      </section>
    </div>

    <template #footer>
      <Button type="button" variant="secondary" @click="$emit('cancel')">Cancel</Button>
      <Button type="button" :disabled="!previewUrl" @click="onConfirm">Create Browser Source</Button>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  CHATIS_FONTS,
  CHATIS_SHADOWS,
  CHATIS_SIZES,
  CHATIS_STROKES,
  buildChatisUrl,
  defaultChatisConfig
} from '@shared/chatis.js'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const props = defineProps({
  open: { type: Boolean, default: false },
  defaultChannel: { type: String, default: '' }
})
const emit = defineEmits(['confirm', 'cancel'])

const form = reactive(defaultChatisConfig())
const copied = ref(false)

watch(() => props.open, (v) => {
  if (!v) return
  Object.assign(form, defaultChatisConfig(props.defaultChannel || ''))
  copied.value = false
})

const previewUrl = computed(() => buildChatisUrl(form))

async function copyUrl() {
  const url = previewUrl.value
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch (_) { /* ignore */ }
}

async function onConfirm() {
  const url = previewUrl.value
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
  } catch (_) { /* ignore */ }
  emit('confirm', { ...form })
}
</script>

<style scoped>
.body { display: flex; flex-direction: column; gap: 14px; }
.sec h3 {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.field > span { color: var(--text-dim); font-size: 11px; font-weight: 600; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.field.full { grid-column: 1 / -1; }
.checks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}
.check input { width: 15px; height: 15px; margin: 0; }
.url-row { display: flex; gap: 8px; align-items: stretch; }
.url-out {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--fluent-stroke);
  background: var(--bg);
  color: var(--text-dim);
}
.copied { margin: 6px 0 0; font-size: 12px; color: var(--ok); }
</style>
