<script setup>
import { TooltipTrigger } from 'reka-ui'
</script>

<template>
  <TooltipTrigger v-bind="$attrs" as-child>
    <slot />
  </TooltipTrigger>
</template>
