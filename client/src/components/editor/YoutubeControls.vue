<!--
  YoutubeControls.vue — compatibility shim.
  The moderator player was rewritten as YoutubePlayer.vue; keep this file so
  any leftover imports still resolve.
-->
<template>
  <YoutubePlayer :layer="layer" />
</template>

<script setup>
import YoutubePlayer from './YoutubePlayer.vue'
defineProps({ layer: Object })
</script>
