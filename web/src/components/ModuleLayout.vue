<script setup>
import ModuleHeader from './ModuleHeader.vue'
import { UiScrollArea } from './ui/index.js'

defineProps({ title: { type: String, required: true }, info: { type: Object, default: null } })
defineEmits(['back'])
</script>

<template>
  <section class="module-layout">
    <ModuleHeader :title="title" :info="info" @back="$emit('back')"><template #actions><slot name="actions" /></template></ModuleHeader>
    <UiScrollArea class="module-layout-content"><slot /></UiScrollArea>
  </section>
</template>

<style scoped>
.module-layout { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
</style>
