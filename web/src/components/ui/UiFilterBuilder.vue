<script setup>
import { computed } from 'vue'
import AssetIcon from '../AssetIcon.vue'
import UiFilterCondition from './UiFilterCondition.vue'
import UiSelect from './UiSelect.vue'

const props = defineProps({ fields: { type: Array, default: () => [] }, filters: { type: Array, default: () => [] } })
const emit = defineEmits(['update:filters'])
const activeCount = computed(() => {
  const count = (items) => items.reduce((sum, item) => sum + (item?.type === 'group' ? count(item.rules || []) : (item?.operator === 'is_empty' || item?.operator === 'is_not_empty' || String(item?.value ?? '').trim() ? 1 : 0)), 0)
  return count(props.filters)
})
function newRule() { const field = props.fields[0]; return field ? { field: field.key, operator: field.type === 'date' ? 'equals' : field.type === 'number' || field.type === 'select' ? 'equals' : 'contains', value: '', conjunction: 'and' } : null }
function patchAt(items, path, patch) {
  return items.map((item, index) => {
    if (index !== path[0]) return item
    if (path.length === 1) return { ...item, ...patch }
    return { ...item, rules: patchAt(item.rules || [], path.slice(1), patch) }
  })
}
function removeAt(items, path) {
  if (path.length === 1) return items.filter((_, index) => index !== path[0])
  return items.map((item, index) => index === path[0] ? { ...item, rules: removeAt(item.rules || [], path.slice(1)) } : item)
}
function update(path, patch) { emit('update:filters', patchAt(props.filters, path, patch)) }
function remove(path) { emit('update:filters', removeAt(props.filters, path)) }
function addCondition() { const rule = newRule(); if (rule) emit('update:filters', [...props.filters, rule]) }
function addGroup() { const rule = newRule(); if (rule) emit('update:filters', [...props.filters, { type: 'group', conjunction: 'and', rules: [{ ...rule }] }]) }
function addToGroup(index) { const rule = newRule(); if (rule) emit('update:filters', patchAt(props.filters, [index], { rules: [...(props.filters[index].rules || []), rule] })) }
function clear() { emit('update:filters', []) }
function joinOptions() { return [{ value: 'and', label: '且' }, { value: 'or', label: '或' }] }
</script>

<template>
  <section class="ui-filter-builder">
    <header><strong>筛选</strong><span>逐条设置条件，或用条件组组合范围</span></header>
    <div v-if="props.filters.length" class="ui-filter-root">
      <template v-for="(item, index) in props.filters" :key="item.id || `filter-${index}`">
        <UiFilterCondition v-if="item.type !== 'group'" :rule="item" :fields="props.fields" :first="index === 0" @change="update([index], $event)" @remove="remove([index])" />
        <section v-else class="ui-filter-group">
          <header class="ui-filter-group-heading">
            <span v-if="index === 0" class="ui-filter-join-label">当</span>
            <UiSelect v-else :model-value="item.conjunction || 'and'" :options="joinOptions()" size="small" aria-label="条件组与上一项的关系" @update:model-value="update([index], { conjunction: $event })" />
            <strong>条件组</strong><span>组内按每条条件的“且 / 或”连接</span>
            <button type="button" aria-label="删除条件组" @click="remove([index])"><AssetIcon name="删除" :size="14" /></button>
          </header>
          <div class="ui-filter-group-rules"><UiFilterCondition v-for="(rule, ruleIndex) in item.rules" :key="rule.id || `group-${index}-${ruleIndex}`" :rule="rule" :fields="props.fields" :first="ruleIndex === 0" @change="update([index, ruleIndex], $event)" @remove="remove([index, ruleIndex])" /></div>
          <footer><button type="button" @click="addToGroup(index)">＋ 添加组内条件</button></footer>
        </section>
      </template>
    </div>
    <p v-else class="ui-filter-empty">还没有筛选条件。</p>
    <footer class="ui-filter-builder-footer"><button type="button" @click="addCondition">＋ 添加条件</button><button type="button" @click="addGroup">＋ 添加条件组</button><button v-if="props.filters.length" class="clear" type="button" @click="clear">清除筛选 <span v-if="activeCount">{{ activeCount }}</span></button></footer>
  </section>
</template>

<style scoped>
.ui-filter-builder { color: #c7cbd2; }
.ui-filter-builder > header { display: grid; gap: 5px; padding: 13px 15px 11px; border-bottom: 1px solid #34373d; }
.ui-filter-builder > header strong { color: #e0e3e8; font-size: 12px; font-weight: 550; }
.ui-filter-builder > header span { color: #7f8996; font-size: 10px; }
.ui-filter-root { display: grid; gap: 9px; max-height: 350px; overflow: auto; padding: 12px; }
.ui-filter-group { border: 1px solid #3a3e45; border-radius: 6px; background: #1c1e22; }
.ui-filter-group-heading { display: flex; align-items: center; gap: 8px; min-height: 39px; padding: 4px 8px; border-bottom: 1px solid #34373d; }
.ui-filter-group-heading :deep(.ui-select-trigger) { min-width: 70px; min-height: 29px; height: 29px; padding: 4px 7px; font-size: 10px; }
.ui-filter-group-heading strong { color: #d5d9df; font-size: 11px; font-weight: 550; }
.ui-filter-group-heading > span { color: #7f8996; font-size: 10px; }
.ui-filter-group-heading > button { display: grid; place-items: center; width: 25px; height: 25px; margin-left: auto; border: 0; border-radius: 4px; background: transparent; color: #89929d; cursor: pointer; }
.ui-filter-group-heading > button:hover { background: #35383e; color: #e0e3e8; }
.ui-filter-group-rules { display: grid; gap: 7px; padding: 10px; }
.ui-filter-group footer { display: flex; justify-content: flex-start; padding: 0 10px 8px; }
.ui-filter-group footer button, .ui-filter-builder-footer button { padding: 4px 3px; border: 0; background: transparent; color: #aeb8c4; font-size: 10px; cursor: pointer; }
.ui-filter-group footer button:hover, .ui-filter-builder-footer button:hover { color: #e0e3e8; }
.ui-filter-empty { padding: 17px 14px; color: #7e8792; font-size: 10px; }
.ui-filter-builder-footer { display: flex; gap: 16px; min-height: 40px; align-items: center; padding: 6px 13px; border-top: 1px solid #34373d; }
.ui-filter-builder-footer .clear { margin-left: auto; }
.ui-filter-builder-footer .clear span { margin-left: 3px; color: #8e98a4; }
</style>
