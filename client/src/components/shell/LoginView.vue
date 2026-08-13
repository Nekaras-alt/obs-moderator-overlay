<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { Copy, Check, Radio } from '@lucide/vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  pinConfirm: { type: String, default: '' },
  error: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  /** First-run: streamer creates PIN instead of logging in. */
  needsSetup: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'update:pinConfirm', 'submit'])
const { t } = useI18n()

const pin = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})
const confirm = computed({
  get: () => props.pinConfirm,
  set: (v) => emit('update:pinConfirm', v)
})

const serverOk = ref(null)
const preferredHost = ref('localhost')
const port = ref(location.port || '8090')
const copied = ref('')
let timer = null

const editorUrl = computed(() => `${location.protocol}//${preferredHost.value}:${port.value}/`)
const qrUrl = computed(() =>
  `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(editorUrl.value)}`
)

async function refreshNet() {
  try {
    const hello = await fetch('/api/hello').then((r) => r.json())
    serverOk.value = !!hello?.ok
  } catch (_) {
    serverOk.value = false
  }
  try {
    const info = await fetch('/api/network-info').then((r) => r.json())
    if (info?.preferredHost) preferredHost.value = info.preferredHost
    if (info?.port) port.value = String(info.port)
    else if (location.port) port.value = location.port
  } catch (_) { /* keep */ }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(editorUrl.value)
    copied.value = 'ok'
    setTimeout(() => { copied.value = '' }, 1500)
  } catch (_) { /* ignore */ }
}

onMounted(() => {
  refreshNet()
  timer = setInterval(refreshNet, 8000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div
    :class="cn(
      'flex h-full items-center justify-center p-4',
      'bg-[radial-gradient(1200px_600px_at_10%_-10%,rgba(0,120,212,.22),transparent_55%),radial-gradient(900px_500px_at_90%_110%,rgba(14,165,233,.12),transparent_50%),var(--bg)]'
    )"
  >
    <form
      class="fluent-login-card w-[min(400px,94vw)] animate-in fade-in-0 zoom-in-95 duration-300 flex flex-col gap-3 rounded-lg border border-[var(--fluent-stroke)] bg-[var(--fluent-acrylic)] p-7 shadow-[var(--fluent-elevation)] backdrop-blur-xl"
      :aria-label="needsSetup ? t('login.setupTitle') : t('login.connect')"
      @submit.prevent="emit('submit')"
    >
      <div class="flex items-start gap-3">
        <img
          src="/icon.png"
          alt=""
          class="h-12 w-12 shrink-0 rounded-lg object-contain"
          @error="($event.target.style.display='none')"
        />
        <div class="min-w-0 space-y-1 flex-1">
          <h1 class="m-0 text-[22px] font-semibold tracking-tight text-[var(--text)]">
            {{ t('app.title') }}
          </h1>
          <p class="m-0 text-sm text-[var(--text-dim)]">
            {{ needsSetup ? t('login.setupSubtitle') : t('login.subtitle') }}
          </p>
          <p class="m-0 flex items-center gap-1.5 text-xs" :class="serverOk === false ? 'text-[var(--danger)]' : 'text-[var(--ok)]'">
            <Radio class="h-3 w-3" />
            <template v-if="serverOk === null">{{ t('loading.generic') }}</template>
            <template v-else-if="serverOk">{{ t('login.serverOnline') }}</template>
            <template v-else>{{ t('login.serverOffline') }}</template>
          </p>
        </div>
      </div>

      <Input
        v-model="pin"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="needsSetup ? t('login.setupPinPlaceholder') : 'PIN'"
        class="h-11 text-center text-lg tracking-[0.35em]"
        autofocus
      />
      <Input
        v-if="needsSetup"
        v-model="confirm"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('login.setupConfirmPlaceholder')"
        class="h-11 text-center text-lg tracking-[0.35em]"
      />
      <Button type="submit" class="h-10 w-full" :disabled="busy">
        {{ needsSetup ? t('login.setupSubmit') : t('login.connect') }}
      </Button>
      <p v-if="error" class="m-0 text-center text-sm text-[var(--danger)]">{{ error }}</p>
      <p v-if="needsSetup" class="m-0 text-center text-xs text-[var(--text-dim)]">
        {{ t('login.setupHint') }}
      </p>

      <div v-if="!needsSetup" class="mt-1 flex gap-3 rounded-md border border-[var(--fluent-stroke)] bg-[var(--bg)]/40 p-3">
        <img
          :src="qrUrl"
          width="140"
          height="140"
          alt="QR"
          class="h-[100px] w-[100px] shrink-0 rounded bg-white p-1"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <span class="text-xs font-medium text-[var(--text)]">{{ t('login.modUrl') }}</span>
          <code class="break-all text-[11px] text-[var(--text-dim)]">{{ editorUrl }}</code>
          <Button type="button" size="sm" variant="secondary" class="h-8 w-fit gap-1" @click="copyUrl">
            <Check v-if="copied" class="h-3.5 w-3.5" />
            <Copy v-else class="h-3.5 w-3.5" />
            {{ copied ? t('login.copied') : t('login.copyUrl') }}
          </Button>
        </div>
      </div>

      <p v-if="!needsSetup" class="m-0 text-center text-xs text-[var(--text-dim)]">
        {{ t('login.hint') }}
      </p>
    </form>
  </div>
</template>
