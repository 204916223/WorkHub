<script setup>
import { computed } from 'vue'

const props = defineProps({ name: { type: String, required: true }, size: { type: Number, default: 18 } })
const assets = import.meta.glob('../assets/icons/*.svg', { eager: true, query: '?raw', import: 'default' })
const source = computed(() => assets[`../assets/icons/${props.name}.svg`] || '')
</script>

<template><span class="asset-icon" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" v-html="source" /></template>

<style scoped>
.asset-icon { display: inline-grid; flex: 0 0 auto; place-items: center; line-height: 0; }
.asset-icon :deep(svg) { display: block; width: 100%; height: 100%; }
</style>
