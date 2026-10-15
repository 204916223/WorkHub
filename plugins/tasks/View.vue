<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { apiJson } from '../../web/src/services/api.js'
import { useSavedTableViews } from '../../web/src/features/table/useSavedTableViews.js'
import AssetIcon from '../../web/src/components/AssetIcon.vue'
import { UiTableView } from '../../web/src/components/ui/index.js'
import { detailValue, extraTaskFields, fieldLabel, fieldValue, priorityLabel } from '../../web/src/features/table/taskDetailFormat.js'

const host = inject('host')
const tasks = ref([]), total = ref(0), groupCount = ref(0), page = ref(1), pageSize = ref(30)
const query = ref(''), syncState = ref(null), loading = ref(true), error = ref('')
const taskFields = [
  { key: 'title', label: '任务标题', cellClass: 'task-name-cell' },
  { key: 'projectName', label: '项目' },
  { key: 'executorName', label: '负责人' },
  { key: 'tagNames', label: '标签' },
  { key: 'state', label: '状态' },
  { key: 'dueDate', label: '截止日期' },
  { key: 'updated', label: '来源更新时间' },
]
const fieldWidthWeights = { title: 29, projectName: 15, executorName: 12, tagNames: 12, state: 9, dueDate: 10, updated: 13, actions: 4 }
const fieldKeys = taskFields.map(({ key }) => key)
function readTablePreferences() { try { return JSON.parse(localStorage.getItem('workhub.tasks.table.v1') || '{}') } catch { return {} } }
function migrateTagDefaultVisibility() {
  const marker = 'workhub.tasks.tag-default-visible.v1'
  try {
    if (localStorage.getItem(marker)) return
    const includeTag = (fields) => [...new Set([...(Array.isArray(fields) ? fields : fieldKeys), 'tagNames'])]
    const preferences = readTablePreferences()
    if (Array.isArray(preferences.visible)) {
      preferences.visible = includeTag(preferences.visible)
      localStorage.setItem('workhub.tasks.table.v1', JSON.stringify(preferences))
      visibleFields.value = [...new Set(['title', ...preferences.visible.filter((key) => fieldKeys.includes(key))])]
    } else visibleFields.value = [...new Set([...visibleFields.value, 'tagNames'])]
    const saved = JSON.parse(localStorage.getItem('workhub.tasks.views.v1') || 'null')
    const defaultView = saved?.views?.find((view) => view.id === 'default')
    if (defaultView?.config) {
      defaultView.config.visible = includeTag(defaultView.config.visible)
      localStorage.setItem('workhub.tasks.views.v1', JSON.stringify(saved))
    }
    localStorage.setItem(marker, '1')
  } catch {}
}
const savedTablePreferences = readTablePreferences()
function safeFieldOrder(value) { return [...new Set([...(Array.isArray(value) ? value : []), ...fieldKeys].filter((key) => fieldKeys.includes(key)))] }
const fieldOrder = ref(safeFieldOrder(savedTablePreferences.order))
const visibleFields = ref(Array.isArray(savedTablePreferences.visible) ? [...new Set(['title', ...savedTablePreferences.visible.filter((key) => fieldKeys.includes(key))])] : [...fieldKeys])
 migrateTagDefaultVisibility()
const rowDensity = ref(['compact', 'normal', 'comfortable'].includes(savedTablePreferences.density) ? savedTablePreferences.density : 'normal')
const taskColumns = computed(() => {
  const fields = fieldOrder.value.filter((key) => visibleFields.value.includes(key)).map((key) => taskFields.find((field) => field.key === key))
  const widthTotal = fields.reduce((total, field) => total + fieldWidthWeights[field.key], fieldWidthWeights.actions)
  return [
    ...fields.map((field) => ({ ...field, width: `${(fieldWidthWeights[field.key] / widthTotal * 100).toFixed(2)}%` })),
    { key: 'actions', label: '', width: `${(fieldWidthWeights.actions / widthTotal * 100).toFixed(2)}%`, align: 'center' },
  ]
})
const filters = ref([])
const filterFields = [
  { key: 'title', label: '任务标题', type: 'text' },
  { key: 'projectName', label: '项目', type: 'text' },
  { key: 'executorName', label: '负责人', type: 'text' },
  { key: 'tfsName', label: '工作流状态', type: 'text' },
  { key: 'state', label: '完成状态', type: 'state', options: [{ value: 'unfinished', label: '进行中' }, { value: 'completed', label: '已完成' }, { value: 'archived', label: '已归档' }] },
  { key: 'dueDate', label: '截止日期', type: 'date' },
  { key: 'updated', label: '来源更新时间', type: 'date' },
]
const fieldOptions = filterFields.map(({ key, label }) => ({ value: key, label }))
const filterJoinOptions = [{ value: 'and', label: '且' }, { value: 'or', label: '或' }]
const groupBy = ref('')
const groupOptions = [{ value: '', label: '不分组' }, ...fieldOptions]
const defaultTaskSorts = [{ field: 'state', direction: 'desc' }, { field: 'dueDate', direction: 'desc' }]
const sorts = ref(defaultTaskSorts)
function refreshDefaultTaskSort() {
  try {
    const saved = JSON.parse(localStorage.getItem('workhub.tasks.views.v1') || 'null')
    const defaultView = saved?.views?.find((view) => view.id === 'default')
    if (!defaultView?.config) return
    defaultView.config.sorts = defaultTaskSorts
    localStorage.setItem('workhub.tasks.views.v1', JSON.stringify(saved))
  } catch {}
}
refreshDefaultTaskSort()
const initialViewConfig = { query: query.value, filters: [], groupBy: '', sorts: sorts.value, order: fieldOrder.value, visible: visibleFields.value, density: rowDensity.value }
const tableViews = useSavedTableViews({
  storageKey: 'workhub.tasks.views.v1',
  initialConfig: initialViewConfig,
  getConfig: () => ({ query: query.value, filters: filters.value, groupBy: groupBy.value, sorts: sorts.value, order: fieldOrder.value, visible: visibleFields.value, density: rowDensity.value }),
  applyConfig: (config) => {
    query.value = String(config.query || '')
    filters.value = Array.isArray(config.filters) ? config.filters : []
    groupBy.value = groupOptions.some((option) => option.value === config.groupBy) ? config.groupBy : ''
    sorts.value = Array.isArray(config.sorts) && config.sorts.length ? config.sorts : defaultTaskSorts
    fieldOrder.value = safeFieldOrder(config.order)
    visibleFields.value = [...new Set(['title', ...(Array.isArray(config.visible) ? config.visible : fieldKeys).filter((key) => fieldKeys.includes(key))])]
    rowDensity.value = ['compact', 'normal', 'comfortable'].includes(config.density) ? config.density : 'normal'
  },
})
const { views: tableViewList, activeId: activeViewId, dirty: isViewDirty } = tableViews
const densityOptions = [
  { value: 'compact', label: '紧凑' },
  { value: 'normal', label: '常规' },
  { value: 'comfortable', label: '宽松' },
]
const operatorLabels = { contains: '包含', equals: '等于', not_equals: '不等于', before: '早于', after: '晚于', is_empty: '为空', is_not_empty: '不为空' }
const operatorOptions = {
  text: ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  state: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  date: ['equals', 'before', 'after', 'is_empty', 'is_not_empty'],
}
const stateOptions = [{ value: 'unfinished', label: '进行中' }, { value: 'completed', label: '已完成' }, { value: 'archived', label: '已归档' }]
const sortOptions = fieldOptions
const sortDirectionOptions = [{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]
const densityLabel = computed(() => densityOptions.find((option) => option.value === rowDensity.value)?.label || '常规')
function isActiveFilter(node) {
  if (node?.type === 'group') return (node.rules || []).some(isActiveFilter)
  return node?.operator === 'is_empty' || node?.operator === 'is_not_empty' || String(node?.value ?? '').trim() !== ''
}
const activeFilters = computed(() => filters.value.filter(isActiveFilter))
const hasActiveFilters = computed(() => Boolean(query.value.trim() || activeFilters.value.length))
function cleanFilterList(items) {
  return items.filter(isActiveFilter).map((item) => item.type === 'group'
    ? { type: 'group', conjunction: item.conjunction === 'or' ? 'or' : 'and', rules: cleanFilterList(item.rules || []) }
    : { field: item.field, operator: item.operator, value: String(item.value ?? '').trim(), conjunction: item.conjunction === 'or' ? 'or' : 'and' })
}
const tableFilters = computed(() => cleanFilterList(activeFilters.value))
const lastSync = computed(() => syncState.value?.last_success_at ? new Date(syncState.value.last_success_at).toLocaleString() : '尚未成功同步')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const statusLabel = computed(() => ({ success: '同步完成', partial: '同步不完整', failed: '同步失败', never: '尚未同步' }[syncState.value?.status] || '尚未同步'))
const partialMessage = computed(() => {
  const reason = syncState.value?.truncation_reason || syncState.value?.truncationReason
  const fetched = Number(syncState.value?.fetched_count ?? syncState.value?.fetchedCount ?? 0)
  const reported = Number(syncState.value?.reported_total ?? syncState.value?.reportedTotal)
  const count = Number.isFinite(reported) && reported > 0 ? `已抓取 ${fetched} / 来源报告 ${reported} 条。` : `已抓取 ${fetched} 条。`
  const messages = {
    cursor_repeated: '旧版看到游标重复时就提前停止了；这次更新会检查任务页是否仍有新内容。',
    repeated_page: '来源在仍有后续页时重复返回同一批任务，已停止以避免无效请求。',
    cursor_parameter_missing: '来源返回了下一页游标，但工具参数中没有可用的游标字段。',
    next_page_without_cursor: '来源提示还有下一页，但没有返回可继续读取的游标。',
    page_limit: '扫描达到 30 页上限时，来源仍有后续页面。',
    empty_page_with_next_cursor: '来源返回了空页面但仍提供后续游标，已停止扫描。',
    reported_total_exceeds_fetched: '来源报告的总数大于本次实际抓取数。',
  }
  return `${messages[reason] || '分页没有完整结束，暂时无法确认本地数据是否齐全。'}${count}已抓取任务保留在本地，请点击页面右上角的“同步”按钮重试。`
})

async function load() {
  loading.value = true; error.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value), q: query.value, filters: JSON.stringify(tableFilters.value), sorts: JSON.stringify(sorts.value), groupBy: groupBy.value })
    const result = await apiJson(`/api/tasks?${params}`)
    tasks.value = result.tasks; total.value = result.total; groupCount.value = result.groupCount || 0; syncState.value = result.syncState
  } catch (reason) { error.value = reason.message }
  finally { loading.value = false }
}
function taskUrl(task) { return `https://www.teambition.com/task/${encodeURIComponent(task.id)}` }
function formatDate(value) { return value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('zh-CN') : '—' }
function formatDateTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function stateText(value) { return ({ unfinished: '进行中', completed: '已完成', archived: '已归档' })[value] || value || '未知' }
function taskStatusText(task) { return task?.tfsName || stateText(task?.state) }
function groupLabel(value) { return groupBy.value === 'state' ? stateText(value) : value || '未填写' }
let searchTimer
watch([query, () => JSON.stringify(tableFilters.value), () => JSON.stringify(sorts.value), groupBy], () => { page.value = 1; clearTimeout(searchTimer); searchTimer = setTimeout(load, 220) })
watch([fieldOrder, visibleFields, rowDensity], () => { try { localStorage.setItem('workhub.tasks.table.v1', JSON.stringify({ order: fieldOrder.value, visible: visibleFields.value, density: rowDensity.value })) } catch {} }, { deep: true })
watch(pageCount, (count) => { if (page.value > count) page.value = count })
watch(() => host.revision.value, load)
watch([page, pageSize], load)
onMounted(async () => {
  await load()
  if (syncState.value?.status === 'never') {
    try { await host.syncTasks(); await load() }
    catch (reason) { error.value = reason.message }
  }
})
onUnmounted(() => { clearTimeout(searchTimer) })
</script>

<template>
  <div class="tasks-page"><UiTableView
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:density="rowDensity"
    v-model:group-by="groupBy"
    v-model:field-order="fieldOrder"
    v-model:visible-fields="visibleFields"
    v-model:filters="filters"
    v-model:sorts="sorts"
    v-model:query="query"
    :columns="taskColumns"
    :rows="tasks"
    :total="total"
    :loading="loading"
    :page-count="pageCount"
    :adaptive-page-size="true"
    :group-count="groupCount"
    :group-label="groupLabel"
    :fields="taskFields"
    :filter-fields="filterFields"
    :fixed-fields="['title']"
    :views="tableViewList"
    :active-view-id="activeViewId"
    :view-dirty="isViewDirty"
    :detail-enabled="true"
    :get-row-url="taskUrl"
    min-width="1100"
    row-key="id"
    title="任务清单"
    empty-text="没有符合条件的任务。"
    @select-view="tableViews.select"
    @save-view="tableViews.save"
    @overwrite-view="tableViews.overwriteCurrent"
    @rename-view="tableViews.rename"
    @delete-view="tableViews.remove"
  >
    <template #before-table><div v-if="syncState?.status === 'partial'" class="tasks-notice">{{ partialMessage }}</div><p v-if="error" class="error-banner" role="alert">{{ error }}</p></template>
    <template #summary><strong>{{ total.toLocaleString() }}</strong><span>{{ hasActiveFilters ? '条筛选结果' : '条本地任务' }}</span><small>{{ statusLabel }} · {{ lastSync }}<template v-if="syncState?.status === 'success'"> · 本次新增 {{ syncState.inserted_count }} / 更新 {{ syncState.updated_count }} / 未变 {{ syncState.unchanged_count }}</template></small></template>
    <template #cell-title="{ row }"><span class="task-title" :title="row.title">{{ row.title }}</span></template>
    <template #cell-projectName="{ row }">{{ row.projectName || '—' }}</template>
    <template #cell-executorName="{ row }">{{ row.executorName || '—' }}</template>
    <template #cell-tagNames="{ row }"><span class="task-tags" :title="row.tagNames?.join('、') || '—'">{{ row.tagNames?.join('、') || '—' }}</span></template>
    <template #cell-state="{ row }"><span class="task-state" :class="{ completed: !row.tfsName && row.state === 'completed', archived: !row.tfsName && row.state === 'archived' }">{{ taskStatusText(row) }}</span></template>
    <template #cell-dueDate="{ row }">{{ formatDate(row.dueDate) }}</template>
    <template #cell-updated="{ row }">{{ formatDate(row.updated) }}</template>
    <template #detail="{ row }">
      <section class="task-detail-group">
        <div class="task-detail-row"><span>状态</span><strong>{{ taskStatusText(row) }}</strong></div>
        <div class="task-detail-row"><span>优先级</span><strong>{{ priorityLabel(row.priority) }}</strong></div>
        <div class="task-detail-row"><span>执行人</span><strong>{{ row.executorName || row.executorId || '—' }}</strong></div>
        <div class="task-detail-row"><span>创建人</span><strong>{{ row.creatorName || row.creatorId || '—' }}</strong></div>
        <div class="task-detail-row"><span>所属项目</span><strong>{{ row.projectName || row.projectId || '—' }}</strong></div>
        <div class="task-detail-row"><span>父任务</span><strong>{{ row.parentTitle || row.parentTaskId || '—' }}</strong></div>
        <div class="task-detail-row"><span>参与者</span><strong>{{ row.involveMemberNames?.join('、') || '—' }}</strong></div>
        <div class="task-detail-row"><span>标签</span><strong>{{ row.tagNames?.join('、') || '—' }}</strong></div>
        <div class="task-detail-row"><span>开始时间</span><strong>{{ formatDateTime(row.startDate) }}</strong></div>
        <div class="task-detail-row"><span>截止时间</span><strong>{{ formatDate(row.dueDate) }}</strong></div>
        <div class="task-detail-row"><span>完成时间</span><strong>{{ formatDateTime(row.accomplishTime) }}</strong></div>
        <div class="task-detail-row"><span>创建时间</span><strong>{{ formatDateTime(row.created) }}</strong></div>
        <div class="task-detail-row"><span>更新时间</span><strong>{{ formatDateTime(row.updated) }}</strong></div>
        <div class="task-detail-row"><span>任务 ID</span><strong>{{ row.id }}</strong></div>
      </section>
      <section v-if="row.note" class="task-detail-section"><h3>任务描述</h3><p>{{ detailValue(row.note) }}</p></section>
      <section v-if="row.customfields?.length" class="task-detail-section"><h3>自定义字段</h3><div v-for="(field, index) in row.customfields" :key="field.id || field.name || index" class="task-detail-row"><span>{{ fieldLabel(field, index) }}</span><strong>{{ fieldValue(field) }}</strong></div></section>
      <section v-if="extraTaskFields(row).length" class="task-detail-section"><h3>其他来源字段</h3><div v-for="[key, value] in extraTaskFields(row)" :key="key" class="task-detail-row"><span>{{ key }}</span><strong>{{ detailValue(value) }}</strong></div></section>
    </template>
  </UiTableView></div>
</template>

<style scoped>
.tasks-panel { padding: 0 20px 14px; }
.tasks-toolbar, .tasks-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tasks-toolbar { position: relative; flex-wrap: wrap; padding: 13px 0; border-bottom: 1px solid var(--border); }
.table-view-tabs { display: flex; align-items: center; gap: 3px; min-height: 34px; padding: 2px; border: 1px solid #34373d; border-radius: 6px; background: #1d1f22; }
.table-view-tabs button { min-height: 28px; padding: 0 11px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #929ba7; font-size: 11px; white-space: nowrap; cursor: pointer; }
.table-view-tabs button:hover { color: #d5d9df; }
.table-view-tabs button.active { border-color: #3a3d43; background: #2a2c31; color: #e0e3e8; box-shadow: 0 1px 3px #0005; }
.table-view-save { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 5px; border: 1px solid #3a424b; border-radius: 5px; background: #202328; }
.table-view-save-prompt, .table-view-save-action, .table-view-cancel { padding: 5px 7px; border: 0; border-radius: 4px; background: transparent; color: #aebdcc; font-size: 10px; white-space: nowrap; cursor: pointer; }
.table-view-save-prompt { color: #9bc2d1; }
.table-view-save-action { background: #2d3b43; color: #c1d6df; }
.table-view-save-action:disabled { opacity: .45; cursor: default; }
.table-view-cancel { color: #8993a0; }
.table-view-save input { width: 115px; height: 26px; padding: 0 6px; border: 1px solid #3b424a; border-radius: 4px; outline: none; background: #191b1f; color: #d8d9dc; font-size: 10px; }
.tasks-summary { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; color: #8e9bad; font-size: 11px; }
.tasks-summary strong { color: #d7dde6; font-size: 18px; font-weight: 550; }
.tasks-summary small { margin-left: 5px; color: #758294; font-size: 10px; }
.tasks-toolbar-controls { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; margin-left: auto; }
.table-tool { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #aeb6c1; font-size: 11px; white-space: nowrap; }
.table-tool:hover, .table-tool.active { border-color: #35383e; background: #24262a; color: #e0e3e8; }
.table-tool span, .table-tool small { color: #7f8996; font-size: 9px; font-weight: 400; }
.table-search { display: flex; align-items: center; gap: 8px; width: 205px; height: 31px; margin-left: 5px; padding: 0 8px; border: 1px solid #34373d; border-radius: 5px; background: #1d1f22; }
.table-search input { width: 100%; min-width: 0; padding: 5px 0; border: 0; outline: 0; background: transparent; color: #d5d9df; font-size: 10px; }
.table-search input:focus-visible { outline: 0; }
.table-search input::-webkit-search-cancel-button { display: none; }
.table-search button { display: grid; flex: 0 0 18px; place-items: center; width: 18px; height: 18px; padding: 0; border: 0; background: transparent; color: #87919e; }
.search-icon { position: relative; flex: 0 0 12px; width: 12px; height: 12px; margin: 0 2px 2px 0; border: 1.5px solid #8290a2; border-radius: 50%; }
.search-icon::after { position: absolute; right: -4px; bottom: -2px; width: 5px; height: 1.5px; border-radius: 1px; background: #8290a2; content: ''; transform: rotate(45deg); transform-origin: left center; }
.toolbar-popover { position: fixed; z-index: 50; max-height: min(70vh, 520px); overflow: auto; border: 1px solid #3b3e44; border-radius: 8px; background: #202226; box-shadow: 0 12px 34px #0008; color: #c7cbd2; }
.toolbar-popover > header { display: grid; gap: 5px; padding: 13px 15px 11px; border-bottom: 1px solid #34373d; }
.toolbar-popover > header strong { color: #e0e3e8; font-size: 12px; font-weight: 550; }
.toolbar-popover > header span, .toolbar-popover > footer > span { color: #7f8996; font-size: 10px; }
.toolbar-popover > footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 40px; padding: 6px 13px; border-top: 1px solid #34373d; }
.field-popover { width: min(300px, calc(100vw - 44px)); }
.field-list { max-height: 300px; overflow: auto; padding: 4px 7px; }
.field-setting-row { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 2px 4px; border-radius: 4px; }
.field-setting-row:hover { background: #292c31; }
.field-drag-mark { color: #626b76; font-size: 15px; cursor: grab; }
.field-setting-row input { width: 14px; height: 14px; margin: 0; accent-color: #71869a; }
.field-setting-row label { flex: 1; color: #c3c9d1; font-size: 11px; cursor: pointer; }
.field-setting-row > button, .icon-tool { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #89929d; font-size: 12px; }
.field-setting-row > button:hover, .icon-tool:hover { background: #35383e; color: #e0e3e8; }
.field-setting-row > button:disabled, .icon-tool:disabled { opacity: .35; cursor: default; }
.text-action { padding: 4px 3px; border: 0; background: transparent; color: #aeb8c4; font-size: 10px; }
.text-action:hover:not(:disabled) { background: transparent; color: #e0e3e8; }
.text-action:disabled { opacity: .4; cursor: default; }
.filter-rules, .sort-rules { display: grid; gap: 7px; max-height: 270px; overflow: auto; padding: 12px; }
.filter-rule { display: grid; grid-template-columns: 42px minmax(105px, 1fr) minmax(95px, .85fr) minmax(120px, 1.2fr) 25px; align-items: center; gap: 7px; }
.filter-first-join { color: #8e98a4; font-size: 11px; text-align: center; }
.filter-rule :deep(.ui-select-trigger), .sort-rule :deep(.ui-select-trigger), .popover-select :deep(.ui-select-trigger) { min-height: 32px; height: 32px; padding: 5px 8px; border-color: #3a3d43; border-radius: 5px; background: #25272b; color: #c7cbd2; font-size: 10px; }
.filter-rule :deep(.ui-select-trigger:hover:not(:disabled)), .sort-rule :deep(.ui-select-trigger:hover:not(:disabled)), .popover-select :deep(.ui-select-trigger:hover:not(:disabled)) { background: #2a2c31; }
.filter-rule input { height: 32px; padding: 5px 8px; border-color: #3a3d43; border-radius: 5px; background: #25272b; color: #c7cbd2; font-size: 10px; }
.filter-rule input { width: 100%; }
.filter-rule input[type="date"] { color-scheme: dark; }
.popover-empty { padding: 17px 14px; color: #7e8792; font-size: 10px; }
.small-popover { width: min(290px, calc(100vw - 44px)); padding-bottom: 13px; }
.popover-select { display: grid; gap: 6px; padding: 12px 14px 0; color: #8a939e; font-size: 10px; }
.sort-popover { width: min(390px, calc(100vw - 44px)); }
.sort-rule { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(90px, .8fr) 25px; align-items: center; gap: 7px; }
.density-popover { width: 190px; padding-bottom: 5px; }
.density-option { display: flex; align-items: center; gap: 10px; width: calc(100% - 10px); min-height: 34px; margin: 2px 5px; padding: 5px 8px; border: 0; border-radius: 4px; background: transparent; color: #c3c9d1; text-align: left; font-size: 11px; }
.density-option:hover, .density-option.selected { background: #2b2e33; }
.density-sample { color: #858e99; font-size: 14px; }
.selected-mark { margin-left: auto; color: #aab4c0; }
.tasks-notice { padding: 9px 11px; border: 1px solid #594c33; border-radius: 6px; color: #c8b581; background: #28251e; font-size: 10px; }
.task-detail-group { border-top: 1px solid #30343b; }
.task-detail-row { display: grid; grid-template-columns: minmax(100px, 28%) minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid #30343b; font-size: 14px; line-height: 1.55; }
.task-detail-row > span { color: #818b99; }
.task-detail-row > strong { color: #d2d8e1; font-weight: 500; overflow-wrap: anywhere; white-space: pre-wrap; }
.task-detail-section { margin-top: 20px; }
.task-detail-section h3 { margin: 0 0 8px; color: #969fac; font-size: 11px; font-weight: 600; }
.task-detail-section p { margin: 0; color: #d2d8e1; font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; white-space: pre-wrap; }
.tasks-pagination { justify-content: space-between; padding-top: 12px; color: #7f8b9a; font-size: 10px; }
.pagination-controls { display: grid; flex: 0 0 260px; grid-template-columns: 28px 28px 20px repeat(3, 28px) 20px 28px 28px; align-items: center; gap: 3px; width: 260px; font-variant-numeric: tabular-nums; }
.pagination-controls button { display: grid; width: 28px; min-width: 28px; height: 28px; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #aeb8c4; font-size: 11px; cursor: pointer; transition: none; }
.pagination-controls button:hover:not(:disabled) { border-color: #383d46; background: #22252a; color: #e0e3e8; }
.pagination-controls button.current { border-color: #46515e; background: #2a2e34; color: #e0e3e8; }
.pagination-controls button:disabled { opacity: .35; cursor: default; }
.pagination-ellipsis { display: grid; width: 20px; height: 28px; place-items: center; color: #788392; text-align: center; }
.pagination-page-slot { display: grid; width: 28px; height: 28px; }
@media (max-width: 760px) { .tasks-panel { padding: 0 12px 10px; } .tasks-toolbar { align-items: flex-start; } .table-view-tabs { width: 100%; } .tasks-toolbar-controls { width: 100%; margin-left: 0; } .table-search { flex: 1 1 180px; } .tasks-summary small { width: 100%; margin-left: 0; } .filter-rule { grid-template-columns: 42px minmax(90px, 1fr) minmax(85px, .8fr) 25px; } .filter-rule > :nth-child(4) { grid-column: 2 / 4; grid-row: 2; } .filter-rule > .icon-tool { grid-column: 4; grid-row: 1 / 3; } }
</style>
