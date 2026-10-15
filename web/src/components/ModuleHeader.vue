<script setup>
import AssetIcon from './AssetIcon.vue'
import HubIcon from './HubIcon.vue'
import ModuleInfoDialog from './ModuleInfoDialog.vue'
import { ref } from 'vue'

const props = defineProps({ title: { type: String, required: true }, info: { type: Object, default: null } })
defineEmits(['back'])
const showInfo = ref(false)
</script>

<template>
  <header class="module-header">
    <button class="module-header-back" type="button" aria-label="返回" title="返回" @click="$emit('back')"><AssetIcon name="箭头-左" :size="17" /></button>
    <h1>{{ props.title }}</h1>
    <div class="module-header-actions"><slot name="actions" /><button v-if="props.info" class="module-info-button" type="button" :aria-label="`${props.title}模块说明`" :title="`${props.title}模块说明`" @click="showInfo = true"><HubIcon name="info" :size="17" /></button></div>
  </header>
  <ModuleInfoDialog v-if="showInfo && props.info" :title="props.title" :info="props.info" @close="showInfo = false" />
</template>
