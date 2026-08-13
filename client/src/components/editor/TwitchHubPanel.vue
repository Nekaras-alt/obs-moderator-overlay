<!--
  TwitchHubPanel — Chat | Stream (Pastes lives in its own panel "Вставки").
-->
<template>
  <div v-if="open" class="thub-panel panel">
    <div class="fluent-panel-head">
      <span class="fluent-panel-title">
        <MessageSquare class="h-4 w-4" />
        Twitch
      </span>
      <span class="spacer"></span>
      <Button variant="ghost" size="icon" class="h-7 w-7" title="Close" @click="$emit('close')">
        <X class="h-4 w-4" />
      </Button>
    </div>

    <Tabs v-model="tab" class="thub-tabs">
      <TabsList>
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="stream">Stream</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" class="thub-tab">
        <TwitchChat :open="true" embedded @close="$emit('close')" />
      </TabsContent>
      <TabsContent value="stream" class="thub-tab">
        <TwitchStream :channel="channel" :open="true" embedded @close="$emit('close')" />
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { MessageSquare, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import TwitchChat from './TwitchChat.vue'
import TwitchStream from './TwitchStream.vue'

defineProps({
  open: { type: Boolean, default: false },
  channel: { type: String, default: '' }
})
defineEmits(['close'])

const tab = ref('chat')
</script>

<style scoped>
.thub-panel {
  position: absolute;
  top: 52px;
  right: 16px;
  width: 420px;
  max-height: calc(100% - 80px);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  z-index: 40;
  overflow: hidden;
}
.thub-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.thub-tab {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
</style>
