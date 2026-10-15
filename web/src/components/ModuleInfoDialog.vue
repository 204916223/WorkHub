<script setup>
import { onMounted, onUnmounted } from 'vue'
import AssetIcon from './AssetIcon.vue'

defineProps({ title: { type: String, required: true }, info: { type: Object, required: true } })
const emit = defineEmits(['close'])
function onKeydown(event) { if (event.key === 'Escape') emit('close') }
const sectionIcons = { '源': '关联', '映': '信息-圈', '规': '设置', '!': '感叹号-三角框' }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="module-info-backdrop" @click.self="emit('close')">
    <section class="module-info-dialog" role="dialog" aria-modal="true" aria-labelledby="module-info-title">
      <header class="module-info-dialog-header"><div><span class="module-info-eyebrow">模块说明</span><h2 id="module-info-title">{{ title }}</h2></div><button type="button" class="module-info-close" aria-label="关闭说明" @click="emit('close')"><AssetIcon name="关闭" :size="17" /></button></header>
      <div class="module-info-dialog-body">
        <p v-if="info.summary" class="module-info-summary">{{ info.summary }}</p>
        <section v-for="section in info.sections || []" :key="section.title" class="module-info-section">
          <h3><span><AssetIcon :name="sectionIcons[section.icon] || '信息-圈'" :size="14" /></span>{{ section.title }}</h3>
          <ul v-if="section.items?.length"><li v-for="(item, index) in section.items" :key="index"><strong v-if="typeof item === 'object'">{{ item.label }}</strong><span>{{ typeof item === 'string' ? item : item.text }}</span><code v-if="typeof item === 'object' && item.code">{{ item.code }}</code></li></ul>
          <p v-else>{{ section.text }}</p>
        </section>
        <p v-if="info.disclaimer" class="module-info-disclaimer">{{ info.disclaimer }}</p>
      </div>
      <footer class="module-info-dialog-footer"><span>说明随模块版本维护；数据更新时间以模块页面展示为准。</span></footer>
    </section>
  </div>
</template>
