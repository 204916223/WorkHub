<script setup>
import UiSelect from './UiSelect.vue'
import AssetIcon from '../AssetIcon.vue'

const props = defineProps({
  rule: { type: Object, required: true },
  fields: { type: Array, default: () => [] },
  first: { type: Boolean, default: false },
})
const emit = defineEmits(['change', 'remove'])
const joins = [{ value: 'and', label: '且' }, { value: 'or', label: '或' }]
const labels = { contains: '包含', equals: '等于', not_equals: '不等于', before: '早于', after: '晚于', on_or_before: '不晚于', on_or_after: '不早于', greater_than: '大于', less_than: '小于', is_empty: '为空', is_not_empty: '不为空' }
const operators = {
  text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  state: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  select: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  date: ['equals', 'before', 'on_or_before', 'after', 'on_or_after', 'is_empty', 'is_not_empty'],
  number: ['equals', 'not_equals', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'],
}
const fieldOptions = props.fields.map(({ key, label }) => ({ value: key, label }))
const joinOptions = joins
function field(key) { return props.fields.find((item) => item.key === key) }
function operatorOptions(key) { return (operators[field(key)?.type || 'text'] || operators.text).map((value) => ({ value, label: labels[value] })) }
function changeField(key) { emit('change', { field: key, operator: operatorOptions(key)[0]?.value || 'contains', value: '' }) }
</script>

<template>
  <div class="ui-filter-condition">
    <span v-if="props.first" class="ui-filter-join-label">当</span>
    <UiSelect v-else :model-value="props.rule.conjunction || 'and'" :options="joinOptions" size="small" aria-label="与上一条条件的关系" @update:model-value="emit('change', { conjunction: $event })" />
    <UiSelect :model-value="props.rule.field" :options="fieldOptions" size="small" aria-label="筛选字段" @update:model-value="changeField" />
    <UiSelect :model-value="props.rule.operator" :options="operatorOptions(props.rule.field)" size="small" aria-label="筛选方式" @update:model-value="emit('change', { operator: $event })" />
    <UiSelect v-if="field(props.rule.field)?.options?.length && !['is_empty', 'is_not_empty'].includes(props.rule.operator)" :model-value="props.rule.value" :options="field(props.rule.field).options" size="small" placeholder="请选择" aria-label="筛选值" @update:model-value="emit('change', { value: $event })" />
    <input v-else-if="!['is_empty', 'is_not_empty'].includes(props.rule.operator)" :value="props.rule.value" :type="field(props.rule.field)?.type === 'date' ? 'date' : field(props.rule.field)?.type === 'number' ? 'number' : 'text'" placeholder="输入筛选值" aria-label="筛选值" @input="emit('change', { value: $event.target.value })" />
    <button type="button" class="ui-filter-remove" aria-label="删除筛选条件" @click="emit('remove')"><AssetIcon name="删除" :size="14" /></button>
  </div>
</template>

<style scoped>
.ui-filter-condition { display: grid; grid-template-columns: 42px minmax(100px, 1fr) minmax(88px, .9fr) minmax(120px, 1.1fr) 25px; align-items: center; gap: 7px; }
.ui-filter-condition :deep(.ui-select-trigger) { min-height: 32px; height: 32px; padding: 5px 8px; border-color: #3a3d43; border-radius: 5px; background: #25272b; color: #c7cbd2; font-size: 10px; }
.ui-filter-condition :deep(.ui-select-trigger:hover:not(:disabled)) { background: #2a2c31; }
.ui-filter-condition input { width: 100%; height: 32px; padding: 5px 8px; border: 1px solid #3a3d43; border-radius: 5px; outline: none; background: #25272b; color: #c7cbd2; font-size: 10px; }
.ui-filter-condition input[type="date"] { color-scheme: dark; }
.ui-filter-join-label { color: #8e98a4; font-size: 11px; text-align: center; }
.ui-filter-remove { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #89929d; cursor: pointer; }
.ui-filter-remove:hover { background: #35383e; color: #e0e3e8; }
</style>
