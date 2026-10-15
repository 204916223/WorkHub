import { body, json } from '../respond.js'
import { TaskDatabase } from '../../storage/task-database.js'
import { EntityDatabase } from '../../storage/entity-database.js'
import { extractEntityMappings, fetchOwnTasks } from '../../../connectors/teambition/tasks.js'

function dateRange(period, from, to) {
  const valid = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  if (period === 'custom') return { startDate: valid(from) ? from : '', endDate: valid(to) ? to : '' }
  const now = new Date()
  let start, end
  if (period === 'today') start = end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  else if (period === 'week') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  } else if (period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  } else if (period === 'quarter') {
    const month = Math.floor(now.getMonth() / 3) * 3
    start = new Date(now.getFullYear(), month, 1)
    end = new Date(now.getFullYear(), month + 3, 0)
  } else return { startDate: '', endDate: '' }
  const isoDate = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

const syncRuns = new Map()
function taskTagIds(task) {
  const value = task?.tagIds ?? task?.tags
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return [...new Set(values.map((item) => typeof item === 'object' ? String(item.id || item.tagId || item._id || '').trim() : String(item).trim()).filter(Boolean))]
}
const filterFields = new Set(['title', 'projectName', 'executorName', 'tfsName', 'state', 'dueDate', 'updated'])
const sortFields = new Set(filterFields)

// 名称映射的查询请求：成员/项目/标签/状态/任务类型/任务分组/任务列表，一次收集全部 ID
function nameLookupRequest(tasks) {
  return {
    members: tasks.flatMap((task) => [task.executorId, task.creatorId, ...(task.involveMembers || [])]),
    projects: tasks.map((task) => task.projectId),
    tags: tasks.flatMap(taskTagIds),
    tfs: tasks.map((task) => task.tfsId).filter(Boolean),
    sfc: tasks.map((task) => task.sfcId).filter(Boolean),
    tasklists: tasks.map((task) => task.tasklistId).filter(Boolean),
    stages: tasks.map((task) => task.stageId).filter(Boolean),
  }
}

function enrichTaskNames(tasks, mappings) {
  return tasks.map((task) => ({
    ...task,
    projectName: mappings.projects?.[task.projectId] || task.projectName || task.projectId || '',
    executorName: mappings.members?.[task.executorId] || task.executorName || task.executorId || '',
    creatorName: mappings.members?.[task.creatorId] || task.creatorName || task.creatorId || '',
    involveMemberNames: (task.involveMembers || []).map((id) => mappings.members?.[id] || id),
    tfsName: task.tfsName || mappings.tfs?.[task.tfsId] || '',
    sfcName: task.sfcName || mappings.sfc?.[task.sfcId] || '',
    tasklistName: task.tasklistName || mappings.tasklists?.[task.tasklistId] || '',
    stageName: task.stageName || mappings.stages?.[task.stageId] || '',
    tagNames: [...new Set([...(Array.isArray(task.tagNames) ? task.tagNames : []), ...taskTagIds(task).map((id) => mappings.tags?.[id]).filter(Boolean)])],
  }))
}

function parseJsonList(value, limit) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, limit) : []
  } catch { return [] }
}

function parseFilters(value) {
  const validOperators = new Set(['contains', 'equals', 'not_equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'])
  function parseNode(item, depth = 0) {
    if (item?.type === 'group') {
      if (depth >= 3 || !Array.isArray(item.rules)) return null
      const rules = item.rules.slice(0, 8).map((child) => parseNode(child, depth + 1)).filter(Boolean)
      return rules.length ? { type: 'group', conjunction: item.conjunction === 'or' ? 'or' : 'and', rules } : null
    }
    if (!filterFields.has(item?.field) || !validOperators.has(item.operator)) return null
    return { field: item.field, operator: item.operator, value: String(item.value || '').trim().slice(0, 150), conjunction: item.conjunction === 'or' ? 'or' : 'and' }
  }
  return parseJsonList(value, 8).map((item) => parseNode(item)).filter(Boolean)
}

function parseSorts(value) {
  return parseJsonList(value, 4).flatMap((item) => sortFields.has(item?.field)
    ? [{ field: item.field, direction: item.direction === 'desc' ? 'desc' : 'asc' }]
    : [])
}

export async function taskRoutes({ url, request, response, runtime, session }) {
  if (!['/api/tasks', '/api/tasks/sync'].includes(url.pathname)) return false
  const database = new TaskDatabase(runtime.store, runtime.id)
  const orgId = runtime.owner.orgId || runtime.owner.id
  const entityDatabase = new EntityDatabase(runtime.store, orgId)
  if (url.pathname === '/api/tasks' && request.method === 'GET') {
    const page = Math.max(1, Math.min(100_000, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get('pageSize')) || 50))
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 120)
    const state = ['unfinished', 'completed', 'archived'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : ''
    const range = dateRange(url.searchParams.get('period') || 'all', url.searchParams.get('from') || '', url.searchParams.get('to') || '')
    const filters = parseFilters(url.searchParams.get('filters'))
    const sorts = parseSorts(url.searchParams.get('sorts'))
    const groupBy = filterFields.has(url.searchParams.get('groupBy')) ? url.searchParams.get('groupBy') : ''
    const [result, syncState] = await Promise.all([
      database.list({ orgId, query, state, ...range, filters, sorts, groupBy, page, pageSize }),
      database.state(),
    ])
    await entityDatabase.save(extractEntityMappings(result.tasks, runtime.owner))
    const mappings = await entityDatabase.lookup(nameLookupRequest(result.tasks))
    result.tasks = enrichTaskNames(result.tasks, mappings)
    json(response, 200, { ...result, page, pageSize, syncState })
    return true
  }
  if (url.pathname === '/api/tasks/sync' && request.method === 'POST') {
    await body(request)
    if (!session?.mcpConfig) { json(response, 409, { error: '当前登录会话没有可用的 Teambition MCP 凭证，请重新登录。' }); return true }
    const syncKey = runtime.id
    if (syncRuns.has(syncKey)) {
      try { json(response, 200, await syncRuns.get(syncKey)) }
      catch (error) { json(response, 502, { error: error.message }) }
      return true
    }
    const pending = (async () => {
      const result = await fetchOwnTasks({ config: session.mcpConfig, owner: runtime.owner, serverId: session.connector?.serverId })
      await entityDatabase.save([...extractEntityMappings(result.tasks, runtime.owner), ...(result.entities || [])])
      const mappings = await entityDatabase.lookup(nameLookupRequest(result.tasks))
      const tasksWithNames = enrichTaskNames(result.tasks, mappings)
      const saved = await database.saveSync({
        orgId,
        tasks: tasksWithNames,
        fetchedCount: result.fetchedCount,
        reportedTotal: result.reportedTotal,
        pageCount: result.pageCount,
        lastPageSize: result.lastPageSize,
        truncated: result.truncated,
        truncationReason: result.truncationReason,
      })
      return { ...saved, source: result.source }
    })()
    syncRuns.set(syncKey, pending)
    try {
      json(response, 200, await pending)
    } catch (error) {
      const state = await database.failSync(error.message).catch(() => null)
      json(response, 502, { error: error.message, syncState: state })
    } finally { if (syncRuns.get(syncKey) === pending) syncRuns.delete(syncKey) }
    return true
  }
  return false
}
