import { json } from '../respond.js'
import { TaskDatabase } from '../../storage/task-database.js'
import { EntityDatabase } from '../../storage/entity-database.js'

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
const fieldNameAliases = {
  actual: ['实际有效工时', '实际有效工时天', '实际有效工时（天）', '实际有效工作日', '实际有效工作日（天）', 'actualEffectiveWorkdays', 'actualEffectiveDays'],
  duration: ['工作日耗时天', '工作日耗时（天）', '工作日耗时', 'workdayDuration'],
  included: ['是否计入工时统计', '计入工时统计', '是否计入工时', '计入工时', 'inWorkTimeStatistics'],
}
const aliases = Object.fromEntries(Object.entries(fieldNameAliases).map(([key, names]) => [key, new Set(names.map(normalize))]))

function parseValue(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try { return JSON.parse(text) } catch {}
  }
  if (/<[^>]+>/.test(value)) return value.replace(/<\s*br\s*\/?\s*>/gi, ' ').replace(/<\/p\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim()
  return value
}

function fieldNames(field) { return [field?.fieldName, field?.name, field?.label, field?.field?.name, field?.field?.label, field?.title, field?.key, field?.alias].filter(Boolean) }
function rawFieldValue(field) {
  for (const key of ['value', 'values', 'fieldValue', 'content', 'text', 'metaString']) {
    if (field?.[key] != null && field[key] !== '') return parseValue(field[key])
  }
  return null
}
function fieldValues(customfields) {
  const result = { actual: null, duration: null, included: null }
  if (!Array.isArray(customfields)) return result
  for (const field of customfields) {
    const names = fieldNames(field).map(normalize)
    const key = Object.entries(aliases).find(([, values]) => names.some((name) => values.has(name)))?.[0]
    if (!key || result[key] != null) continue
    result[key] = rawFieldValue(field)
  }
  return result
}
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsedValue = parseValue(value)
    if (parsedValue !== value) return numberValue(parsedValue)
    const cleaned = value.replace(/<[^>]*>/g, '').trim().replace(/,/g, '')
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (Array.isArray(value) && value.length === 1) return numberValue(value[0])
  if (value && typeof value === 'object') return numberValue(value.value ?? value.label ?? value.name ?? value.title ?? value.text ?? value.content ?? value.metaString)
  return null
}
function includedValue(value) {
  if (value == null || value === '') return true
  if (typeof value === 'boolean') return value
  const normalized = normalize(Array.isArray(value) ? value.join(' ') : value?.value ?? value?.label ?? value?.title ?? value?.text ?? value)
  if (['否', '不计入', 'false', 'no', '0'].includes(normalized)) return false
  if (['是', '计入', 'true', 'yes', '1'].includes(normalized)) return true
  return true
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) }
function stringList(value) { return Array.isArray(value) ? value.map(String) : value == null || value === '' ? [] : [String(value)] }
function taskTagIds(task) {
  const value = Array.isArray(task?.tagIds) && task.tagIds.length ? task.tagIds : task?.tags
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return [...new Set(values.map((item) => typeof item === 'object' ? String(item.id || item.tagId || item._id || '').trim() : String(item).trim()).filter(Boolean))]
}

export async function worktimeRoutes({ url, request, response, runtime }) {
  if (url.pathname !== '/api/worktime' || request.method !== 'GET') return false
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const hasDateRange = Boolean(from || to)
  if (hasDateRange && (!validDate(from) || !validDate(to) || from > to)) {
    json(response, 400, { error: '请选择有效的统计起止日期。' })
    return true
  }
  const database = new TaskDatabase(runtime.store, runtime.id)
  const allTasks = await database.worktimeRows({ orgId: runtime.owner.orgId || runtime.owner.id })
  const entityDatabase = new EntityDatabase(runtime.store, runtime.owner.orgId || runtime.owner.id)
  const tagMappings = await entityDatabase.lookup({ tags: allTasks.flatMap(taskTagIds) })
  const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase().slice(0, 120)
  const project = String(url.searchParams.get('project') || '').trim().slice(0, 200)
  const projectOptions = [...new Set(allTasks.map((task) => String(task.projectName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const tasks = allTasks.flatMap((task) => {
    const dueDate = String(task.dueDate || '').slice(0, 10)
    if (hasDateRange && (!validDate(dueDate) || dueDate < from || dueDate > to)) return []
    if (task.isArchived || task.state === 'archived') return []
    if (project && task.projectName !== project) return []
    if (query && !`${task.title || ''} ${task.projectName || ''} ${task.executorName || ''}`.toLocaleLowerCase().includes(query)) return []
    const fields = fieldValues(task.customfields)
    const included = includedValue(fields.included)
    return [{
      ...task,
      id: task.id,
      title: task.title || '未命名任务',
      projectId: task.projectId || '',
      projectName: task.projectName || '',
      executorId: task.executorId || '',
      executorName: task.executorName || '',
      creatorId: task.creatorId || '',
      creatorName: task.creatorName || '',
      parentTaskId: task.parentTaskId || '',
      parentTitle: task.parentTitle || '',
      involveMemberNames: task.involveMemberNames || task.involveMembers || [],
      tagNames: [...new Set([...stringList(task.tagNames), ...taskTagIds(task).map((id) => tagMappings.tags?.[id]).filter(Boolean)])],
      priority: task.priority ?? null,
      state: task.state || 'unfinished',
      tfsName: task.tfsName || '',
      startDate: task.startDate || '',
      dueDate: validDate(dueDate) ? dueDate : '',
      accomplishTime: task.accomplishTime || '',
      created: task.created || '',
      updated: task.updated || '',
      note: task.note || task.description || '',
      customfields: task.customfields || [],
      included,
      actualEffectiveWorkdays: numberValue(fields.actual),
      workdayDuration: numberValue(fields.duration),
    }]
  })
  const includedTasks = tasks.filter((task) => task.included)
  json(response, 200, {
    tasks,
    projectOptions,
    summary: {
      taskCount: tasks.length,
      includedCount: includedTasks.length,
      excludedCount: tasks.length - includedTasks.length,
      actualEffectiveWorkdays: includedTasks.reduce((sum, task) => sum + (task.actualEffectiveWorkdays || 0), 0),
      workdayDuration: includedTasks.reduce((sum, task) => sum + (task.workdayDuration || 0), 0),
      missingActualCount: includedTasks.filter((task) => task.actualEffectiveWorkdays == null).length,
    },
    range: { from, to },
  })
  return true
}
