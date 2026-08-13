<script setup>
import { ContextMenuTrigger } from 'reka-ui'
</script>

<template>
  <ContextMenuTrigger v-bind="$attrs" as-child>
    <slot />
  </ContextMenuTrigger>
</template>
