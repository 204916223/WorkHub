<script setup>
import { computed, inject, onMounted, ref, watch } from 'vue'
import { apiJson } from '../../web/src/services/api.js'
import { useSavedTableViews } from '../../web/src/features/table/useSavedTableViews.js'
import AssetIcon from '../../web/src/components/AssetIcon.vue'
import { UiTableView } from '../../web/src/components/ui/index.js'
import { detailValue, extraTaskFields, fieldLabel, fieldValue, priorityLabel } from '../../web/src/features/table/taskDetailFormat.js'

const host = inject('host')
const tasks = ref([]), loading = ref(true), error = ref('')
const query = ref(''), page = ref(1), pageSize = ref(30), filters = ref([]), groupBy = ref(''), density = ref('normal')
const settingsStorageKey = 'workhub.worktime.settings.v2'
const legacySettingsStorageKey = 'workhub.worktime.settings.v1'
const savedWorktimeSettings = (() => { try { return JSON.parse(localStorage.getItem(settingsStorageKey) || localStorage.getItem(legacySettingsStorageKey) || '{}') } catch { return {} } })()
const currentQuarterKey = (() => { const now = new Date(); return `${now.getFullYear()} Q${Math.floor(now.getMonth() / 3) + 1}` })()
const annualLeaveByQuarter = ref({ ...(savedWorktimeSettings.annualLeaveByQuarter || {}) })
const worktimeCoefficient = ref(Number.isFinite(Number(savedWorktimeSettings.coefficient)) ? Number(savedWorktimeSettings.coefficient) : 1)
const annualLeaveDays = ref(Number.isFinite(Number(annualLeaveByQuarter.value[currentQuarterKey]))
  ? Number(annualLeaveByQuarter.value[currentQuarterKey])
  : savedWorktimeSettings.year === new Date().getFullYear() && Number.isFinite(Number(savedWorktimeSettings.annualLeaveDays)) ? Number(savedWorktimeSettings.annualLeaveDays) : 0)
if (!Object.hasOwn(annualLeaveByQuarter.value, currentQuarterKey)) annualLeaveByQuarter.value[currentQuarterKey] = annualLeaveDays.value
const worktimeCoefficientInput = ref(String(worktimeCoefficient.value))
const annualLeaveDaysInput = ref(String(annualLeaveDays.value))
const reportNotice = ref('')
const showProgressActual = ref(true), showProgressWorkday = ref(true)
const fieldKeys = ['title', 'projectName', 'executorName', 'tagNames', 'state', 'dueDate', 'actualEffectiveWorkdays', 'workdayDuration', 'included']
const fields = [
  { key: 'title', label: '任务标题', type: 'text' },
  { key: 'projectName', label: '项目', type: 'text' },
  { key: 'executorName', label: '负责人', type: 'text' },
  { key: 'tagNames', label: '标签', type: 'text' },
  { key: 'state', label: '状态', type: 'select', options: [{ value: 'unfinished', label: '进行中' }, { value: 'completed', label: '已完成' }] },
  { key: 'dueDate', label: '截止日期', type: 'date' },
  { key: 'actualEffectiveWorkdays', label: '实际有效工时', type: 'number' },
  { key: 'workdayDuration', label: '工作日耗时', type: 'number' },
  { key: 'included', label: '是否计入工时', type: 'select', options: [{ value: 'true', label: '计入' }, { value: 'false', label: '不计入' }] },
]
const fixedFields = ['title']
const preferenceDefaults = [...fieldKeys]
const savedPreferences = (() => { try { return JSON.parse(localStorage.getItem('workhub.worktime.table.v1') || '{}') } catch { return {} } })()
density.value = ['compact', 'normal', 'comfortable'].includes(savedPreferences.density) ? savedPreferences.density : 'normal'
const fieldOrder = ref([...new Set([...(Array.isArray(savedPreferences.order) ? savedPreferences.order : []), ...fieldKeys].filter((key) => fieldKeys.includes(key)))])
const visibleFields = ref([...new Set(['title', ...(Array.isArray(savedPreferences.visible) ? savedPreferences.visible : preferenceDefaults)].filter((key) => fieldKeys.includes(key)))])
const sorts = ref([{ field: 'dueDate', direction: 'desc' }])
function quarterRange(now = new Date()) {
  const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0)
  return { start: localIsoDate(start), end: localIsoDate(end) }
}
function makeDefaultFilters(now = new Date()) {
  const quarter = quarterRange(now)
  return [
    { field: 'projectName', operator: 'equals', value: '本体开发部', conjunction: 'and' },
    { field: 'dueDate', operator: 'on_or_after', value: quarter.start, conjunction: 'and' },
    { field: 'dueDate', operator: 'on_or_before', value: quarter.end, conjunction: 'and' },
  ]
}
const defaultFilters = makeDefaultFilters()
function normalizeSorts(config) {
  if (Array.isArray(config.sorts) && config.sorts.length) return config.sorts.filter((sort) => fieldKeys.includes(sort.field)).slice(0, 4)
  return [{ field: fieldKeys.includes(config.sortField) ? config.sortField : 'dueDate', direction: config.sortDirection === 'asc' ? 'asc' : 'desc' }]
}
function migrateWorktimeViews() {
  try {
    if (localStorage.getItem('workhub.worktime.views.v5')) return
    const old = JSON.parse(localStorage.getItem('workhub.worktime.views.v4') || localStorage.getItem('workhub.worktime.views.v3') || 'null')
    if (!old || !Array.isArray(old.views)) return
    const views = old.views.map((view) => ({ ...view, config: { ...view.config, filters: view.id === 'default' ? defaultFilters : (view.config?.filters || []), sorts: normalizeSorts(view.config || {}) } }))
    localStorage.setItem('workhub.worktime.views.v5', JSON.stringify({ views, activeId: old.activeId }))
  } catch {}
}
migrateWorktimeViews()
function refreshDefaultWorktimeFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem('workhub.worktime.views.v5') || 'null')
    if (!saved || !Array.isArray(saved.views)) return
    const defaultView = saved.views.find((view) => view.id === 'default')
    if (!defaultView) return
    defaultView.config = { ...(defaultView.config || {}), filters: defaultFilters }
    localStorage.setItem('workhub.worktime.views.v5', JSON.stringify(saved))
  } catch {}
}
refreshDefaultWorktimeFilters()
function migrateWorktimeTagDefaultVisibility() {
  const marker = 'workhub.worktime.tag-default-visible.v1'
  try {
    if (localStorage.getItem(marker)) return
    const includeTag = (keys) => [...new Set([...(Array.isArray(keys) ? keys : fieldKeys), 'tagNames'])]
    if (Array.isArray(savedPreferences.visible)) {
      const preferences = { ...savedPreferences, visible: includeTag(savedPreferences.visible) }
      localStorage.setItem('workhub.worktime.table.v1', JSON.stringify(preferences))
      visibleFields.value = [...new Set(['title', ...preferences.visible.filter((key) => fieldKeys.includes(key))])]
    } else visibleFields.value = [...new Set([...visibleFields.value, 'tagNames'])]
    const saved = JSON.parse(localStorage.getItem('workhub.worktime.views.v5') || 'null')
    const defaultView = saved?.views?.find((view) => view.id === 'default')
    if (defaultView?.config) {
      defaultView.config.visibleFields = includeTag(defaultView.config.visibleFields)
      localStorage.setItem('workhub.worktime.views.v5', JSON.stringify(saved))
    }
    localStorage.setItem(marker, '1')
  } catch {}
}
migrateWorktimeTagDefaultVisibility()
const initialViewConfig = { query: '', filters: defaultFilters, fieldOrder: fieldOrder.value, visibleFields: visibleFields.value, groupBy: '', sorts: sorts.value, density: density.value }
const tableViews = useSavedTableViews({
  storageKey: 'workhub.worktime.views.v5',
  initialConfig: initialViewConfig,
  getConfig: () => ({ query: query.value, filters: filters.value, fieldOrder: fieldOrder.value, visibleFields: visibleFields.value, groupBy: groupBy.value, sorts: sorts.value, density: density.value }),
  applyConfig: (config) => {
    query.value = String(config.query || '')
    filters.value = Array.isArray(config.filters) ? config.filters : []
    fieldOrder.value = [...new Set([...(Array.isArray(config.fieldOrder) ? config.fieldOrder : []), ...fieldKeys].filter((key) => fieldKeys.includes(key)))]
    visibleFields.value = [...new Set(['title', ...(Array.isArray(config.visibleFields) ? config.visibleFields : fieldKeys).filter((key) => fieldKeys.includes(key))])]
    groupBy.value = fieldKeys.includes(config.groupBy) ? config.groupBy : ''
    sorts.value = normalizeSorts(config)
    density.value = ['compact', 'normal', 'comfortable'].includes(config.density || config.rowDensity) ? (config.density || config.rowDensity) : 'normal'
  },
})
const { views, activeId, dirty } = tableViews
function isActiveFilter(node) {
  if (node?.type === 'group') return (node.rules || []).some(isActiveFilter)
  return node?.operator === 'is_empty' || node?.operator === 'is_not_empty' || String(node?.value ?? '').trim() !== ''
}
const activeFilters = computed(() => filters.value.filter(isActiveFilter))
function matchesRule(task, rule) {
  const actual = task[rule.field], operator = rule.operator, expected = rule.value
  if (operator === 'is_empty') return actual == null || actual === ''
  if (operator === 'is_not_empty') return actual != null && actual !== ''
  if (actual == null || actual === '') return false
  if (['actualEffectiveWorkdays', 'workdayDuration'].includes(rule.field)) {
    const left = Number(actual), right = Number(expected)
    if (!Number.isFinite(right)) return false
    if (operator === 'greater_than') return left > right
    if (operator === 'less_than') return left < right
    if (operator === 'equals') return left === right
    if (operator === 'not_equals') return left !== right
  }
  const left = rule.field === 'dueDate' ? String(actual).slice(0, 10) : rule.field === 'included' ? String(Boolean(actual)) : String(actual).toLocaleLowerCase()
  const right = rule.field === 'included' ? String(expected) : String(expected).toLocaleLowerCase()
  if (operator === 'contains') return left.includes(right)
  if (operator === 'before') return left < right
  if (operator === 'on_or_before') return left <= right
  if (operator === 'after') return left > right
  if (operator === 'on_or_after') return left >= right
  if (operator === 'not_equals') return left !== right
  return left === right
}
const filteredTasks = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return tasks.value.filter((task) => {
    if (term && !`${task.title} ${task.projectName} ${task.executorName}`.toLocaleLowerCase().includes(term)) return false
    function matchesList(nodes) {
      const active = nodes.filter(isActiveFilter)
      if (!active.length) return true
      const matchesNode = (node) => node.type === 'group' ? matchesList(node.rules || []) : matchesRule(task, node)
      let result = matchesNode(active[0])
      for (const node of active.slice(1)) {
        const matched = matchesNode(node)
        result = node.conjunction === 'or' ? result || matched : result && matched
      }
      return result
    }
    return matchesList(activeFilters.value)
  })
})
const workdayCalendarExceptions = {
  // 2026 official holiday calendar: State Council notice, 国办发明电〔2025〕7号.
  2026: { holidays: new Set(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']), makeUpWorkdays: new Set(['2026-10-10']) },
}
function localIsoDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function countWorkdays(from, to) {
  if (to < from) return 0
  const exceptions = workdayCalendarExceptions[from.getFullYear()] || { holidays: new Set(), makeUpWorkdays: new Set() }
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  let count = 0
  while (cursor <= end) {
    const date = localIsoDate(cursor), weekday = cursor.getDay()
    if (exceptions.makeUpWorkdays.has(date) || ((weekday !== 0 && weekday !== 6) && !exceptions.holidays.has(date))) count++
    cursor.setDate(cursor.getDate() + 1)
  }
  return count
}
function flattenFilterRules(nodes) {
  const rules = []
  let allAnd = true
  for (const [index, node] of (nodes || []).entries()) {
    if (!node || !isActiveFilter(node)) continue
    if (index > 0 && node.conjunction === 'or') allAnd = false
    if (node.type === 'group') {
      const child = flattenFilterRules(node.rules || [])
      if (!child.allAnd) allAnd = false
      rules.push(...child.rules)
    } else rules.push(node)
  }
  return { rules, allAnd }
}
function selectedQuarterFromFilters() {
  const active = filters.value.filter(isActiveFilter)
  const { rules, allAnd } = flattenFilterRules(active)
  if (!allAnd) return null
  const dateRules = rules.filter((rule) => rule.field === 'dueDate' && rule.value && ['equals', 'before', 'on_or_before', 'after', 'on_or_after'].includes(rule.operator))
  if (!dateRules.length) return null
  let lower = '', upper = ''
  for (const rule of dateRules) {
    let value = String(rule.value).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
    if (rule.operator === 'equals') { lower = lower ? (lower > value ? lower : value) : value; upper = upper ? (upper < value ? upper : value) : value }
    if (rule.operator === 'on_or_after' || rule.operator === 'after') {
      if (rule.operator === 'after') { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() + 1); value = localIsoDate(date) }
      lower = lower ? (lower > value ? lower : value) : value
    }
    if (rule.operator === 'on_or_before' || rule.operator === 'before') {
      if (rule.operator === 'before') { const date = new Date(`${value}T00:00:00`); date.setDate(date.getDate() - 1); value = localIsoDate(date) }
      upper = upper ? (upper < value ? upper : value) : value
    }
  }
  if (!lower || !upper || lower > upper) return null
  const from = new Date(`${lower}T00:00:00`), to = new Date(`${upper}T00:00:00`)
  const quarterIndex = Math.floor(from.getMonth() / 3)
  if (from.getFullYear() !== to.getFullYear() || quarterIndex !== Math.floor(to.getMonth() / 3)) return null
  return { year: from.getFullYear(), quarterIndex }
}
const quarterProgress = computed(() => {
  const today = new Date(), selected = selectedQuarterFromFilters()
  const year = selected?.year ?? today.getFullYear(), quarterIndex = selected?.quarterIndex ?? Math.floor(today.getMonth() / 3)
  const start = new Date(year, quarterIndex * 3, 1)
  const end = new Date(year, quarterIndex * 3 + 3, 0)
  const elapsedEnd = today < start ? new Date(start.getTime() - 86400000) : today > end ? end : today
  const total = countWorkdays(start, end), elapsed = elapsedEnd < start ? 0 : countWorkdays(start, elapsedEnd)
  const leave = Math.max(0, Number(annualLeaveDays.value) || 0)
  const denominator = Math.max(0, total - leave)
  const elapsedAfterLeave = Math.max(0, elapsed - leave)
  return { title: `${year} Q${quarterIndex + 1}`, start: localIsoDate(start), end: localIsoDate(end), total, elapsed, denominator, elapsedAfterLeave, percent: denominator ? Math.min(100, elapsedAfterLeave / denominator * 100) : 0, isFilterRange: Boolean(selected) }
})
const coefficientTarget = computed(() => quarterProgress.value.denominator * Math.max(0, Number(worktimeCoefficient.value) || 0))
const coefficientTargetPercent = computed(() => quarterProgress.value.denominator ? Math.min(100, Math.max(0, coefficientTarget.value / quarterProgress.value.denominator * 100)) : 0)
watch(() => quarterProgress.value.title, (title, previous) => {
  if (previous) annualLeaveByQuarter.value[previous] = annualLeaveDays.value
  annualLeaveDays.value = Math.max(0, Number(annualLeaveByQuarter.value[title]) || 0)
}, { immediate: true })
function dateInRange(value, start, end) {
  const date = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= end
}
function dueMatchesQuarterOrOverdue(task, start, end) {
  if (dateInRange(task.dueDate, start, end)) return true
  const dueDate = String(task.dueDate || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate >= start) return false
  return (Array.isArray(task.tagNames) ? task.tagNames : []).some((name) => String(name || '').includes('季度逾期'))
}
const quarterTransitionWorktime = computed(() => {
  const { start, end } = quarterProgress.value
  const eligible = tasks.value.map((task) => {
    if (task.projectName !== '本体开发部') return null
    const tfsName = String(task.tfsName || '').trim()
    const completed = tfsName === '已完成' || (!tfsName && (task.state === 'completed' || task.isDone === true))
    const review = tfsName === '待评审'
    if (!completed && !review) return null
    const transitionedAt = review ? task.statusChangedAt : (task.statusChangedAt || task.accomplishTime)
    if (!dateInRange(transitionedAt, start, end)) return null
    if (!dueMatchesQuarterOrOverdue(task, start, end)) return null
    return { task, bucket: review ? 'review' : 'completed' }
  }).filter(Boolean)
  const sum = (field, bucket) => eligible.reduce((total, entry) => {
    if (entry.bucket !== bucket) return total
    if (field === 'workdayDuration' && !entry.task.included) return total
    const task = entry.task
    const value = Number(task[field])
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)
  return {
    reviewCount: eligible.filter((entry) => entry.bucket === 'review').length,
    completedCount: eligible.filter((entry) => entry.bucket === 'completed').length,
    transitionMissingCount: tasks.value.filter((task) => {
      if (task.projectName !== '本体开发部' || !dueMatchesQuarterOrOverdue(task, start, end)) return false
      const tfsName = String(task.tfsName || '').trim()
      const completed = tfsName === '已完成' || (!tfsName && (task.state === 'completed' || task.isDone === true))
      const review = tfsName === '待评审'
      return (review && !task.statusChangedAt) || (completed && !(task.statusChangedAt || task.accomplishTime))
    }).length,
    reviewActual: sum('actualEffectiveWorkdays', 'review'),
    completedActual: sum('actualEffectiveWorkdays', 'completed'),
    reviewWorkday: sum('workdayDuration', 'review'),
    completedWorkday: sum('workdayDuration', 'completed'),
  }
})
function progressPercent(value) {
  return quarterProgress.value.denominator ? Math.min(100, Math.max(0, value / quarterProgress.value.denominator * 100)) : 0
}
const includedFilteredTasks = computed(() => filteredTasks.value.filter((task) => task.included))
function workdayTotal(field) {
  const values = includedFilteredTasks.value.map((task) => task[field]).filter((value) => value != null && Number.isFinite(Number(value))).map(Number)
  return values.length ? `${formatDays(values.reduce((sum, value) => sum + value, 0))} 天` : '—'
}
const filteredWorkdayDuration = computed(() => workdayTotal('workdayDuration'))
const filteredActualEffectiveWorkdays = computed(() => workdayTotal('actualEffectiveWorkdays'))
function compareValue(left, right) {
  if (typeof left === 'number' || typeof right === 'number') return Number(left || 0) - Number(right || 0)
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', { numeric: true })
}
const sortedTasks = computed(() => [...filteredTasks.value].sort((left, right) => {
  for (const sort of sorts.value) {
    const compared = compareValue(left[sort.field], right[sort.field])
    if (compared) return sort.direction === 'asc' ? compared : -compared
  }
  return 0
}))
const pageCount = computed(() => Math.max(1, Math.ceil(sortedTasks.value.length / pageSize.value)))
const pageRows = computed(() => sortedTasks.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const columns = computed(() => {
  const visible = fieldOrder.value.filter((key) => visibleFields.value.includes(key))
  const weights = { title: 24, projectName: 15, executorName: 11, tagNames: 11, state: 9, dueDate: 11, actualEffectiveWorkdays: 9, workdayDuration: 8, included: 8 }
  const totalWeight = visible.reduce((sum, key) => sum + weights[key], 4)
  return [...visible.map((key) => {
    const field = fields.find((item) => item.key === key)
    return { ...field, width: `${(weights[key] / totalWeight * 100).toFixed(2)}%`, align: ['actualEffectiveWorkdays', 'workdayDuration'].includes(key) ? 'right' : undefined }
  }), { key: 'actions', label: '', width: `${(4 / totalWeight * 100).toFixed(2)}%`, align: 'center' }]
})
function taskUrl(task) { return `https://www.teambition.com/task/${encodeURIComponent(task.id)}` }
function formatDays(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }
function formatDate(value) { return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('zh-CN') : '—' }
function formatDateTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function stateText(value) { return ({ unfinished: '进行中', completed: '已完成', archived: '已归档' })[value] || value || '未知' }
function taskStatusText(task) { return task?.tfsName || stateText(task?.state) }
function groupLabel(value) { return groupBy.value === 'state' ? stateText(value) : value || '未填写' }
function commitCoefficient() {
  const numeric = Number(worktimeCoefficientInput.value)
  if (!Number.isFinite(numeric)) { worktimeCoefficientInput.value = String(worktimeCoefficient.value); return }
  worktimeCoefficient.value = Math.round(Math.max(0, numeric) * 10) / 10
  worktimeCoefficientInput.value = String(worktimeCoefficient.value)
}
function commitAnnualLeave() {
  const numeric = Number(annualLeaveDaysInput.value)
  if (!Number.isFinite(numeric)) { annualLeaveDaysInput.value = String(annualLeaveDays.value); return }
  annualLeaveDays.value = Math.round(Math.max(0, numeric) * 2) / 2
  annualLeaveDaysInput.value = String(annualLeaveDays.value)
}
async function load() {
  loading.value = true; error.value = ''
  try { const result = await apiJson('/api/worktime'); tasks.value = result.tasks || [] }
  catch (cause) { error.value = cause.message }
  finally { loading.value = false }
}
watch([query, filters, sorts, groupBy], () => { page.value = 1 }, { deep: true })
watch([fieldOrder, visibleFields, density], () => { try { localStorage.setItem('workhub.worktime.table.v1', JSON.stringify({ order: fieldOrder.value, visible: visibleFields.value, density: density.value })) } catch {} }, { deep: true })
watch([worktimeCoefficient, annualLeaveDays], () => {
  const normalize = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
  worktimeCoefficient.value = normalize(worktimeCoefficient.value)
  annualLeaveDays.value = normalize(annualLeaveDays.value)
  worktimeCoefficientInput.value = String(worktimeCoefficient.value)
  annualLeaveDaysInput.value = String(annualLeaveDays.value)
  annualLeaveByQuarter.value[quarterProgress.value.title] = annualLeaveDays.value
  try { localStorage.setItem(settingsStorageKey, JSON.stringify({ coefficient: worktimeCoefficient.value, annualLeaveByQuarter: annualLeaveByQuarter.value })) } catch {}
})
watch(pageCount, (count) => { if (page.value > count) page.value = count })
watch(() => host.revision.value, load)
onMounted(load)
</script>

<template>
  <div class="worktime-page">
    <section class="worktime-overview" aria-label="季度进度和筛选工时汇总">
      <div class="worktime-overview-topline">
        <div class="worktime-overview-metrics">
          <div class="worktime-overview-metric worktime-quarter-metric">
            <span>{{ quarterProgress.title }} 季度总工作日</span>
            <strong>{{ quarterProgress.total }} 天</strong>
          </div>
          <div class="worktime-overview-metric">
            <span>进度分母（扣除年假）</span>
            <strong>{{ formatDays(quarterProgress.denominator) }} 天</strong>
          </div>
          <div class="worktime-overview-metric">
            <span>{{ quarterProgress.isFilterRange ? '筛选季度已用' : '当前季度已用' }}（扣除年假）</span>
            <strong>{{ formatDays(quarterProgress.elapsedAfterLeave) }} 天</strong>
          </div>
          <div class="worktime-overview-metric">
            <span>筛选工作日耗时</span>
            <strong>{{ filteredWorkdayDuration }}</strong>
          </div>
          <div class="worktime-overview-metric">
            <span>筛选实际有效工时</span>
            <strong>{{ filteredActualEffectiveWorkdays }}</strong>
          </div>
        </div>
        <div class="worktime-overview-settings">
          <label><span>工时系数</span><input v-model="worktimeCoefficientInput" type="text" inputmode="decimal" aria-label="工时系数" @blur="commitCoefficient" @keydown.enter.prevent="$event.target.blur()" /></label>
          <label><span>年假（天）</span><input v-model="annualLeaveDaysInput" type="text" inputmode="decimal" aria-label="年假天数" @blur="commitAnnualLeave" @keydown.enter.prevent="$event.target.blur()" /></label>
          <div class="worktime-report-actions">
            <button type="button" @click="reportNotice = '季度总结导出功能暂未实现'">导出季度总结</button>
            <button type="button" @click="reportNotice = '年度总结导出功能暂未实现'">导出年度总结</button>
          </div>
        </div>
      </div>
      <div class="worktime-overview-meta">
        <small>{{ quarterProgress.isFilterRange ? '按截止日期筛选范围显示进度' : '未筛选单一季度，显示当前季度进度' }}</small>
        <span v-if="reportNotice" class="worktime-report-notice" role="status">{{ reportNotice }}</span>
      </div>
      <div class="worktime-progress-track" role="img" :aria-label="`${quarterProgress.title}：分母 ${formatDays(quarterProgress.denominator)} 天，已用 ${formatDays(quarterProgress.elapsedAfterLeave)} 天；待评审工作日耗时 ${formatDays(quarterTransitionWorktime.reviewWorkday)} 天，已完成工作日耗时 ${formatDays(quarterTransitionWorktime.completedWorkday)} 天，待评审实际日耗时 ${formatDays(quarterTransitionWorktime.reviewActual)} 天，已完成实际日耗时 ${formatDays(quarterTransitionWorktime.completedActual)} 天`">
        <span class="worktime-progress-elapsed" :style="{ width: `${quarterProgress.percent}%` }" />
        <span v-if="showProgressWorkday" class="worktime-progress-workday worktime-progress-review" :style="{ width: `${progressPercent(quarterTransitionWorktime.reviewWorkday)}%` }" />
        <span v-if="showProgressWorkday" class="worktime-progress-workday" :style="{ width: `${progressPercent(quarterTransitionWorktime.completedWorkday)}%` }" />
        <span v-if="showProgressActual" class="worktime-progress-actual worktime-progress-review" :style="{ width: `${progressPercent(quarterTransitionWorktime.reviewActual)}%` }" />
        <span v-if="showProgressActual" class="worktime-progress-actual" :style="{ width: `${progressPercent(quarterTransitionWorktime.completedActual)}%` }" />
        <span class="worktime-progress-target" :style="{ left: `${coefficientTargetPercent}%` }" />
      </div>
      <div class="worktime-progress-controls">
        <label><input v-model="showProgressWorkday" type="checkbox" /><i class="workday review" />工作日耗时：待评审 {{ formatDays(quarterTransitionWorktime.reviewWorkday) }} 天 / 已完成 {{ formatDays(quarterTransitionWorktime.completedWorkday) }} 天</label>
        <label><input v-model="showProgressActual" type="checkbox" /><i class="actual review" />实际有效工时：待评审 {{ formatDays(quarterTransitionWorktime.reviewActual) }} 天 / 已完成 {{ formatDays(quarterTransitionWorktime.completedActual) }} 天</label>
        <span class="worktime-progress-target-label">系数目标 {{ formatDays(coefficientTarget) }} 天</span>
        <span>待评审 {{ quarterTransitionWorktime.reviewCount }} 条 · 已完成 {{ quarterTransitionWorktime.completedCount }} 条</span>
        <span v-if="quarterTransitionWorktime.transitionMissingCount" class="worktime-progress-missing">另有 {{ quarterTransitionWorktime.transitionMissingCount }} 条任务未取得状态切换时间，请重新同步任务</span>
      </div>
      <div class="worktime-progress-caption"><span>{{ quarterProgress.start }} 至 {{ quarterProgress.end }} · 周一至周五，含已公布调休 · 进度条颜色从底层到顶层依次为已用、待评审工作日、已完成工作日、待评审实际工时、已完成实际工时</span><span>{{ formatDays(Math.max(0, quarterProgress.denominator - quarterProgress.elapsedAfterLeave)) }} 天剩余</span></div>
    </section>
    <UiTableView
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:density="density"
    v-model:group-by="groupBy"
    v-model:field-order="fieldOrder"
    v-model:visible-fields="visibleFields"
    v-model:filters="filters"
    v-model:sorts="sorts"
    v-model:query="query"
    :columns="columns"
    :rows="pageRows"
    :total="filteredTasks.length"
    :loading="loading"
    :page-count="pageCount"
    :adaptive-page-size="true"
    :group-count="groupBy ? new Set(filteredTasks.map((task) => task[groupBy] || '未填写')).size : 0"
    :group-label="groupLabel"
    :fields="fields"
    :fixed-fields="fixedFields"
    :views="views"
    :active-view-id="activeId"
    :view-dirty="dirty"
    :detail-enabled="true"
    :get-row-url="taskUrl"
    min-width="920"
    title="工时统计"
    empty-text="没有符合筛选条件的任务。"
    @select-view="tableViews.select"
    @save-view="tableViews.save"
    @overwrite-view="tableViews.overwriteCurrent"
    @rename-view="tableViews.rename"
    @delete-view="tableViews.remove"
  >
    <template #before-table><p v-if="error" class="error-banner" role="alert">{{ error }}</p></template>
    <template #summary><strong>{{ filteredTasks.length.toLocaleString() }}</strong><span>条匹配任务</span><small>统计范围仅包含当前用户本地已同步的数据</small></template>
    <template #cell-title="{ row }"><span class="worktime-title" :title="row.title">{{ row.title }}</span></template>
    <template #cell-tagNames="{ row }"><span class="worktime-tags" :title="row.tagNames?.join('、') || '—'">{{ row.tagNames?.join('、') || '—' }}</span></template>
    <template #cell-state="{ row }"><span class="worktime-state" :class="{ completed: !row.tfsName && row.state === 'completed', archived: !row.tfsName && row.state === 'archived' }">{{ taskStatusText(row) }}</span></template>
    <template #cell-dueDate="{ value }">{{ formatDate(value) }}</template>
    <template #cell-actualEffectiveWorkdays="{ row }">{{ row.included ? (row.actualEffectiveWorkdays == null ? '—' : formatDays(row.actualEffectiveWorkdays)) : '不计入' }}</template>
    <template #cell-workdayDuration="{ row }">{{ row.included ? (row.workdayDuration == null ? '—' : formatDays(row.workdayDuration)) : '不计入' }}</template>
    <template #cell-included="{ value }">{{ value ? '计入' : '不计入' }}</template>
    <template #detail="{ row }">
      <section class="worktime-detail-section"><h3>任务信息</h3><div class="worktime-detail-group">
        <div><span>状态</span><strong>{{ taskStatusText(row) }}</strong></div>
        <div><span>优先级</span><strong>{{ priorityLabel(row.priority) }}</strong></div>
        <div><span>执行人</span><strong>{{ row.executorName || row.executorId || '—' }}</strong></div>
        <div><span>创建人</span><strong>{{ row.creatorName || row.creatorId || '—' }}</strong></div>
        <div><span>所属项目</span><strong>{{ row.projectName || row.projectId || '—' }}</strong></div>
        <div><span>父任务</span><strong>{{ row.parentTitle || row.parentTaskId || '—' }}</strong></div>
        <div><span>参与者</span><strong>{{ detailValue(row.involveMemberNames?.length ? row.involveMemberNames : row.involveMembers) }}</strong></div>
        <div><span>标签</span><strong>{{ row.tagNames?.join('、') || '—' }}</strong></div>
        <div><span>开始时间</span><strong>{{ formatDateTime(row.startDate) }}</strong></div>
        <div><span>截止时间</span><strong>{{ formatDate(row.dueDate) }}</strong></div>
        <div><span>完成时间</span><strong>{{ formatDateTime(row.accomplishTime) }}</strong></div>
        <div><span>创建时间</span><strong>{{ formatDateTime(row.created) }}</strong></div>
        <div><span>更新时间</span><strong>{{ formatDateTime(row.updated) }}</strong></div>
        <div><span>任务 ID</span><strong>{{ row.id }}</strong></div>
      </div></section>
      <section v-if="row.note" class="worktime-detail-section"><h3>任务描述</h3><p>{{ detailValue(row.note) }}</p></section>
      <section v-if="row.customfields?.length" class="worktime-detail-section"><h3>自定义字段</h3><div v-for="(field, index) in row.customfields" :key="field.id || field.name || index" class="worktime-detail-row"><span>{{ fieldLabel(field, index) }}</span><strong>{{ fieldValue(field) }}</strong></div></section>
      <section v-if="extraTaskFields(row).length" class="worktime-detail-section"><h3>其他来源字段</h3><div v-for="[key, value] in extraTaskFields(row)" :key="key" class="worktime-detail-row"><span>{{ key }}</span><strong>{{ detailValue(value) }}</strong></div></section>
    </template>
    </UiTableView>
  </div>
</template>

<style scoped>
.worktime-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.worktime-detail-group { border-top: 1px solid #30343b; }
.worktime-detail-group > div { display: grid; grid-template-columns: minmax(100px, 28%) minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid #30343b; font-size: 14px; line-height: 1.55; }
.worktime-detail-group span { color: #818b99; }
.worktime-detail-group strong { color: #d2d8e1; font-weight: 500; overflow-wrap: anywhere; }
.worktime-detail-section { margin-top: 20px; }
.worktime-detail-section h3 { margin: 0 0 8px; color: #969fac; font-size: 11px; font-weight: 600; }
.worktime-detail-section p { margin: 0; color: #d2d8e1; font-size: 14px; line-height: 1.7; white-space: pre-wrap; }
.worktime-detail-row { display: grid; grid-template-columns: minmax(100px, 28%) minmax(0, 1fr); gap: 12px; padding: 8px 0; border-bottom: 1px solid #30343b; font-size: 13px; line-height: 1.55; }
.worktime-detail-row > span { color: #818b99; }
.worktime-detail-row > strong { color: #d2d8e1; font-weight: 500; overflow-wrap: anywhere; }
.worktime-page { display: grid; gap: 12px; min-width: 0; }
.worktime-overview { display: grid; gap: 10px; min-width: 0; padding: 14px 16px; border: 1px solid #30343b; border-radius: 9px; background: #1b1d21; }
.worktime-overview-topline { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-width: 0; }
.worktime-overview-metrics { display: flex; align-items: flex-start; gap: clamp(18px, 3vw, 42px); min-width: 0; overflow-x: auto; }
.worktime-overview-metric { display: grid; gap: 5px; min-width: 112px; }
.worktime-overview-metric > span { color: #818b99; font-size: 11px; white-space: nowrap; }
.worktime-overview-metric > strong { color: #d2d8e1; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.worktime-quarter-metric > span { color: #aeb8c4; }
.worktime-overview-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #818b99; font-size: 10px; }
.worktime-progress-track { position: relative; height: 10px; overflow: hidden; border-radius: 6px; background: #2c3035; }
.worktime-progress-track > span { position: absolute; inset: 0 auto 0 0; display: block; height: 100%; border-radius: inherit; transition: width .25s ease; }
.worktime-progress-track > .worktime-progress-elapsed { z-index: 1; background: #626b76; }
.worktime-progress-track > .worktime-progress-workday { z-index: 2; background: #278bd0; }
.worktime-progress-track > .worktime-progress-workday:not(.worktime-progress-review) { z-index: 3; }
.worktime-progress-track > .worktime-progress-actual { background: #22a55b; }
.worktime-progress-track > .worktime-progress-actual.worktime-progress-review { z-index: 4; opacity: .5; }
.worktime-progress-track > .worktime-progress-actual:not(.worktime-progress-review) { z-index: 5; }
.worktime-progress-track > .worktime-progress-workday.worktime-progress-review { opacity: .5; }
.worktime-progress-track > .worktime-progress-target { z-index: 6; top: -3px; bottom: -3px; left: 0; width: 2px; height: auto; border-radius: 0; background: #e2bb67; transform: translateX(-1px); }
.worktime-progress-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; color: #9aa4b0; font-size: 10px; }
.worktime-progress-controls label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.worktime-progress-controls input { width: 12px; height: 12px; margin: 0; accent-color: #8393a5; }
.worktime-progress-controls i { width: 8px; height: 8px; border-radius: 2px; }
.worktime-progress-controls i.actual { background: #22a55b; }
.worktime-progress-controls i.workday { background: #278bd0; }
.worktime-progress-controls i.review { opacity: .5; }
.worktime-progress-controls > span { color: #788392; }
.worktime-progress-controls > .worktime-progress-target-label { color: #d4b66e; }
.worktime-progress-controls > .worktime-progress-missing { color: #d4b66e; }
.worktime-progress-caption { display: flex; justify-content: space-between; gap: 12px; color: #818b99; font-size: 10px; }
.worktime-progress-caption > :last-child { flex: 0 0 auto; }
.worktime-overview-settings { display: flex; align-items: end; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.worktime-overview-settings > label { display: grid; gap: 4px; color: #818b99; font-size: 10px; }
.worktime-overview-settings input { box-sizing: border-box; width: 74px; height: 28px; padding: 0 7px; border: 1px solid #363b43; border-radius: 5px; outline: none; background: #202328; color: #d2d8e1; font: inherit; font-size: 12px; }
.worktime-overview-settings input:focus { border-color: var(--accent); }
.worktime-report-actions { display: flex; gap: 6px; }
.worktime-report-actions button { min-height: 28px; padding: 0 9px; border: 1px solid #363b43; border-radius: 5px; background: #202328; color: #bac3ce; font-size: 11px; cursor: pointer; }
.worktime-report-actions button:hover { border-color: #586575; color: #e1e6ed; }
.worktime-report-notice { color: #aeb8c4; font-size: 10px; }
@media (max-width: 900px) { .worktime-overview-topline { align-items: flex-start; flex-direction: column; } .worktime-overview-settings { justify-content: flex-start; } }
@media (max-width: 640px) { .worktime-overview-metrics { gap: 20px; } .worktime-overview-metric { min-width: 100px; } }
</style>
