<!--
  TwitchChat.vue
  Opens Twitch popout chat. In Electron, main process injects BTTV + FFZ (+ 7TV via BTTV).
-->
<template>
  <div class="tc-panel" :class="{ embedded }" v-if="open">
    <div v-if="!embedded" class="fluent-panel-head">
      <span class="fluent-panel-title">
        <MessageSquare class="h-4 w-4" />
        Twitch Chat
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" title="Close" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <div class="tc-body">
      <div class="tc-form">
        <h3>Open Twitch Chat</h3>
        <p class="muted small">
          Opens popout chat in a separate app window.
          <template v-if="isElectron">
            BetterTTV + FrankerFaceZ are injected automatically; 7TV emotes via BTTV.
          </template>
          <template v-else>
            Install BTTV / FFZ / 7TV browser extensions for emotes (desktop app injects them).
          </template>
        </p>
        <div class="tc-input-row">
          <Input
            v-model="channel"
            class="tc-channel-input"
            placeholder="channel name (e.g. aptixtw)"
            @keydown.enter="openChat"
          />
          <Button :disabled="!channel.trim()" @click="openChat">
            <ExternalLink class="h-4 w-4" />
            Open Chat
          </Button>
        </div>
        <div v-if="chatUrl" class="tc-current">
          <span class="muted small">Last opened:</span>
          <a :href="chatUrl" @click.prevent="openChat" class="tc-link">{{ chatUrl }}</a>
        </div>
        <div v-if="error" class="tc-error">{{ error }}</div>
        <p v-if="isElectron" class="tc-badge">Emotes: BTTV · FFZ · 7TV (app chat window)</p>
      </div>

      <div class="tc-tips">
        <h4>Tips</h4>
        <ul>
          <li>Emotes appear in the <strong>app chat window</strong> after it loads (not in a docked iframe).</li>
          <li>Log in to Twitch in that window for mod tools.</li>
          <li>Pastes live under <strong>Вставки</strong> — not inside Twitch hub.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { MessageSquare, X, ExternalLink } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

defineProps({
  open: { type: Boolean, default: false },
  embedded: { type: Boolean, default: false }
})
defineEmits(['close'])

const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')
const channel = ref('')
const chatUrl = ref('')
const error = ref('')

onMounted(() => {
  const saved = localStorage.getItem('omo_twitch_channel')
  if (saved) {
    channel.value = saved
    chatUrl.value = `https://www.twitch.tv/popout/${saved}/chat?popout=`
  }
})

function openChat() {
  const ch = channel.value.trim().replace(/^#/, '').toLowerCase()
  if (!ch) {
    error.value = 'Enter a channel name.'
    return
  }
  error.value = ''
  const url = `https://www.twitch.tv/popout/${ch}/chat?popout=`
  chatUrl.value = url
  localStorage.setItem('omo_twitch_channel', ch)

  // Electron: setWindowOpenHandler → dedicated BrowserWindow + emote inject.
  const w = 420
  const h = 800
  const left = window.screen.width - w - 20
  const top = 80
  window.open(
    url,
    'twitch_chat_' + ch,
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  )
}
</script>

<style scoped>
.tc-panel {
  position: fixed;
  top: 50px;
  right: 12px;
  width: 380px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 99;
  overflow: hidden;
}
.tc-panel.embedded {
  position: relative;
  top: auto;
  right: auto;
  width: 100%;
  z-index: auto;
  border-radius: 0;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none;
}
.tc-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.tc-form h3 { margin: 0 0 8px; font-size: 16px; }
.tc-input-row {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.tc-channel-input { flex: 1; }
.tc-current {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.tc-link {
  font-size: 11px;
  color: var(--fluent-accent);
  word-break: break-all;
}
.tc-error { color: var(--danger); font-size: 12px; margin-top: 8px; }
.tc-badge {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--ok, #3dd68c);
}
.tc-tips {
  padding: 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-3) 50%, transparent);
  border: 1px solid var(--fluent-stroke);
}
.tc-tips h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
.tc-tips ul { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; color: var(--text-dim); }
.small { font-size: 12px; }
</style>
