<script setup>
import { useI18n } from '@/i18n'
import { Upload } from '@lucide/vue'

defineProps({
  active: { type: Boolean, default: false },
  fileCount: { type: Number, default: 0 }
})

const { t } = useI18n()
</script>

<template>
  <Transition name="fluent-panel">
    <div v-if="active" class="dnd-ghost" aria-hidden="true">
      <div class="dnd-ghost-card">
        <Upload class="h-8 w-8" />
        <span>{{ t('dnd.drop') }}</span>
        <span v-if="fileCount > 0" class="dnd-ghost-count">{{ fileCount }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.dnd-ghost {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--fluent-accent) 14%, transparent);
  border: 2px dashed var(--fluent-accent);
}
.dnd-ghost-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 36px;
  border-radius: 12px;
  background: var(--fluent-acrylic);
  border: 1px solid var(--fluent-stroke);
  box-shadow: var(--fluent-elevation);
  backdrop-filter: blur(18px);
  color: var(--text);
  font-weight: 600;
  font-size: 15px;
}
.dnd-ghost-count {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 500;
}
</style>
