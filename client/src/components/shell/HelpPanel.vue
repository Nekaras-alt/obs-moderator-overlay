<script setup>
import { computed, ref, watch } from 'vue'
import { BookOpen, GraduationCap } from '@lucide/vue'
import AppPanel from './AppPanel.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { helpContent } from '@/i18n/help.js'
import { useUiPrefs } from '@/features/uiPrefs.js'

const props = defineProps({
  open: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'start-tour'])

const { t, locale } = useI18n()
const { isPinned, togglePinned } = useUiPrefs()
const tab = ref('guide')
const query = ref('')
const topicId = ref('canvas')

const pack = computed(() => helpContent(locale.value))
const q = computed(() => query.value.trim().toLowerCase())

const topics = computed(() => {
  const list = pack.value.topics || []
  if (!q.value) return list
  return list.filter((item) => matches(item.title, item.body))
})
const faqs = computed(() => {
  const list = pack.value.faq || []
  if (!q.value) return list
  return list.filter((item) => matches(item.q, item.a))
})
const topic = computed(() => {
  const list = topics.value
  return list.find((x) => x.id === topicId.value) || list[0] || null
})

function matches(title, body) {
  const blob = [title, Array.isArray(body) ? body.join(' ') : body].join(' ').toLowerCase()
  return blob.includes(q.value)
}

watch(topics, (list) => {
  if (!list.length) return
  if (!list.some((x) => x.id === topicId.value)) topicId.value = list[0].id
})
watch(() => props.open, (v) => {
  if (v) {
    query.value = ''
    tab.value = 'guide'
  }
})
</script>

<template>
  <AppPanel
    :open="open"
    :title="t('help.title')"
    width="480px"
    panel-id="help"
    :pinned="isPinned('help')"
    body-class="help-scroll min-h-0 flex-1 overflow-hidden p-0"
    :padded="false"
    @close="emit('close')"
    @toggle-pin="togglePinned('help')"
  >
    <template #icon>
      <BookOpen class="h-4 w-4" />
    </template>
    <template #actions>
      <Button size="sm" variant="secondary" class="h-7 gap-1" @click="emit('start-tour')">
        <GraduationCap class="h-3.5 w-3.5" />
        {{ t('help.startTour') }}
      </Button>
    </template>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="px-3 pt-3">
        <Input v-model="query" class="h-8" :placeholder="t('help.search')" />
      </div>
      <Tabs v-model="tab" class="mt-1 min-h-0 flex-1 overflow-hidden">
        <TabsList>
          <TabsTrigger value="guide">{{ t('help.tab.guide') }}</TabsTrigger>
          <TabsTrigger value="faq">{{ t('help.tab.faq') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="guide" class="help-body">
          <div v-if="!topics.length" class="muted text-sm">{{ t('help.empty') }}</div>
          <template v-else>
            <div class="help-toc">
              <button
                v-for="item in topics"
                :key="item.id"
                type="button"
                class="help-toc-btn"
                :class="{ active: topic?.id === item.id }"
                @click="topicId = item.id"
              >{{ item.title }}</button>
            </div>
            <article v-if="topic" class="help-article">
              <h3>{{ topic.title }}</h3>
              <p v-for="(p, i) in topic.body" :key="i">{{ p }}</p>
            </article>
          </template>
        </TabsContent>
        <TabsContent value="faq" class="help-body">
          <div v-if="!faqs.length" class="muted text-sm">{{ t('help.empty') }}</div>
          <details v-for="item in faqs" :key="item.id" class="help-faq">
            <summary>{{ item.q }}</summary>
            <p>{{ item.a }}</p>
          </details>
        </TabsContent>
      </Tabs>
    </div>
  </AppPanel>
</template>

<style scoped>
.help-scroll {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.help-body {
  padding: 10px 12px 14px;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  flex: 1;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.help-body::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.help-toc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.help-toc-btn {
  border: 1px solid var(--fluent-stroke);
  background: var(--bg);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.help-toc-btn.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--fluent-accent) 45%, transparent);
  background: color-mix(in srgb, var(--fluent-accent) 16%, transparent);
}
.help-article h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.help-article p {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim);
}
.help-faq {
  border: 1px solid var(--fluent-stroke);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--fluent-layer, var(--bg-2));
}
.help-faq summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.help-faq p {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-dim);
}
</style>
