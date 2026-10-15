<script setup>
import { computed, ref } from 'vue'
import HubIcon from './HubIcon.vue'
import AssetIcon from './AssetIcon.vue'

const props = defineProps({ modules: { type: Array, default: () => [] }, recentIds: { type: Array, default: () => [] } })
const emit = defineEmits(['select'])
const query = ref(''), category = ref('全部')
const categories = computed(() => ['全部', ...new Set(props.modules.map((module) => module.category || '其他'))])
const recentModules = computed(() => props.recentIds.map((id) => props.modules.find((module) => module.id === id)).filter(Boolean).slice(0, 4))
const filteredModules = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return props.modules.filter((module) => (category.value === '全部' || (module.category || '其他') === category.value)
    && (!term || `${module.title} ${module.subtitle || ''} ${module.description || ''} ${module.category || ''}`.toLocaleLowerCase().includes(term)))
})
</script>

<template>
  <div class="module-gallery">
    <section v-if="recentModules.length" class="module-section recent-section">
      <div class="module-section-heading"><h2>最近使用</h2><span>最近打开的模块</span></div>
      <div class="recent-modules">
        <button v-for="module in recentModules" :key="module.id" class="recent-module" @click="emit('select', module.id)">
          <span class="module-icon" :class="module.color"><AssetIcon v-if="module.iconAsset" :name="module.iconAsset" :size="20" /><HubIcon v-else :name="module.icon" :size="19" /></span>
          <span class="module-card-copy"><strong>{{ module.title }}</strong><small>{{ module.subtitle || module.category || '工作区模块' }}</small></span>
          <span class="recent-arrow" aria-hidden="true"><AssetIcon name="箭头-右" :size="14" /></span>
        </button>
      </div>
    </section>

    <section class="module-section catalog-section">
      <div class="module-section-heading catalog-heading"><div><h1>工作区模块</h1></div>
        <label class="module-search"><HubIcon name="search" :size="16" /><input v-model="query" type="search" aria-label="搜索模块" placeholder="搜索模块" /></label>
      </div>
      <div class="module-toolbar"><div class="module-categories" role="tablist" aria-label="模块分类"><span class="module-filter-icon" title="按分类筛选"><AssetIcon name="筛选" :size="14" /></span>
        <button v-for="item in categories" :key="item" type="button" role="tab" :aria-selected="category === item" :class="{ active: category === item }" @click="category = item">{{ item }}</button>
      </div><span class="module-count">{{ filteredModules.length }} 个模块</span></div>

      <div v-if="filteredModules.length" class="module-grid">
        <button v-for="module in filteredModules" :key="module.id" class="module-card" @click="emit('select', module.id)">
          <span class="module-card-heading"><span class="module-icon" :class="module.color"><AssetIcon v-if="module.iconAsset" :name="module.iconAsset" :size="21" /><HubIcon v-else :name="module.icon" :size="20" /></span><span class="module-card-copy"><strong>{{ module.title }}</strong><small>{{ module.subtitle || module.category || '工作区模块' }}</small></span></span>
          <span class="module-description">{{ module.description || '打开模块，查看和管理相关工作区信息。' }}</span>
          <span class="module-card-footer"><span>{{ module.category || '其他' }}</span><span>{{ module.pluginId ? '插件模块' : '中控模块' }}</span></span>
        </button>
      </div>
      <div v-else class="module-empty">{{ query ? '没有匹配的模块，试试其他关键词。' : '此分类暂时没有模块。' }}</div>
    </section>
  </div>
</template>
