<script setup>
import { computed } from 'vue'

const props = defineProps({
  as: { type: String, default: 'div' },
  axis: { type: String, default: 'y', validator: (value) => ['x', 'y', 'both'].includes(value) },
})
const axisClass = computed(() => `ui-scroll-area--${props.axis}`)
</script>

<template>
  <component :is="as" :class="['ui-scroll-area', axisClass]"><slot /></component>
</template>

<style scoped>
.ui-scroll-area {
  min-width: 0;
  min-height: 0;
  scrollbar-color: var(--scroll-thumb, #414349) transparent;
  scrollbar-gutter: stable both-edges;
  scrollbar-width: thin;
  overscroll-behavior: contain;
}
.ui-scroll-area--y { overflow-x: hidden; overflow-y: auto; }
.ui-scroll-area--x { overflow-x: auto; overflow-y: hidden; }
.ui-scroll-area--both { overflow: auto; }
</style>
