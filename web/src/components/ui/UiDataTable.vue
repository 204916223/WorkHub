<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  rowKey: { type: [String, Function], default: 'id' },
  minWidth: { type: [String, Number], default: 640 },
  emptyText: { type: String, default: '暂无数据' },
  loading: { type: Boolean, default: false },
  skeletonRows: { type: Number, default: 8 },
  caption: { type: String, default: '' },
  density: { type: String, default: 'normal' },
  groupBy: { type: [String, Function], default: '' },
  groupLabel: { type: Function, default: (value) => value || '未填写' },
})

const collapsedGroups = ref(new Set())
const tableMinWidth = computed(() => typeof props.minWidth === 'number' ? `${props.minWidth}px` : props.minWidth)
const rowSections = computed(() => {
  if (!props.groupBy) return [{ key: 'all', value: '', rows: props.rows }]
  const sections = new Map()
  for (const row of props.rows) {
    const value = typeof props.groupBy === 'function' ? props.groupBy(row) : row?.[props.groupBy]
    const key = value == null || value === '' ? '__empty__' : `${typeof value}:${String(value)}`
    let section = sections.get(key)
    if (!section) { section = { key, value, rows: [] }; sections.set(key, section) }
    section.rows.push(row)
  }
  return [...sections.values()]
})
function keyFor(row, index) {
  return typeof props.rowKey === 'function' ? props.rowKey(row, index) : row?.[props.rowKey] ?? index
}
function valueFor(row, column) {
  return typeof column.value === 'function' ? column.value(row) : row?.[column.key]
}
function stateTone(row, column) {
  const state = String(row?.tfsName || valueFor(row, column) || '').trim()
  if (['创建中'].includes(state)) return 'creating'
  if (['未完成', '进行中', 'unfinished'].includes(state)) return 'unfinished'
  if (['待评审'].includes(state)) return 'pending-review'
  if (['评审中'].includes(state)) return 'in-review'
  if (['已完成', 'completed'].includes(state)) return 'completed'
  if (['已归档', 'archived'].includes(state)) return 'archived'
  return 'default'
}
function columnStyle(column) {
  return {
    width: column.width,
    minWidth: column.minWidth,
    textAlign: column.align || 'left',
  }
}
function isGroupCollapsed(key) { return collapsedGroups.value.has(key) }
function toggleGroup(key) {
  const next = new Set(collapsedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedGroups.value = next
}
watch(() => props.groupBy, () => { collapsedGroups.value = new Set() })
</script>

<template>
  <div class="ui-data-table-wrap" :aria-busy="loading">
    <table v-if="rows.length || (loading && skeletonRows > 0)" class="ui-data-table" :class="`density-${density}`" :style="{ minWidth: tableMinWidth }">
      <caption v-if="caption" class="ui-data-table-caption">{{ caption }}</caption>
      <colgroup>
        <col v-for="column in columns" :key="column.key" :style="{ width: column.width }" />
      </colgroup>
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" scope="col" :style="columnStyle(column)" :class="column.headerClass">
            <slot :name="`header-${column.key}`" :column="column">{{ column.label }}</slot>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="rows.length">
          <template v-for="(section, sectionIndex) in rowSections" :key="`${section.key}-${sectionIndex}`">
            <tr v-if="groupBy" class="ui-data-table-group"><th :colspan="columns.length" scope="rowgroup"><button type="button" class="ui-data-table-group-toggle" :aria-expanded="!isGroupCollapsed(section.key)" @click="toggleGroup(section.key)"><span class="ui-data-table-group-chevron" :class="{ collapsed: isGroupCollapsed(section.key) }" aria-hidden="true"></span><span class="ui-data-table-group-label">{{ groupLabel(section.value) }}</span><small>{{ section.rows.length }} 条</small></button></th></tr>
            <tr v-for="(row, index) in section.rows" v-show="!isGroupCollapsed(section.key)" :key="keyFor(row, index)">
              <td v-for="column in columns" :key="column.key" :style="columnStyle(column)" :class="column.cellClass">
                <span v-if="column.key === 'state'" class="ui-data-table-state" :class="`tone-${stateTone(row, column)}`">
                  <slot :name="`cell-${column.key}`" :row="row" :value="valueFor(row, column)" :column="column" :index="index">
                    {{ valueFor(row, column) ?? '—' }}
                  </slot>
                </span>
                <slot v-else :name="`cell-${column.key}`" :row="row" :value="valueFor(row, column)" :column="column" :index="index">
                  {{ valueFor(row, column) ?? '—' }}
                </slot>
              </td>
            </tr>
          </template>
        </template>
        <template v-else-if="loading">
          <tr v-for="rowIndex in skeletonRows" :key="`skeleton-${rowIndex}`" class="ui-data-table-skeleton-row" aria-hidden="true">
            <td v-for="(column, columnIndex) in columns" :key="column.key" :style="columnStyle(column)">
              <span class="ui-data-table-skeleton-bar" :class="`width-${(rowIndex * 5 + columnIndex * 3) % 5 + 1}`" :style="column.key === 'actions' ? { width: '14px' } : undefined"></span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <div v-else class="ui-data-table-empty" role="status">
      <slot name="empty">{{ loading ? '正在加载…' : emptyText }}</slot>
    </div>
  </div>
</template>

<style scoped>
.ui-data-table-wrap { width: 100%; overflow: auto; }
.ui-data-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.ui-data-table th { padding: 10px 9px; color: #7c899a; font-size: 12px; font-weight: 500; text-align: left; white-space: nowrap; }
.ui-data-table td { padding: 12px 9px; border-top: 1px solid #2c3036; color: #aab4c1; font-size: 14px; line-height: 20px; white-space: nowrap; }
.ui-data-table-state { display: inline-flex; max-width: 100%; align-items: center; padding: 2px 8px; border-radius: 4px; font-size: 12px; line-height: 18px; }
.ui-data-table-state.tone-default, .ui-data-table-state.tone-archived { color: #a4a7ad; background: #35373a; }
.ui-data-table-state.tone-creating { color: #d58b22; background: #34291d; }
.ui-data-table-state.tone-unfinished { color: #168bd6; background: #1c2b38; }
.ui-data-table-state.tone-pending-review { color: #8755df; background: #2b2438; }
.ui-data-table-state.tone-in-review { color: #a6a8ad; background: #333437; }
.ui-data-table-state.tone-completed { color: #1da35b; background: #1e3027; }
.ui-data-table-skeleton-row td { height: 45px; padding: 0 9px; }
.ui-data-table.density-compact .ui-data-table-skeleton-row td { height: 33px; padding: 0 9px; }
.ui-data-table.density-comfortable .ui-data-table-skeleton-row td { height: 53px; padding: 0 9px; }
.ui-data-table-skeleton-bar { display: block; height: 11px; max-width: 100%; border-radius: 4px; background: linear-gradient(90deg, #282a2e 25%, #303237 45%, #282a2e 65%); background-size: 200% 100%; animation: ui-data-table-skeleton 1.4s ease-in-out infinite; }
.ui-data-table-skeleton-bar.width-1 { width: 34%; }
.ui-data-table-skeleton-bar.width-2 { width: 49%; }
.ui-data-table-skeleton-bar.width-3 { width: 64%; }
.ui-data-table-skeleton-bar.width-4 { width: 79%; }
.ui-data-table-skeleton-bar.width-5 { width: 92%; }
@keyframes ui-data-table-skeleton { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .ui-data-table-skeleton-bar { animation: none; } }
.ui-data-table.density-compact td { padding-top: 6px; padding-bottom: 6px; }
.ui-data-table.density-comfortable td { padding-top: 16px; padding-bottom: 16px; }
.ui-data-table-group th { padding: 0; border-top: 1px solid #34383f; background: #202226; color: #aab4c1; font-size: 12px; font-weight: 550; text-align: left; }
.ui-data-table-group-toggle { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 0 10px; border: 0; border-radius: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.ui-data-table-group-toggle:hover { background: #292c31; }
.ui-data-table-group-chevron { width: 7px; height: 7px; flex: 0 0 auto; border-right: 1.5px solid #87919e; border-bottom: 1.5px solid #87919e; transform: rotate(45deg) translateY(-2px); transition: transform .15s; }
.ui-data-table-group-chevron.collapsed { transform: rotate(-45deg); }
.ui-data-table-group-label { color: #c5cbd4; }
.ui-data-table-group-toggle small { margin-left: 8px; color: #788392; font-size: 10px; font-weight: 400; }
.ui-data-table-caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.ui-data-table-empty { padding: 32px 16px; color: #7e8999; font-size: 12px; text-align: center; }
</style>
