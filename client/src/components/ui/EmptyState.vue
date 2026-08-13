<script setup>
import { Inbox, Loader2, WifiOff, AlertTriangle } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

defineProps({
  variant: { type: String, default: 'empty' }, // empty | loading | error | offline
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  class: { type: [String, Array, Object], default: undefined }
})

const { t } = useI18n()

const icons = { empty: Inbox, loading: Loader2, error: AlertTriangle, offline: WifiOff }
</script>

<template>
  <div
    :class="cn(
      'flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-[var(--text-dim)]',
      $props.class
    )"
    role="status"
  >
    <component
      :is="icons[variant] || Inbox"
      :class="cn('h-8 w-8 opacity-70', variant === 'loading' && 'animate-spin text-[var(--fluent-accent)]')"
    />
    <p class="m-0 font-medium text-[var(--text)]">
      {{ title || (variant === 'loading' ? t('loading.generic') : variant === 'error' ? t('error.generic') : variant === 'offline' ? t('status.offline') : t('empty.generic')) }}
    </p>
    <p v-if="description" class="m-0 max-w-[240px] text-xs">{{ description }}</p>
    <div v-if="$slots.default" class="mt-1"><slot /></div>
  </div>
</template>
