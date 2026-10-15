<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import AssetIcon from '../AssetIcon.vue'
import UiDataTable from './UiDataTable.vue'
import UiFilterBuilder from './UiFilterBuilder.vue'
import UiSavedViewTabs from './UiSavedViewTabs.vue'
import UiSelect from './UiSelect.vue'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  emptyText: { type: String, default: '暂无数据' },
  minWidth: { type: [String, Number], default: 640 },
  rowKey: { type: [String, Function], default: 'id' },
  page: { type: Number, default: 1 },
  pageCount: { type: Number, default: 1 },
  pageSize: { type: Number, default: 30 },
  adaptivePageSize: { type: Boolean, default: false },
  groupCount: { type: Number, default: 0 },
  tableMinHeight: { type: Number, default: 0 },
  density: { type: String, default: 'normal' },
  groupBy: { type: String, default: '' },
  groupLabel: { type: Function, default: (value) => value || '未填写' },
  fields: { type: Array, default: () => [] },
  filterFields: { type: Array, default: null },
  fixedFields: { type: Array, default: () => [] },
  fieldOrder: { type: Array, default: () => [] },
  visibleFields: { type: Array, default: () => [] },
  filters: { type: Array, default: () => [] },
  sorts: { type: Array, default: () => [] },
  query: { type: String, default: '' },
  views: { type: Array, default: () => [] },
  activeViewId: { type: String, default: 'default' },
  viewDirty: { type: Boolean, default: false },
  detailEnabled: { type: Boolean, default: false },
  getRowUrl: { type: Function, default: null },
})
const emit = defineEmits([
  'update:page', 'update:page-size', 'update:density', 'update:group-by', 'update:field-order', 'update:visible-fields', 'update:filters', 'update:sorts', 'update:query',
  'select-view', 'save-view', 'overwrite-view', 'rename-view', 'delete-view',
])
function renameView(id, name) { emit('rename-view', id, name) }
const slots = useSlots()
const forwardedCellSlots = computed(() => Object.fromEntries(Object.entries(slots).filter(([name]) => (name.startsWith('cell-') || name.startsWith('header-')) && !['cell-title', 'cell-actions'].includes(name))))

const toolbar = ref(null), tablePanel = ref(null), footer = ref(null), anchor = ref(null)
const openPanel = ref(''), panelStyle = ref({}), draggedField = ref('')
const measuredTableMinHeight = ref(0)
const selectedRow = ref(null)
const savingView = ref(false), savingAs = ref(false), newViewName = ref('')
const activeFilterCount = computed(() => { const count = (items) => items.reduce((sum, item) => sum + (item?.type === 'group' ? count(item.rules || []) : (item?.operator === 'is_empty' || item?.operator === 'is_not_empty' || String(item?.value ?? '').trim() ? 1 : 0)), 0); return count(props.filters) })
const filterableFields = computed(() => props.filterFields || props.fields)
const fieldOptions = computed(() => filterableFields.value.map((field) => ({ value: field.key, label: field.label })))
const sortOptions = computed(() => props.fields.map((field) => ({ value: field.key, label: field.label })))
const groupOptions = computed(() => [{ value: '', label: '不分组' }, ...props.fields.map((field) => ({ value: field.key, label: field.label }))])
const densityOptions = [{ value: 'compact', label: '紧凑' }, { value: 'normal', label: '常规' }, { value: 'comfortable', label: '宽松' }]
const directionOptions = [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]
function buttonPanel(name, event) {
  if (openPanel.value === name) { openPanel.value = ''; anchor.value = null; return }
  openPanel.value = name; anchor.value = event.currentTarget; positionPanel()
}
function positionPanel() {
  if (!anchor.value?.isConnected || !openPanel.value) return
  const widths = { fields: 300, filters: 590, group: 290, sort: 390, density: 190 }
  const heights = { fields: 330, filters: 480, group: 150, sort: 290, density: 170 }
  const margin = 12, width = Math.min(widths[openPanel.value], window.innerWidth - margin * 2)
  const rect = anchor.value.getBoundingClientRect(), estimatedHeight = Math.min(heights[openPanel.value], window.innerHeight - margin * 2)
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  let top = rect.bottom + 7
  if (window.innerHeight - rect.bottom < estimatedHeight + margin && rect.top > estimatedHeight + margin) top = rect.top - estimatedHeight - 7
  top = Math.max(margin, Math.min(top, window.innerHeight - estimatedHeight - margin))
  panelStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px` }
}
function closePanel() { openPanel.value = ''; anchor.value = null }
function closeToolbarOutside(event) { if (!event.target.closest('.ui-table-toolbar-controls, .ui-select-backdrop')) closePanel() }
function onKeydown(event) { if (event.key === 'Escape') { closePanel(); selectedRow.value = null } }
function onResize() { if (openPanel.value) positionPanel(); measurePageSize() }
function addSort() { if (props.sorts.length < 4) emit('update:sorts', [...props.sorts, { field: props.fields[0]?.key || '', direction: 'asc' }]) }
function updateSort(index, key, value) { emit('update:sorts', props.sorts.map((sort, sortIndex) => sortIndex === index ? { ...sort, [key]: value } : sort)) }
function removeSort(index) { if (props.sorts.length > 1) emit('update:sorts', props.sorts.filter((_, sortIndex) => sortIndex !== index)) }
function moveField(index, step) {
  const target = index + step
  if (target < 0 || target >= props.fieldOrder.length) return
  const next = [...props.fieldOrder]; [next[index], next[target]] = [next[target], next[index]]; emit('update:field-order', next)
}
function dropField(key) {
  const from = props.fieldOrder.indexOf(draggedField.value), to = props.fieldOrder.indexOf(key)
  if (from >= 0 && to >= 0 && from !== to) { const next = [...props.fieldOrder]; next.splice(to, 0, ...next.splice(from, 1)); emit('update:field-order', next) }
  draggedField.value = ''
}
function toggleVisibleField(key, checked) {
  const next = new Set(props.visibleFields)
  if (checked) next.add(key); else if (!props.fixedFields.includes(key)) next.delete(key)
  emit('update:visible-fields', [...next])
}
function saveCurrentView() { const name = newViewName.value.trim().slice(0, 32); if (name) { emit('save-view', name); savingView.value = false; savingAs.value = false; newViewName.value = '' } }
function cancelSave() { savingView.value = false; savingAs.value = false; newViewName.value = '' }
const pageSlots = computed(() => {
  const count = Math.max(1, props.pageCount), current = Math.min(Math.max(1, props.page), count)
  const start = Math.max(1, Math.min(current - 1, count - 2))
  return Array.from({ length: 3 }, (_, index) => start + index <= count ? start + index : null)
})
const pageHasLeftGap = computed(() => Boolean(pageSlots.value[0] && pageSlots.value[0] > 1))
const pageHasRightGap = computed(() => Boolean(pageSlots.value.at(-1) && pageSlots.value.at(-1) < props.pageCount))
function pageTo(value) { emit('update:page', Math.max(1, Math.min(props.pageCount, value))) }
let measureFrame = 0, toolbarObserver
function measurePageSize() {
  if (!props.adaptivePageSize) return
  cancelAnimationFrame(measureFrame)
  measureFrame = requestAnimationFrame(() => {
    const panel = tablePanel.value, tools = toolbar.value
    if (!panel || !tools) return
    const pixels = (style, property) => Number.parseFloat(style?.[property]) || 0
    const outerHeight = (element) => {
      if (!element) return 0
      const style = window.getComputedStyle(element)
      return element.getBoundingClientRect().height + pixels(style, 'marginTop') + pixels(style, 'marginBottom')
    }
    const table = panel.querySelector('.ui-data-table'), head = table?.querySelector('thead')
    const firstRow = table?.querySelector('tbody tr:not(.ui-data-table-group)')
    const rowHeight = firstRow?.getBoundingClientRect().height || ({ compact: 33, normal: 45, comfortable: 53 }[props.density])
    const headHeight = head?.getBoundingClientRect().height || 36
    const panelRect = panel.getBoundingClientRect(), scrollArea = panel.closest('.module-layout-content'), scrollRect = scrollArea?.getBoundingClientRect()
    const panelOffset = scrollArea && scrollRect ? panelRect.top - scrollRect.top + scrollArea.scrollTop : panelRect.top + window.scrollY
    const panelStyle = window.getComputedStyle(panel), scrollStyle = scrollArea ? window.getComputedStyle(scrollArea) : null
    const verticalSpacing = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, prop) => sum + pixels(panelStyle, prop), 0)
    const fixedHeight = tools.getBoundingClientRect().height + outerHeight(footer.value) + outerHeight(panel.querySelector('.ui-table-notice')) + outerHeight(panel.querySelector('.error-banner')) + headHeight + verticalSpacing + pixels(scrollStyle, 'paddingBottom') + 8
    const available = Math.max(0, (scrollArea?.clientHeight ?? window.innerHeight) - panelOffset - fixedHeight)
    let desired = Math.max(1, Math.min(100, Math.floor(available / rowHeight)))
    if (props.groupBy) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const headers = Math.min(desired, Math.max(1, Math.ceil((props.groupCount || 1) * desired / Math.max(props.total, 1)) + 1))
        const next = Math.max(1, Math.min(100, Math.floor(available / (rowHeight + 30 * headers / desired))))
        if (next === desired) break
        desired = next
      }
    }
    measuredTableMinHeight.value = Math.ceil(headHeight + available)
    if (desired !== props.pageSize) emit('update:page-size', desired)
  })
}
watch([() => props.pageSize, () => props.total, () => props.rows.length, () => props.loading, () => props.groupCount, () => props.groupBy, () => props.density], async () => { await nextTick(); measurePageSize() }, { flush: 'post' })
onMounted(async () => {
  await nextTick()
  if (props.adaptivePageSize) { toolbarObserver = new ResizeObserver(measurePageSize); if (toolbar.value) toolbarObserver.observe(toolbar.value) }
  document.addEventListener('pointerdown', closeToolbarOutside)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', positionPanel, true)
  measurePageSize()
})
onBeforeUnmount(() => { document.removeEventListener('pointerdown', closeToolbarOutside); document.removeEventListener('keydown', onKeydown); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', positionPanel, true); toolbarObserver?.disconnect(); cancelAnimationFrame(measureFrame) })
</script>

<template>
  <section ref="tablePanel" class="surface ui-table-view">
    <div v-if="$slots.heading" class="ui-table-view-heading"><slot name="heading" /></div>
    <div ref="toolbar" class="ui-table-view-toolbar">
      <UiSavedViewTabs :views="props.views" :active-id="props.activeViewId" @select="emit('select-view', $event)" @rename="renameView" @delete="emit('delete-view', $event)" />
      <div class="ui-table-toolbar-controls">
        <div v-if="props.viewDirty" class="ui-table-save-view">
          <button v-if="!savingView" type="button" class="ui-table-save-prompt" @click="savingView = true">点击保存当前视图</button>
          <template v-else-if="props.activeViewId === 'default' || savingAs">
            <input v-model="newViewName" maxlength="32" type="text" placeholder="输入视图名称" aria-label="新视图名称" @keydown.enter.prevent="saveCurrentView" />
            <button type="button" class="save-action" :disabled="!newViewName.trim()" @click="saveCurrentView">另存为</button>
            <button type="button" class="cancel-action" @click="cancelSave">取消</button>
          </template>
          <template v-else>
            <button type="button" class="save-action" @click="emit('overwrite-view'); savingView = false">覆盖当前视图</button>
            <button type="button" class="save-action" @click="savingAs = true">另存为</button>
            <button type="button" class="cancel-action" @click="cancelSave">取消</button>
          </template>
        </div>
        <button type="button" class="ui-table-tool" :class="{ active: openPanel === 'fields' }" @click="buttonPanel('fields', $event)">字段管理</button>
        <button type="button" class="ui-table-tool" :class="{ active: openPanel === 'filters' || activeFilterCount }" @click="buttonPanel('filters', $event)">筛选<small v-if="activeFilterCount">{{ activeFilterCount }}</small></button>
        <button type="button" class="ui-table-tool" :class="{ active: openPanel === 'group' || props.groupBy }" @click="buttonPanel('group', $event)">分组</button>
        <button type="button" class="ui-table-tool" :class="{ active: openPanel === 'sort' }" @click="buttonPanel('sort', $event)">排序</button>
        <button type="button" class="ui-table-tool" :class="{ active: openPanel === 'density' }" @click="buttonPanel('density', $event)">行高 <span>{{ densityOptions.find((item) => item.value === props.density)?.label || '常规' }}</span></button>
        <label class="ui-table-search"><span class="search-icon" /><input :value="props.query" type="search" placeholder="查找任务标题或项目" aria-label="表格查找" @input="emit('update:query', $event.target.value)" @focus="closePanel" /><button v-if="props.query" type="button" aria-label="清除查找" @click="emit('update:query', '')"><AssetIcon name="关闭" :size="12" /></button></label>

        <section v-if="openPanel === 'fields'" class="ui-table-popover field-popover" :style="panelStyle" aria-label="字段管理">
          <header><strong>字段管理</strong><span>选择显示字段并调整顺序</span></header>
          <div class="field-list"><div v-for="(key, index) in props.fieldOrder" :key="key" class="field-setting-row" draggable="true" @dragstart="draggedField = key" @dragover.prevent @drop="dropField(key)" @dragend="draggedField = ''"><span class="field-grip">⠿</span><input :id="`ui-field-${key}`" type="checkbox" :checked="props.visibleFields.includes(key)" :disabled="props.fixedFields.includes(key)" @change="toggleVisibleField(key, $event.target.checked)" /><label :for="`ui-field-${key}`">{{ props.fields.find((field) => field.key === key)?.label || key }}</label><button type="button" :disabled="index === 0" :aria-label="`上移${key}`" @click="moveField(index, -1)">↑</button><button type="button" :disabled="index === props.fieldOrder.length - 1" :aria-label="`下移${key}`" @click="moveField(index, 1)">↓</button></div></div>
          <footer><span>固定字段不能隐藏</span><button type="button" class="text-action" @click="emit('update:field-order', props.fields.map((field) => field.key)); emit('update:visible-fields', [...props.fixedFields, ...props.fields.map((field) => field.key)])">恢复默认</button></footer>
        </section>
        <section v-if="openPanel === 'filters'" class="ui-table-popover filter-popover" :style="panelStyle" aria-label="筛选条件"><UiFilterBuilder :fields="filterableFields" :filters="props.filters" @update:filters="emit('update:filters', $event)" /></section>
        <section v-if="openPanel === 'group'" class="ui-table-popover small-popover" :style="panelStyle" aria-label="分组设置"><header><strong>分组</strong><span>按字段归类当前结果</span></header><label class="popover-select"><span>分组字段</span><UiSelect :model-value="props.groupBy" :options="groupOptions" size="small" aria-label="分组字段" @update:model-value="emit('update:group-by', $event)" /></label></section>
        <section v-if="openPanel === 'sort'" class="ui-table-popover sort-popover" :style="panelStyle" aria-label="排序设置"><header><strong>排序</strong><span>按顺序应用多个排序条件</span></header><div class="sort-rules"><div v-for="(sort, index) in props.sorts" :key="index" class="sort-rule"><UiSelect :model-value="sort.field" :options="sortOptions" size="small" aria-label="排序字段" @update:model-value="updateSort(index, 'field', $event)" /><UiSelect :model-value="sort.direction" :options="directionOptions" size="small" aria-label="排序方向" @update:model-value="updateSort(index, 'direction', $event)" /><button type="button" class="icon-tool" :disabled="props.sorts.length === 1" :aria-label="`删除第 ${index + 1} 个排序条件`" @click="removeSort(index)"><AssetIcon name="删除" :size="14" /></button></div></div><footer><button type="button" class="text-action" :disabled="props.sorts.length >= 4" @click="addSort">＋ 添加排序条件</button></footer></section>
        <section v-if="openPanel === 'density'" class="ui-table-popover density-popover" :style="panelStyle" aria-label="行高设置"><header><strong>行高</strong></header><button v-for="option in densityOptions" :key="option.value" type="button" class="density-option" :class="{ selected: props.density === option.value }" @click="emit('update:density', option.value); closePanel()"><span class="density-sample">↕</span>{{ option.label }}<span v-if="props.density === option.value" class="selected-mark">✓</span></button></section>
      </div>
    </div>
    <div v-if="$slots.notice" class="ui-table-notice"><slot name="notice" /></div>
    <slot name="before-table" />
    <UiDataTable :style="(props.tableMinHeight || (props.adaptivePageSize && measuredTableMinHeight)) ? { minHeight: `${props.tableMinHeight || measuredTableMinHeight}px` } : undefined" :columns="props.columns" :rows="props.rows" :loading="props.loading" :min-width="props.minWidth" :row-key="props.rowKey" :caption="props.title" :density="props.density" :group-by="props.groupBy" :group-label="props.groupLabel" :empty-text="props.emptyText" :skeleton-rows="7">
      <template #cell-title="slotProps"><button v-if="props.detailEnabled" type="button" class="ui-table-title-link" :title="slotProps.row?.title || slotProps.value" @click="selectedRow = slotProps.row"><slot name="cell-title" v-bind="slotProps">{{ slotProps.value ?? '—' }}</slot></button><slot v-else name="cell-title" v-bind="slotProps">{{ slotProps.value ?? '—' }}</slot></template>
      <template #cell-actions="{ row }"><slot name="row-action" :row="row"><a v-if="props.getRowUrl?.(row)" class="ui-table-row-action" :href="props.getRowUrl(row)" target="_blank" rel="noopener noreferrer" aria-label="在 Teambition 中打开任务" title="在 Teambition 中打开任务"><AssetIcon name="导出1" :size="14" /></a></slot></template>
      <template v-for="(_, slotName) in forwardedCellSlots" #[slotName]="slotProps"><slot :name="slotName" v-bind="slotProps || {}" /></template>
    </UiDataTable>
    <footer ref="footer" class="ui-table-view-footer"><div class="ui-table-view-summary"><slot name="summary"><strong>{{ props.total.toLocaleString() }}</strong><span>条记录</span></slot></div><nav class="ui-table-pagination" aria-label="表格分页"><button type="button" :disabled="props.page <= 1" aria-label="第一页" title="第一页" @click="pageTo(1)"><AssetIcon name="箭头-左至" :size="14" /></button><button type="button" :disabled="props.page <= 1" aria-label="上一页" title="上一页" @click="pageTo(props.page - 1)"><AssetIcon name="箭头-左" :size="14" /></button><span class="page-ellipsis">{{ pageHasLeftGap ? '…' : '' }}</span><span v-for="(slot, index) in pageSlots" :key="`page-slot-${index}`" class="page-slot"><button v-if="slot" type="button" :class="{ current: props.page === slot }" :aria-current="props.page === slot ? 'page' : undefined" @click="pageTo(slot)">{{ slot }}</button></span><span class="page-ellipsis">{{ pageHasRightGap ? '…' : '' }}</span><button type="button" :disabled="props.page >= props.pageCount" aria-label="下一页" title="下一页" @click="pageTo(props.page + 1)"><AssetIcon name="箭头-右" :size="14" /></button><button type="button" :disabled="props.page >= props.pageCount" aria-label="最后一页" title="最后一页" @click="pageTo(props.pageCount)"><AssetIcon name="箭头-右至" :size="14" /></button></nav></footer>
    <Teleport to="body"><div v-if="selectedRow" class="ui-table-detail-backdrop" @click.self="selectedRow = null"><aside class="ui-table-detail-panel" role="dialog" aria-modal="true" aria-label="任务详情"><header><a v-if="props.getRowUrl?.(selectedRow)" :href="props.getRowUrl(selectedRow)" target="_blank" rel="noopener noreferrer"><AssetIcon name="导出1" :size="13" />Teambition</a><button type="button" aria-label="关闭任务详情" @click="selectedRow = null"><AssetIcon name="关闭" :size="16" /></button></header><div class="ui-table-detail-body"><h2>{{ selectedRow.title || selectedRow.name || '详情' }}</h2><slot name="detail" :row="selectedRow"><div class="ui-table-detail-default">{{ selectedRow.projectName || '' }}</div></slot></div></aside></div></Teleport>
  </section>
</template>

<style scoped>
.ui-table-view { min-width: 0; padding: 0 20px 10px; }
.ui-table-view-heading { padding-top: 14px; }
.ui-table-view-toolbar, .ui-table-view-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ui-table-view-toolbar { position: relative; flex-wrap: wrap; min-height: 50px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.ui-table-toolbar-controls { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; margin-left: auto; }
.ui-table-tool { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #aeb6c1; font-size: 11px; white-space: nowrap; cursor: pointer; }
.ui-table-tool:hover, .ui-table-tool.active { border-color: #35383e; background: #24262a; color: #e0e3e8; }
.ui-table-tool span, .ui-table-tool small { color: #7f8996; font-size: 9px; font-weight: 400; }
.ui-table-search { display: flex; align-items: center; gap: 8px; width: 205px; height: 31px; margin-left: 5px; padding: 0 8px; border: 1px solid #34373d; border-radius: 5px; background: #1d1f22; }
.ui-table-search input { width: 100%; min-width: 0; padding: 5px 0; border: 0; outline: 0; background: transparent; color: #d5d9df; font-size: 10px; }
.ui-table-search input::-webkit-search-cancel-button { display: none; }
.ui-table-search button { display: grid; flex: 0 0 18px; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; background: transparent; color: #87919e; cursor: pointer; }
.search-icon { position: relative; flex: 0 0 12px; width: 12px; height: 12px; margin: 0 2px 2px 0; border: 1.5px solid #8290a2; border-radius: 50%; }
.search-icon::after { position: absolute; right: -4px; bottom: -2px; width: 5px; height: 1.5px; border-radius: 1px; background: #8290a2; content: ''; transform: rotate(45deg); transform-origin: left center; }
.ui-table-popover { position: fixed; z-index: 50; max-height: min(70vh, 520px); overflow: auto; border: 1px solid #3b3e44; border-radius: 8px; background: #202226; box-shadow: 0 12px 34px #0008; color: #c7cbd2; }
.ui-table-popover > header { display: grid; gap: 5px; padding: 13px 15px 11px; border-bottom: 1px solid #34373d; }
.ui-table-popover > header strong { color: #e0e3e8; font-size: 12px; font-weight: 550; }
.ui-table-popover > header span, .ui-table-popover > footer > span { color: #7f8996; font-size: 10px; }
.ui-table-popover > footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 40px; padding: 6px 13px; border-top: 1px solid #34373d; }
.field-popover { width: min(300px, calc(100vw - 44px)); }
.field-list { max-height: 300px; overflow: auto; padding: 4px 7px; }
.field-setting-row { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 2px 4px; border-radius: 4px; }
.field-setting-row:hover { background: #292c31; }
.field-grip { color: #626b76; font-size: 15px; cursor: grab; }
.field-setting-row input { width: 14px; height: 14px; margin: 0; accent-color: #71869a; }
.field-setting-row label { flex: 1; color: #c3c9d1; font-size: 11px; cursor: pointer; }
.field-setting-row > button, .icon-tool { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #89929d; font-size: 12px; cursor: pointer; }
.field-setting-row > button:hover, .icon-tool:hover { background: #35383e; color: #e0e3e8; }
.field-setting-row > button:disabled, .icon-tool:disabled { opacity: .35; cursor: default; }
.text-action { padding: 4px 3px; border: 0; background: transparent; color: #aeb8c4; font-size: 10px; cursor: pointer; }
.text-action:hover:not(:disabled) { color: #e0e3e8; }
.text-action:disabled { opacity: .4; cursor: default; }
.sort-rules { display: grid; gap: 7px; max-height: 270px; overflow: auto; padding: 12px; }
.sort-rule :deep(.ui-select-trigger), .popover-select :deep(.ui-select-trigger) { min-height: 32px; height: 32px; padding: 5px 8px; border-color: #3a3d43; border-radius: 5px; background: #25272b; color: #c7cbd2; font-size: 10px; }
.small-popover { width: min(290px, calc(100vw - 44px)); padding-bottom: 13px; }
.popover-select { display: grid; gap: 6px; padding: 12px 14px 0; color: #8a939e; font-size: 10px; }
.sort-popover { width: min(390px, calc(100vw - 44px)); }
.sort-rule { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(90px, .8fr) 25px; align-items: center; gap: 7px; }
.density-popover { width: 190px; padding-bottom: 5px; }
.density-option { display: flex; align-items: center; gap: 10px; width: calc(100% - 10px); min-height: 34px; margin: 2px 5px; padding: 5px 8px; border: 0; border-radius: 4px; background: transparent; color: #c3c9d1; text-align: left; font-size: 11px; cursor: pointer; }
.density-option:hover, .density-option.selected { background: #2b2e33; }
.density-sample { color: #858e99; font-size: 14px; }
.selected-mark { margin-left: auto; color: #aab4c0; }
.ui-table-save-view { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 5px; border: 1px solid #3a424b; border-radius: 5px; background: #202328; }
.ui-table-save-view > button, .ui-table-save-view input { font-size: 10px; }
.ui-table-save-view > button { padding: 5px 7px; border: 0; border-radius: 4px; background: transparent; color: #aebdcc; white-space: nowrap; cursor: pointer; }
.ui-table-save-view > button.ui-table-save-prompt { color: #9bc2d1; }
.ui-table-save-view > button.save-action { background: #2d3b43; color: #c1d6df; }
.ui-table-save-view > button:disabled { opacity: .45; cursor: default; }
.ui-table-save-view > button.cancel-action { color: #8993a0; }
.ui-table-save-view input { width: 115px; height: 26px; padding: 0 6px; border: 1px solid #3b424a; border-radius: 4px; outline: none; background: #191b1f; color: #d8d9dc; }
.ui-table-notice { margin: 8px 0; padding: 9px 11px; border: 1px solid #594c33; border-radius: 6px; color: #c8b581; background: #28251e; font-size: 10px; }
.ui-table-view-footer { padding-top: 12px; color: #7f8b9a; font-size: 10px; }
.ui-table-view-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; color: #8e9bad; }
.ui-table-view-summary :deep(strong) { color: #d7dde6; font-size: 18px; font-weight: 550; }
.ui-table-view-summary :deep(small) { margin-left: 5px; color: #758294; font-size: 10px; }
.ui-table-pagination { display: grid; flex: 0 0 260px; grid-template-columns: 28px 28px 20px repeat(3, 28px) 20px 28px 28px; align-items: center; gap: 3px; width: 260px; font-variant-numeric: tabular-nums; }
.ui-table-pagination button { display: grid; width: 28px; min-width: 28px; height: 28px; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #aeb8c4; font-size: 11px; cursor: pointer; transition: none; }
.ui-table-pagination button:hover:not(:disabled) { border-color: #383d46; background: #22252a; color: #e0e3e8; }
.ui-table-pagination button.current { border-color: #46515e; background: #2a2e34; color: #e0e3e8; }
.ui-table-pagination button:disabled { opacity: .35; cursor: default; }
.page-ellipsis { display: grid; width: 20px; height: 28px; place-items: center; color: #788392; text-align: center; }
.page-slot { display: grid; width: 28px; height: 28px; }
.ui-table-title-link { display: block; max-width: 100%; overflow: hidden; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.ui-table-title-link:hover { color: #c2d0df; }
.ui-table-row-action { display: inline-flex; align-items: center; justify-content: center; color: #76869a; }
.ui-table-row-action:hover { color: #9bcbdc; }
.ui-table-detail-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; justify-content: flex-end; background: #080a0d80; }
.ui-table-detail-panel { display: flex; flex-direction: column; width: min(620px, 92vw); height: 100%; border-left: 1px solid #343941; background: #191b1f; box-shadow: -18px 0 48px #0006; }
.ui-table-detail-panel > header { display: flex; flex: 0 0 52px; align-items: center; justify-content: flex-end; gap: 10px; padding: 0 18px; border-bottom: 1px solid #30343b; }
.ui-table-detail-panel > header a, .ui-table-detail-panel > header button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 6px 9px; border: 1px solid #373c44; border-radius: 6px; background: #202328; color: #bdc6d2; text-decoration: none; font-size: 11px; cursor: pointer; }
.ui-table-detail-panel > header button { width: 30px; padding: 0; }
.ui-table-detail-body { overflow-y: auto; padding: 18px 22px 30px; }
.ui-table-detail-body h2 { margin: 0 0 18px; color: #e0e5ec; font-size: 17px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.ui-table-detail-default { color: #aab4c1; font-size: 14px; }
@media (max-width: 760px) { .ui-table-view { padding: 0 12px 10px; } .ui-table-view-toolbar { align-items: flex-start; } .ui-table-toolbar-controls { width: 100%; margin-left: 0; } .ui-table-search { flex: 1 1 180px; } .ui-table-view-footer { align-items: flex-start; flex-direction: column; } }
</style>
