<script setup>
import { DropdownMenuTrigger } from 'reka-ui'
</script>

<template>
  <DropdownMenuTrigger v-bind="$attrs" as-child>
    <slot />
  </DropdownMenuTrigger>
</template>
