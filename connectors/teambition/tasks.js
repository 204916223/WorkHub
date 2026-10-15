import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { applyWorktimeFields } from './worktime-fields.js'

const TRUSTED_ORIGIN = 'https://open.teambition.com'
const TASK_PAGE_LIMIT = 30
const STATUS_ACTIVITY_LOOKUP_LIMIT = Number(process.env.WORKHUB_STATUS_ACTIVITY_LOOKUP_LIMIT) || 80
const STATUS_ACTIVITY_PAGE_LIMIT = 6
const normalizeKey = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '')
const property = (schema, name, fallback = name) => Object.keys(schema?.properties || {}).find((key) => normalizeKey(key) === normalizeKey(name)) || fallback
function asDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}
function asBoolean(value) { return value === true || value === 1 || /^(true|yes|1)$/i.test(String(value || '')) }

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch {
    const start = value.indexOf('{'), end = value.lastIndexOf('}')
    if (start >= 0 && end > start) { try { return JSON.parse(value.slice(start, end + 1)) } catch {} }
    return null
  }
}

function resultPayload(result) {
  if (result?.isError) throw new Error('Teambition MCP 任务查询失败，请检查登录凭证和任务查询权限。')
  if (result?.structuredContent) return result.structuredContent
  const text = (result?.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n')
  return parseJson(text) || null
}

function findPage(value, seen = new Set(), depth = 0) {
  if (depth > 9 || value == null || seen.has(value)) return null
  if (typeof value === 'string') return findPage(parseJson(value), seen, depth + 1)
  if (typeof value !== 'object') return null
  seen.add(value)
  if (Array.isArray(value)) return { result: value }
  for (const key of ['result', 'tasks', 'items', 'list']) {
    if (Array.isArray(value[key])) return { ...value, result: value[key] }
  }
  for (const nested of Object.values(value)) {
    const found = findPage(nested, seen, depth + 1)
    if (found) return found
  }
  return null
}

function taskPage(raw) {
  const page = findPage(raw)
  if (!page) throw new Error('任务查询工具返回的数据格式无法识别。')
  const error = page.errorMessage || page.error?.message
  if (error) throw new Error(`Teambition 任务查询失败：${String(error).slice(0, 180)}`)
  const next = page.nextPageToken ?? page.nextCursor ?? page.nextToken ?? page.continuationToken ?? ''
  const hasMore = asBoolean(page.hasMore ?? page.hasNext ?? page.hasNextPage)
  return {
    rows: page.result,
    next: String(next).trim(),
    hasMore,
    total: Number.isFinite(Number(page.totalSize ?? page.totalCount ?? page.total ?? page.count)) ? Number(page.totalSize ?? page.totalCount ?? page.total ?? page.count) : null,
  }
}

function tagId(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.id || value.tagId || value._id || '').trim()
}

function tagName(value) {
  if (!value || typeof value !== 'object') return ''
  return String(value.name || value.title || value.label || '').trim()
}

function structureId(value) {
  return (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : ''
}

function plainName(value) {
  return typeof value === 'string' ? String(value).trim() : ''
}

function taskTagIds(task) {
  const value = task?.tagIds ?? task?.tags
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return [...new Set(values.map(tagId).filter(Boolean))]
}

const statusActivityCache = new Map()

function statusValues(content) {
  const values = new Set()
  const visit = (value, depth = 0, insideStatus = false) => {
    if (depth > 6 || value == null) return
    if (typeof value === 'string' || typeof value === 'number') {
      if (insideStatus) values.add(String(value).trim())
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, insideStatus)
      return
    }
    if (typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizeKey(key)
      const isStatus = insideStatus || /taskflowstatus|tfsid|status/.test(normalized)
      if (isStatus) visit(item, depth + 1, true)
    }
  }
  visit(content)
  return values
}

async function fetchLastStatusTransition(task, targetStatus, targetStatusId, token, owner, signal) {
  let pageToken = ''
  let latest = ''
  const targetValues = new Set([targetStatus, targetStatusId].map((value) => String(value || '').trim()).filter(Boolean))
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (owner.orgId) { headers['X-Tenant-Type'] = 'organization'; headers['X-Tenant-Id'] = owner.orgId }
  if (owner.id) headers['x-operator-id'] = owner.id
  for (let pageNumber = 0; pageNumber < STATUS_ACTIVITY_PAGE_LIMIT; pageNumber++) {
    const url = new URL(`${TRUSTED_ORIGIN}/api/v3/task/${encodeURIComponent(task.id)}/activity/list`)
    url.searchParams.set('limit', '50')
    url.searchParams.set('language', 'zh_CN')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    if (!response.ok) throw new Error(`task activity query returned ${response.status}`)
    const payload = await response.json()
    const page = findPage(payload)
    for (const activity of page?.result || []) {
      if (!/taskflowstatus/i.test(String(activity?.action || ''))) continue
      let content = {}
      try { content = JSON.parse(String(activity.content || '{}')) } catch { continue }
      const at = String(activity.createTime || '')
      if (![...statusValues(content)].some((value) => targetValues.has(value)) || !Number.isFinite(Date.parse(at))) continue
      if (!latest || Date.parse(at) > Date.parse(latest)) latest = at
    }
    const next = String(page?.nextPageToken || page?.nextCursor || '').trim()
    if (!next || next === pageToken) break
    pageToken = next
  }
  return latest
}

async function resolveStatusTransitionTimes(tasks, owner, server, signal, projectNames = new Map()) {
  const token = new URL(server.url).searchParams.get('userToken')
  if (!token) return
  const candidates = tasks.flatMap((task) => {
    const hasDueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(task.dueDate || '').slice(0, 10))
    const hasQuarterOverdueTag = (task.tagNames || []).some((name) => String(name || '').includes('季度逾期'))
    const projectName = task.projectName || projectNames.get(task.projectId) || ''
    if (projectName !== '本体开发部' || (!hasDueDate && !hasQuarterOverdueTag)) return []
    const status = String(task.tfsName || '').trim()
    if (status === '待评审') return [{ task, targetStatus: status }]
    if (status === '已完成' && !task.accomplishTime) return [{ task, targetStatus: status }]
    return []
  })
  const pending = []
  for (const candidate of candidates) {
    const { task } = candidate
    const cached = statusActivityCache.get(task.id)
    if (cached && cached.updated === task.updated && cached.targetStatus === candidate.targetStatus) task.statusChangedAt = cached.at
    else pending.push(candidate)
  }
  let cursor = 0
  const queue = pending.slice(0, STATUS_ACTIVITY_LOOKUP_LIMIT)
  async function worker() {
    while (cursor < queue.length) {
      const { task, targetStatus } = queue[cursor++]
      try {
        const at = await fetchLastStatusTransition(task, targetStatus, task.tfsId, token, owner, signal)
        task.statusChangedAt = at
        statusActivityCache.set(task.id, { updated: task.updated, targetStatus, at })
      } catch (error) {
        console.warn(`[teambition] task activity lookup failed (${error?.message || 'unknown error'})`)
        // Activity history is optional for task sync; a missing history timestamp
        // excludes the task from quarter-transition totals rather than guessing.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker))
}

// 任务结构字段的名称解析配置：每类一个项目级只读查询工具
const STRUCTURE_KINDS = [
  { type: 'tfs', taskField: 'tfsId', nameField: 'tfsName', toolName: 'SearchTaskflowStatusesV3', idParams: ['tfsIds', 'tfsId', 'id', 'ids'], keywords: /工作流状态|状态|tfs/i },
  { type: 'sfc', taskField: 'sfcId', nameField: 'sfcName', toolName: 'teambition.project.sfc-query', idParams: ['id', 'sfcId', 'sfcIds', 'ids'], keywords: /任务类型|场景字段|sfc/i },
  { type: 'tasklist', taskField: 'tasklistId', nameField: 'tasklistName', toolName: 'teambition.project.task-group-query', idParams: ['taskGroupId', 'taskGroupIds', 'id', 'ids'], keywords: /任务分组|task.?group/i },
  { type: 'stage', taskField: 'stageId', nameField: 'stageName', toolName: 'teambition.project.task-list-query', idParams: ['taskListId', 'taskListIds', 'stageId', 'stageIds', 'id', 'ids'], keywords: /任务列表|task.?list|stage/i },
]

function safeSourceData(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.filter((item) => !item || typeof item !== 'object' || !['file', 'attachment'].includes(String(item.type || '').toLowerCase())).slice(0, 500).map((item) => safeSourceData(item, depth + 1))
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizeKey(key)
    if (/attachment|downloadurl|resourceid|^file(id|name|url|type|size)?$|^(files?|comments?)$|commentthreads/.test(normalized)) continue
    result[key] = safeSourceData(item, depth + 1)
  }
  return result
}

export function normalizeTask(task) {
  if (!task || typeof task !== 'object') return null
  const id = String(task.id || task.taskId || task.uniqueId || '').trim()
  if (!id) return null
  const executor = task.executor && typeof task.executor === 'object' ? task.executor : {}
  const creator = task.creator && typeof task.creator === 'object' ? task.creator : {}
  const isDone = asBoolean(task.isDone)
  const isArchived = asBoolean(task.isArchived)
  const dueDate = asDate(task.dueDate)
  const updated = asDate(task.updated)
  const created = asDate(task.created)
  const rawTagSource = task.tagIds ?? task.tags
  const tagSource = Array.isArray(rawTagSource) ? rawTagSource : rawTagSource == null || rawTagSource === '' ? [] : [rawTagSource]
  const tagIds = [...new Set(tagSource.map(tagId).filter(Boolean))]
  const tagNames = [...new Set([
    ...(Array.isArray(task.tagNames) ? task.tagNames : []),
    ...(Array.isArray(task.tags) ? task.tags.map(tagName) : []),
  ].map((name) => String(name || '').trim()).filter(Boolean))]
  const source = safeSourceData(task)
  return {
    // 与 tb-agent 一致先保留全部原始字段（已剔除附件/评论），再用规范化字段覆盖
    ...source,
    id,
    title: String(task.content || task.title || '未命名任务').trim().slice(0, 2000),
    note: String(task.note || task.description || '').slice(0, 50_000),
    projectId: String(task.projectId || entityId(task.project) || ''),
    projectName: String(task.projectName || entityName(task.project)),
    parentTaskId: String(task.parentTaskId || ''),
    parentTitle: String(task.parentTitle || ''),
    creatorId: String(task.creatorId || entityId(creator)),
    creatorName: String(task.creatorName || entityName(creator)),
    executorId: String(task.executorId || entityId(executor)),
    executorName: String(task.executorName || entityName(executor)),
    involveMembers: Array.isArray(task.involveMembers) ? task.involveMembers.map((item) => entityId(item)).filter(Boolean) : [],
    priority: Number.isFinite(Number(task.priority)) ? Number(task.priority) : null,
    isDone,
    isArchived,
    state: isArchived ? 'archived' : isDone ? 'completed' : 'unfinished',
    startDate: asDate(task.startDate),
    dueDate,
    accomplishTime: asDate(task.accomplishTime),
    statusChangedAt: asDate(task.statusChangedAt || task.deliveredAt),
    created,
    updated,
    tagIds,
    tagNames,
    tfsId: structureId(task.tfsId),
    tfsName: plainName(task.tfsName),
    sfcId: structureId(task.sfcId),
    sfcName: plainName(task.sfcName),
    tasklistId: structureId(task.tasklistId),
    tasklistName: plainName(task.tasklistName),
    stageId: structureId(task.stageId),
    stageName: plainName(task.stageName),
    sprintId: structureId(task.sprintId),
    uniqueId: Number.isFinite(Number(task.uniqueId)) ? Number(task.uniqueId) : null,
    storyPoint: task.storyPoint == null ? null : Number.isFinite(Number(task.storyPoint)) ? Number(task.storyPoint) : task.storyPoint,
    visible: String(task.visible || ''),
    customfields: safeSourceData(Array.isArray(task.customfields) ? task.customfields.filter((field) => !['file', 'attachment'].includes(String(field?.type || '').toLowerCase())) : []),
  }
}

function entityName(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.displayName || value.realName || value.fullName || value.projectName || value.creatorName || value.name || value.nickName || value.nickname || value.userName || value.username || '').trim()
}

function entityId(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.id || value.userId || value.user_id || value.memberId || value.creatorId || value._id || value.projectId || '').trim()
}

function entityLookupTool(tool, type) {
  const name = String(tool?.name || '')
  const descriptor = `${name} ${tool?.description || ''}`.toLowerCase()
  const normalizedName = normalizeKey(name)
  const nativeProjectIdQuery = type === 'project' && normalizedName === 'queryprojectsv3'
  const nativeProjectSearch = type === 'project' && normalizedName === 'searchprojectstql'
  const nativeMemberSearch = type === 'member' && normalizedName === 'postv3memberquery'
  const category = type === 'project' ? /project|项目/.test(descriptor) : /user|member|profile|参与者|成员|用户/.test(descriptor)
  const namespacedQuery = new RegExp(`^teambition\\.${type}\\.query$`, 'i').test(name)
  if (!category || (!namespacedQuery && !nativeProjectIdQuery && !nativeProjectSearch && !nativeMemberSearch && !/^(get|find|search|query|list|read|lookup|fetch)/i.test(name)) || /create|update|delete|remove|add|invite|批量更新|创建|删除|修改/i.test(name)) return null
  const properties = tool.inputSchema?.properties || {}
  const entries = Object.entries(properties)
  const normalized = (key) => normalizeKey(key)
  const batchNames = type === 'project' ? new Set(['projectids', 'ids']) : new Set(['userids', 'memberids', 'accountids', 'ids'])
  const singularNames = type === 'project' ? new Set(['projectid', 'id', '_id']) : new Set(['userid', 'memberid', 'creatorid', 'accountid', 'uid', 'id', '_id'])
  const batch = entries.find(([key, schema]) => batchNames.has(normalized(key))
    && (schema?.type === 'array' || schema?.type === 'string'))
  const single = entries.find(([key]) => singularNames.has(normalized(key)))
  if (!batch && !single && !nativeProjectIdQuery && !nativeProjectSearch) return null
  const readOnly = tool.annotations?.readOnlyHint === true
  return {
    tool,
    batch,
    single,
    mode: nativeProjectSearch ? 'project-tql' : 'ids',
    score: (namespacedQuery ? 1200 : nativeProjectIdQuery ? 1150 : nativeProjectSearch || nativeMemberSearch ? 1100 : batch ? 100 : 50) + (readOnly ? 20 : 0),
  }
}

function entityLookupArguments(candidate, type, ids, owner) {
  const schema = candidate.tool.inputSchema || {}
  const properties = schema.properties || {}
  const args = {}
  if (candidate.mode === 'project-tql') {
    const tqlKey = Object.keys(properties).find((key) => normalizeKey(key) === 'tql')
    if (!tqlKey) return null
    // Teambition's project search TQL uses `id`; `_id` is rejected by the service.
    args[tqlKey] = `id = ${JSON.stringify(ids[0])}`
  } else if (candidate.batch) args[candidate.batch[0]] = candidate.batch[1]?.type === 'array' ? ids : ids.join(',')
  else if (candidate.single) args[candidate.single[0]] = ids[0]
  else return null
  for (const [key, propertySchema] of Object.entries(properties)) {
    const normalized = normalizeKey(key)
    if (['orgid', 'organizationid', 'tenantid', 'xtenantid', 'companyid'].includes(normalized)) args[key] = owner.orgId
    else if (['xoperatorid', 'operatorid'].includes(normalized) && owner.id) args[key] = owner.id
    else if (candidate.mode === 'project-tql' && normalized === 'includetemplate') args[key] = false
    else if (['pagesize', 'limit'].includes(normalized)) {
      const minimum = Number.isFinite(propertySchema?.minimum) ? propertySchema.minimum : 1
      const maximum = Number.isFinite(propertySchema?.maximum) ? propertySchema.maximum : 100
      const value = Math.max(minimum, Math.min(100, maximum))
      args[key] = propertySchema?.type === 'string' ? String(value) : value
    } else if (candidate.mode === 'project-tql' && ['pagetoken', 'nextpagetoken', 'cursor', 'nextcursor', 'continuationtoken'].includes(normalized)) args[key] = ''
  }
  const required = schema.required || []
  if (required.some((key) => !Object.hasOwn(args, key))) return null
  return args
}

function collectEntityRows(value, type, wanted, output, depth = 0, seen = new Set()) {
  if (depth > 12 || value == null) return
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    if (parsed != null && parsed !== value && (typeof parsed === 'object' || typeof parsed === 'string')) collectEntityRows(parsed, type, wanted, output, depth + 1, seen)
    return
  }
  if (typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectEntityRows(item, type, wanted, output, depth + 1, seen)
    return
  }
  const id = entityId(value), name = entityName(value)
  if (wanted.has(id) && name && id !== name) output.set(id, { type, id, name, source: 'mcp_entity_lookup', quality: 98 })
  for (const child of Object.values(value)) {
    if (typeof child === 'string') {
      const parsed = parseJson(child)
      if (parsed && typeof parsed === 'object') collectEntityRows(parsed, type, wanted, output, depth + 1, seen)
    } else collectEntityRows(child, type, wanted, output, depth + 1, seen)
  }
}

function taskEntityIds(tasks) {
  const members = new Set(), projects = new Set()
  for (const task of tasks) {
    if (task.projectId) projects.add(task.projectId)
    for (const id of [task.executorId, task.creatorId, ...(task.involveMembers || [])]) if (id) members.add(id)
    for (const field of ['involveMembers', 'involvedMembers', 'participants']) {
      for (const member of Array.isArray(task[field]) ? task[field] : []) {
        const id = entityId(member)
        if (id) members.add(id)
      }
    }
  }
  return { members, projects }
}

async function resolveEntityNames(client, tools, tasks, owner, signal) {
  const result = new Map(extractEntityMappings(tasks, owner).map((entity) => [`${entity.type}:${entity.id}`, entity]))
  const ids = taskEntityIds(tasks)
  for (const type of ['member', 'project']) {
    const wanted = type === 'member' ? ids.members : ids.projects
    for (const entity of result.values()) if (entity.type === type) wanted.delete(entity.id)
    if (!wanted.size) continue
    const expectedName = `teambition.${type}.query`
    const expectedTool = tools.find((tool) => String(tool?.name || '').toLowerCase() === expectedName)
    console.info(`[teambition-mcp] 指定工具 ${expectedName}：${expectedTool ? Object.keys(expectedTool.inputSchema?.properties || {}).join(',') || '无参数schema' : '未提供'}`)
    const nativeName = type === 'project' ? 'SearchProjectsTQL' : 'PostV3MemberQuery'
    const nativeTool = tools.find((tool) => normalizeKey(tool?.name || '') === normalizeKey(nativeName))
    console.info(`[teambition-mcp] 原生工具 ${nativeName}：${nativeTool ? `参数=${Object.keys(nativeTool.inputSchema?.properties || {}).join(',') || '无参数schema'}；必填=${(nativeTool.inputSchema?.required || []).join(',') || '无'}` : '未提供'}`)
    if (type === 'project') {
      const projectIdsTool = tools.find((tool) => normalizeKey(tool?.name || '') === 'queryprojectsv3')
      console.info(`[teambition-mcp] TB Agent 项目查询 QueryProjectsV3：${projectIdsTool ? `参数=${Object.keys(projectIdsTool.inputSchema?.properties || {}).join(',') || '无参数schema'}；必填=${(projectIdsTool.inputSchema?.required || []).join(',') || '无'}` : '未提供'}`)
    }
    const candidates = tools.map((tool) => entityLookupTool(tool, type)).filter(Boolean).sort((a, b) => b.score - a.score)
    const candidate = candidates[0]
    if (!candidate) {
      console.info(`[teambition-mcp] ${type} 名称补全跳过：没有可用查询工具`)
      continue
    }
    const unresolved = [...wanted].slice(0, 200)
    const groupSize = candidate.batch ? (type === 'project' ? 50 : 100) : 1
    const groups = Array.from({ length: Math.ceil(unresolved.length / groupSize) }, (_, index) => unresolved.slice(index * groupSize, (index + 1) * groupSize))
    let cursor = 0, callErrors = 0, matchedRows = 0, responseShapeLogged = false
    const workers = Array.from({ length: Math.min(candidate.batch ? 1 : 4, groups.length) }, async () => {
      while (cursor < groups.length) {
        const group = groups[cursor++]
        const args = entityLookupArguments(candidate, type, group, owner)
        if (!args) {
          console.info(`[teambition-mcp] ${type} 名称补全跳过：工具必填参数无法匹配`)
          return
        }
        try {
          const response = await client.callTool({ name: candidate.tool.name, arguments: args }, undefined, { signal })
          if (response?.isError) { callErrors++; continue }
          const payload = resultPayload(response)
          const before = result.size
          collectEntityRows(payload, type, new Set(group), result)
          matchedRows += result.size - before
          if (type === 'project' && candidate.mode === 'project-tql' && !responseShapeLogged) {
            responseShapeLogged = true
            const page = findPage(payload)
            const row = page?.result?.[0]
            const parsedRow = typeof row === 'string' ? parseJson(row) : row
            const topKeys = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload).join(',') : Array.isArray(payload) ? 'array' : typeof payload
            console.info(`[teambition-mcp] project TQL 响应结构：keys=${topKeys || '无'}，rows=${page?.result?.length ?? 0}，rowType=${typeof row}，decodedType=${parsedRow === null ? 'null' : typeof parsedRow}，rowKeys=${parsedRow && typeof parsedRow === 'object' ? Object.keys(parsedRow).join(',') : '无'}，hasIdKey=${typeof row === 'string' && /["'](?:id|projectId|_id)["']\s*:/.test(row)}，hasNameKey=${typeof row === 'string' && /["'](?:name|projectName|displayName|title)["']\s*:/.test(row)}，errorCode=${payload?.errorCode ?? payload?.code ?? payload?.status ?? '无'}，hasErrorMessage=${Boolean(payload?.errorMessage || payload?.error?.message)}`)
          }
        } catch (error) {
          if (signal.aborted) throw error
          callErrors++
        }
      }
    })
    await Promise.all(workers)
    const resolved = [...result.values()].filter((entity) => entity.type === type && wanted.has(entity.id)).length
    console.info(`[teambition-mcp] ${type} 名称补全：工具=${candidate.tool.name}，已识别 ${resolved}/${wanted.size}，匹配记录=${matchedRows}，调用失败=${callErrors}`)
  }
  return [...result.values()]
}

function customFieldDefinitionsTool(tools) {
  const candidates = tools.filter((tool) => {
    const name = normalizeKey(tool?.name || '')
    const descriptor = `${tool?.name || ''} ${tool?.description || ''}`.toLowerCase()
    // Official MCP tool uses the historical typo `CustomFileds` (transposed
    // letters); match that exact operation just like tb-agent does.
    const knownOperation = name === 'searchprojectcustomfiledsv3' || name === 'searchprojectcustomfieldsv3'
    return (knownOperation || /custom.?fields?|custom.?fileds?|自定义字段/.test(descriptor))
      && /^(get|find|search|query|list|read|lookup|fetch)/i.test(String(tool?.name || ''))
      && !/create|update|delete|remove|add|修改|删除|创建/i.test(String(tool?.name || ''))
      && (name.includes('project') || name.includes('customfield'))
  })
  return candidates.sort((a, b) => {
    const score = (tool) => {
      const name = normalizeKey(tool.name)
      return (name.includes('searchprojectcustomfields') || name.includes('searchprojectcustomfileds') ? 100 : 0)
        + (name.includes('getprojecttablecustomfield') ? 90 : 0)
        + (tool.annotations?.readOnlyHint === true ? 10 : 0)
    }
    return score(b) - score(a)
  })[0] || null
}

function customFieldArguments(tool, projectId, owner) {
  const schema = tool.inputSchema || {}, properties = schema.properties || {}, args = {}
  const projectKey = Object.keys(properties).find((key) => ['projectid', 'project_id'].includes(normalizeKey(key)))
  if (!projectKey) return null
  args[projectKey] = projectId
  for (const [key, propertySchema] of Object.entries(properties)) {
    const normalized = normalizeKey(key)
    if (['orgid', 'organizationid', 'tenantid', 'xtenantid', 'companyid'].includes(normalized)) args[key] = owner.orgId
    else if (['xoperatorid', 'operatorid'].includes(normalized)) args[key] = owner.id
    else if (['pagesize', 'limit'].includes(normalized)) {
      const maximum = Number.isFinite(propertySchema?.maximum) ? propertySchema.maximum : 100
      const value = Math.max(1, Math.min(100, maximum))
      args[key] = propertySchema?.type === 'string' ? String(value) : value
    } else if (['pagetoken', 'nextpagetoken', 'cursor', 'nextcursor', 'continuationtoken'].includes(normalized)) args[key] = ''
    else if (normalized === 'includetemplate') args[key] = false
  }
  if ((schema.required || []).some((key) => !Object.hasOwn(args, key))) return null
  return args
}

function collectCustomFieldDefinitions(value, output, seen = new Set(), depth = 0) {
  if (depth > 10 || value == null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectCustomFieldDefinitions(item, output, seen, depth + 1)
    return
  }
  const id = String(value.cfId || value.customFieldId || value.fieldId || value.id || value._id || '').trim()
  const name = String(value.name || value.title || value.label || value.displayName || value.fieldName || value.customfieldName || '').trim()
  if (id && name) output.set(id, name)
  for (const [key, child] of Object.entries(value)) {
    const parsed = typeof child === 'string' ? parseJson(child) : child
    if (parsed && typeof parsed === 'object') collectCustomFieldDefinitions(parsed, output, seen, depth + 1)
  }
}

async function resolveCustomFieldNames(client, tools, tasks, owner, signal) {
  const candidate = customFieldDefinitionsTool(tools)
  if (!candidate) {
    console.info('[teambition-mcp] 自定义字段名称补全跳过：没有可用的字段定义查询工具')
    return
  }
  const projectIds = [...new Set(tasks.map((task) => task.projectId).filter(Boolean))].slice(0, 100)
  console.info(`[teambition-mcp] 自定义字段定义工具：${candidate.name}，参数=${Object.keys(candidate.inputSchema?.properties || {}).join(',') || '无参数schema'}`)
  const definitionsByProject = new Map()
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, projectIds.length) }, async () => {
    while (cursor < projectIds.length) {
      const projectId = projectIds[cursor++]
      const args = customFieldArguments(candidate, projectId, owner)
      if (!args) continue
      try {
        const response = await client.callTool({ name: candidate.name, arguments: args }, undefined, { signal })
        if (response?.isError) continue
        const definitions = new Map()
        collectCustomFieldDefinitions(resultPayload(response), definitions)
        if (definitions.size) definitionsByProject.set(projectId, definitions)
      } catch (error) {
        if (signal.aborted) throw error
      }
    }
  })
  await Promise.all(workers)
  let mapped = 0
  for (const task of tasks) {
    const definitions = definitionsByProject.get(task.projectId)
    if (!definitions || !Array.isArray(task.customfields)) continue
    const enrich = (fields) => fields.map((field) => {
      const id = String(field?.cfId || field?.customFieldId || field?.fieldId || field?.id || '').trim()
      const name = definitions.get(id)
      if (!name) return field
      mapped++
      return { ...field, name, label: name }
    })
    task.customfields = enrich(task.customfields)
  }
  console.info(`[teambition-mcp] 自定义字段名称补全：工具=${candidate.name}，项目=${definitionsByProject.size}/${projectIds.length}，字段值映射=${mapped}`)
}

function tagToolArguments(tool, projectId, ids, owner, pageToken = '') {
  const schema = tool.inputSchema || {}, properties = schema.properties || {}, args = {}
  const key = (name) => Object.keys(properties).find((propertyName) => normalizeKey(propertyName) === normalizeKey(name))
  const projectKey = key('projectId'), tagIdsKey = key('tagIds')
  if (!projectKey || !tagIdsKey) return null
  args[projectKey] = projectId
  args[tagIdsKey] = properties[tagIdsKey]?.type === 'array' ? ids : ids.join(',')
  for (const [name, value] of [['XTenantId', owner.orgId], ['XOperatorId', owner.id]]) {
    const propertyName = key(name)
    if (propertyName && value) args[propertyName] = value
  }
  const sizeKey = key('pageSize')
  if (sizeKey) {
    const maximum = Number.isFinite(properties[sizeKey]?.maximum) ? properties[sizeKey].maximum : 100
    const size = Math.max(Number.isFinite(properties[sizeKey]?.minimum) ? properties[sizeKey].minimum : 1, Math.min(100, maximum))
    args[sizeKey] = properties[sizeKey]?.type === 'string' ? String(size) : size
  }
  const cursorKey = key('pageToken')
  if (cursorKey && pageToken) args[cursorKey] = pageToken
  return (schema.required || []).some((required) => !Object.hasOwn(args, required)) ? null : args
}

function tagRows(value) {
  const page = findPage(value)
  if (!page) return []
  return page.result.map((row) => typeof row === 'string' ? parseJson(row) : row).filter((row) => row && typeof row === 'object' && tagId(row) && tagName(row))
}

async function queryProjectTags(client, tool, projectId, ids, owner, server, signal) {
  if (tool) {
    const found = [], known = new Set()
    let pageToken = ''
    for (let page = 0; page < 30; page++) {
      const args = tagToolArguments(tool, projectId, ids, owner, pageToken)
      if (!args) break
      const response = await client.callTool({ name: tool.name, arguments: args }, undefined, { signal })
      if (response?.isError) break
      const payload = resultPayload(response)
      const rows = tagRows(payload)
      found.push(...rows)
      for (const row of rows) known.add(tagId(row))
      if (ids.every((id) => known.has(id))) return found
      const pageData = findPage(payload)
      const next = String(pageData?.nextPageToken || pageData?.nextCursor || '').trim()
      if (!next || next === pageToken) return found
      pageToken = next
    }
    if (found.length) return found
  }

  // Some official MCP tool sets omit tag lookup; use the same read-only V3 endpoint as tb-agent.
  const token = new URL(server.url).searchParams.get('userToken')
  if (!token) return []
  const found = [], known = new Set()
  let pageToken = ''
  for (let page = 0; page < 30; page++) {
    const url = new URL(`${TRUSTED_ORIGIN}/api/v3/project/${encodeURIComponent(projectId)}/tag/search`)
    url.searchParams.set('tagIds', ids.join(','))
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    if (owner.orgId) { headers['X-Tenant-Type'] = 'organization'; headers['X-Tenant-Id'] = owner.orgId }
    if (owner.id) headers['x-operator-id'] = owner.id
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    if (!response.ok) return found
    let payload
    try { payload = await response.json() } catch { return found }
    const rows = tagRows(payload)
    found.push(...rows)
    for (const row of rows) known.add(tagId(row))
    if (ids.every((id) => known.has(id))) return found
    const pageData = findPage(payload)
    const next = String(pageData?.nextPageToken || '').trim()
    if (!next || next === pageToken) return found
    pageToken = next
  }
  return found
}

async function resolveTagNames(client, tools, tasks, owner, server, signal) {
  const byProject = new Map()
  for (const task of tasks) {
    if (!task.projectId || !task.tagIds?.length) continue
    if (!byProject.has(task.projectId)) byProject.set(task.projectId, new Set())
    task.tagIds.forEach((id) => byProject.get(task.projectId).add(id))
  }
  if (!byProject.size) return []
  const tool = tools.find((candidate) => normalizeKey(candidate?.name || '') === 'searchprojecttagsv3')
  const namesByProject = new Map()
  let failedProjects = 0
  await Promise.all([...byProject].map(async ([projectId, tagIds]) => {
    try {
      const rows = await queryProjectTags(client, tool, projectId, [...tagIds], owner, server, signal)
      const names = new Map(rows.map((row) => [tagId(row), tagName(row)]))
      if (names.size) namesByProject.set(projectId, names)
    } catch (error) {
      if (signal.aborted) throw error
      failedProjects++
    }
  }))
  let mapped = 0
  for (const task of tasks) {
    if (!task.tagIds?.length) continue
    const names = namesByProject.get(task.projectId)
    if (!names) continue
    task.tagNames = [...new Set([...(task.tagNames || []), ...task.tagIds.map((id) => names.get(id)).filter(Boolean)])]
    mapped += task.tagNames.length
  }
  console.info(`[teambition-mcp] 标签名称补全：工具=${tool?.name || '官方 V3 标签接口'}，项目=${namesByProject.size}/${byProject.size}，已映射任务=${mapped}，查询失败项目=${failedProjects}`)
  const entities = []
  for (const names of namesByProject.values()) {
    for (const [id, name] of names) entities.push({ type: 'tag', id, name, source: tool ? `mcp:${tool.name}` : 'official_v3_tag_api', quality: 90 })
  }
  return entities
}

function structureLookupTool(tools, kind) {
  const exact = normalizeKey(kind.toolName)
  const found = tools.find((tool) => normalizeKey(tool?.name || '') === exact)
  if (found) return found
  // 兜底：项目级只读查询工具，schema 同时具备 projectId 与本类 ID 参数，名称/描述命中关键词
  return tools.find((tool) => {
    const name = String(tool?.name || '')
    const descriptor = `${name} ${tool?.description || ''}`
    const properties = tool?.inputSchema?.properties || {}
    const keys = Object.keys(properties).map(normalizeKey)
    if (!keys.includes('projectid')) return false
    if (!(tool.inputSchema?.required || []).some((required) => normalizeKey(required) === 'projectid')) return false
    if (!keys.some((key) => kind.idParams.map(normalizeKey).includes(key))) return false
    if (/create|update|delete|remove|add|batch|批量|创建|修改|删除/i.test(name)) return false
    if (!/^(get|find|search|query|list|read|lookup|fetch|teambition\.)/i.test(name)) return false
    return kind.keywords.test(descriptor)
  }) || null
}

function structureArguments(tool, kind, projectId, ids, owner, pageToken = '') {
  const schema = tool.inputSchema || {}, properties = schema.properties || {}, args = {}
  const key = (name) => Object.keys(properties).find((propertyName) => normalizeKey(propertyName) === normalizeKey(name))
  const projectKey = key('projectId')
  if (!projectKey) return null
  args[projectKey] = projectId
  const idKey = kind.idParams.map((name) => key(name)).find(Boolean)
  if (!idKey) return null
  args[idKey] = properties[idKey]?.type === 'array' ? ids : ids.join(',')
  for (const [name, value] of [['XTenantId', owner.orgId], ['XOperatorId', owner.id]]) {
    const propertyName = key(name)
    if (propertyName && value) args[propertyName] = value
  }
  const sizeKey = key('pageSize')
  if (sizeKey) {
    const maximum = Number.isFinite(properties[sizeKey]?.maximum) ? properties[sizeKey].maximum : 100
    const size = Math.max(Number.isFinite(properties[sizeKey]?.minimum) ? properties[sizeKey].minimum : 1, Math.min(100, maximum))
    args[sizeKey] = properties[sizeKey]?.type === 'string' ? String(size) : size
  }
  const cursorKey = key('pageToken')
  if (cursorKey && pageToken) args[cursorKey] = pageToken
  return (schema.required || []).some((required) => !Object.hasOwn(args, required)) ? null : args
}

export async function resolveStructureNames(client, tools, tasks, owner, signal) {
  const entities = []
  for (const kind of STRUCTURE_KINDS) {
    const known = new Map()
    const byProject = new Map()
    for (const task of tasks) {
      const id = task?.[kind.taskField]
      if (!id || !task.projectId) continue
      const name = task[kind.nameField]
      if (name) { if (!known.has(id)) known.set(id, { name, source: 'task.structure.name', quality: 85 }); continue }
      if (!byProject.has(task.projectId)) byProject.set(task.projectId, new Set())
      byProject.get(task.projectId).add(id)
    }
    if (!byProject.size) {
      for (const [id, entry] of known) entities.push({ type: kind.type, id, name: entry.name, source: entry.source, quality: entry.quality })
      continue
    }
    const tool = structureLookupTool(tools, kind)
    if (!tool) {
      console.info(`[teambition-mcp] ${kind.type} 名称补全跳过：没有可用的项目级查询工具`)
      continue
    }
    let failures = 0
    await Promise.all([...byProject].map(async ([projectId, ids]) => {
      try {
        let pageToken = ''
        for (let page = 0; page < 20; page++) {
          const args = structureArguments(tool, kind, projectId, [...ids], owner, pageToken)
          if (!args) return
          const response = await client.callTool({ name: tool.name, arguments: args }, undefined, { signal })
          if (response?.isError) { failures++; return }
          const pageData = findPage(resultPayload(response))
          for (const row of pageData?.result || []) {
            const parsed = typeof row === 'string' ? parseJson(row) : row
            const rowId = entityId(parsed), rowName = tagName(parsed)
            if (rowId && rowName && ids.has(rowId) && !known.has(rowId)) known.set(rowId, { name: rowName, source: `mcp_structure_lookup:${kind.type}`, quality: 95 })
          }
          const next = String(pageData?.nextPageToken ?? pageData?.nextCursor ?? '').trim()
          if (!next || next === pageToken) return
          pageToken = next
        }
      } catch (error) {
        if (signal.aborted) throw error
        failures++
      }
    }))
    let mapped = 0
    for (const task of tasks) {
      const id = task?.[kind.taskField]
      const entry = id && known.get(id)
      if (entry && !task[kind.nameField]) { task[kind.nameField] = entry.name; mapped++ }
    }
    for (const [id, entry] of known) entities.push({ type: kind.type, id, name: entry.name, source: entry.source, quality: entry.quality })
    const wanted = [...byProject.values()].reduce((count, ids) => count + ids.size, 0)
    console.info(`[teambition-mcp] ${kind.type} 名称补全：工具=${tool.name}，已解析 ${known.size}/${wanted} 个 ID，映射任务=${mapped}，失败=${failures}`)
  }
  return entities
}

export function extractEntityMappings(tasks, owner) {
  const entities = new Map()
  const add = (type, rawId, rawName, source, quality) => {
    const id = String(rawId || '').trim(), name = String(rawName || '').trim()
    if (!id || !name || id === name) return
    const key = `${type}:${id}`
    const candidate = { type, id, name, source, quality }
    if (quality >= (entities.get(key)?.quality || -1)) entities.set(key, candidate)
  }
  add('member', owner?.id, owner?.displayName, 'verified_user_profile.displayName', 100)
  for (const task of tasks || []) {
    const source = task || {}
    const projectObject = source.project && typeof source.project === 'object'
    const executorObject = source.executor && typeof source.executor === 'object'
    const creatorObject = source.creator && typeof source.creator === 'object'
    add('project', task?.projectId || entityId(source.project), entityName(source.project) || task?.projectName, 'task.project.name', projectObject ? 95 : 80)
    add('member', task?.executorId || entityId(source.executor), entityName(source.executor) || task?.executorName, 'task.executor.name', executorObject ? 95 : 80)
    add('member', task?.creatorId || entityId(source.creator), entityName(source.creator) || task?.creatorName || source.creatorName, 'task.creator.name', creatorObject ? 95 : 80)
    for (const field of ['involveMembers', 'involvedMembers', 'participants']) {
      for (const member of Array.isArray(source[field]) ? source[field] : []) {
        add('member', entityId(member), entityName(member), `task.${field}`, 95)
      }
    }
    for (const kind of STRUCTURE_KINDS) {
      add(kind.type, task?.[kind.taskField] || source[kind.taskField], task?.[kind.nameField] || source[kind.nameField], `task.${kind.nameField}`, 75)
    }
    const tagIds = taskTagIds(task)
    const tagNames = Array.isArray(task?.tagNames) ? task.tagNames : []
    tagIds.forEach((id, index) => add('tag', id, tagNames[index], 'task.tagNames', 70))
  }
  return [...entities.values()]
}

function paginationProperties(schema) {
  const properties = schema?.properties || {}
  const key = (...names) => Object.keys(properties).find((name) => names.includes(normalizeKey(name))) || ''
  return {
    cursor: key('pagetoken', 'nextpagetoken', 'cursor', 'nextcursor', 'continuationtoken'),
    page: key('page', 'pagenum', 'pagenumber', 'currentpage'),
  }
}

function taskRowId(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (!value || typeof value !== 'object') return ''
  return String(value.id || value.taskId || value._id || value.uniqueId || '').trim()
}

// Teambition's task nextPageToken behaves like a scroll cursor: its value can
// stay the same while the server advances. Detect progress from task IDs,
// matching tb-agent, instead of assuming the cursor itself must change.
function countNewTaskRows(rows, seenIds) {
  let fresh = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = taskRowId(row)
    if (id && seenIds.has(id)) continue
    if (id) seenIds.add(id)
    fresh++
  }
  return fresh
}

function taskQueryArguments(schema, owner, ids) {
  const properties = schema?.properties || {}
  const args = {}
  const key = (...names) => Object.keys(properties).find((name) => names.includes(normalizeKey(name)))
  const taskIdsKey = key('taskids', 'taskid', 'ids', 'id', '_id')
  if (!taskIdsKey) return null
  args[taskIdsKey] = properties[taskIdsKey]?.type === 'array' ? ids : ids.join(',')
  const tenantKey = key('xtenantid', 'tenantid', 'orgid', 'organizationid')
  const operatorKey = key('xoperatorid', 'operatorid')
  const enrichKey = key('enrichfields')
  if (tenantKey) args[tenantKey] = owner.orgId
  if (operatorKey) args[operatorKey] = owner.id
  if (enrichKey) args[enrichKey] = 'project,members,tfs'
  if ((schema?.required || []).some((required) => !Object.hasOwn(args, required))) return null
  return args
}

function isTaskIdOnly(row) {
  if (typeof row === 'string' || typeof row === 'number') return true
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  const fields = Object.keys(row).map(normalizeKey).filter((key) => !['id', 'taskid', '_id', 'uniqueid'].includes(key))
  return fields.length === 0
}

async function fetchTasksByIds(client, tools, ids, owner, signal) {
  if (!ids.length) return []
  const detailTool = tools.find((item) => normalizeKey(item?.name || '') === 'querytaskv3')
  if (!detailTool) throw new Error('任务搜索仅返回任务 ID，但当前 MCP 服务未提供 QueryTaskV3 以获取任务详情。')
  const tasks = []
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50)
    const args = taskQueryArguments(detailTool.inputSchema, owner, chunk)
    if (!args) throw new Error('QueryTaskV3 的必填参数无法匹配，无法批量获取任务详情。')
    const response = await client.callTool({ name: detailTool.name, arguments: args }, undefined, { signal })
    const page = taskPage(resultPayload(response))
    tasks.push(...page.rows.filter((row) => row && typeof row === 'object'))
  }
  return tasks
}

function buildArguments(schema, owner, { cursor = '', pageNumber = 1 } = {}) {
  const properties = schema?.properties || {}
  const pageSizeKey = property(schema, 'pageSize')
  const sizeSchema = properties[pageSizeKey] || {}
  const maxPageSize = Number.isFinite(sizeSchema.maximum) ? sizeSchema.maximum : 100
  const pageSize = Math.max(Number.isFinite(sizeSchema.minimum) ? sizeSchema.minimum : 1, Math.min(100, maxPageSize))
  const args = {
    [property(schema, 'xOperatorId', 'x-operator-id')]: owner.id,
    [property(schema, 'xTenantId', 'X-Tenant-Id')]: owner.orgId,
    [property(schema, 'roleTypes')]: 'executor',
    [pageSizeKey]: sizeSchema.type === 'string' ? String(pageSize) : pageSize,
  }
  const tqlKey = Object.keys(properties).find((key) => normalizeKey(key) === 'tql')
  if (tqlKey) args[tqlKey] = 'isArchived = false ORDER BY updated DESC'
  const pagination = paginationProperties(schema)
  if (cursor && pagination.cursor) args[pagination.cursor] = cursor
  else if (!cursor && pagination.page) args[pagination.page] = pageNumber
  return args
}

export async function fetchOwnTasks({ config, owner, serverId }) {
  if (!owner?.id || !owner?.orgId) throw new Error('当前 Teambition 身份缺少组织或用户 ID，无法安全查询个人任务。')
  const servers = config?.mcp?.servers || {}
  const candidates = Object.entries(servers).filter(([id, server]) => {
    try {
      const url = new URL(server.url)
      return (!serverId || id === serverId) && url.origin === TRUSTED_ORIGIN && url.pathname === '/api/mcp'
    } catch { return false }
  })
  if (candidates.length !== 1) throw new Error('登录会话中的 Teambition MCP 服务无效，请重新登录。')
  const [id, server] = candidates[0]
  const client = new Client({ name: 'workhub-task-sync', version: '0.1.0' })
  const deadline = AbortSignal.timeout(180_000)
  try {
    const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers || {}, redirect: 'error' } })
    await client.connect(transport, { signal: deadline })
    const tools = []
    const cursors = new Set()
    let cursor
    do {
      const listed = await client.listTools(cursor ? { cursor } : undefined, { signal: deadline })
      tools.push(...(listed.tools || []))
      cursor = listed.nextCursor
      if (cursor && cursors.has(cursor)) throw new Error('Teambition MCP 工具清单分页出现循环。')
      if (cursor) cursors.add(cursor)
      if (cursors.size > 30) throw new Error('Teambition MCP 工具清单分页超过上限。')
    } while (cursor)
    const tool = tools.find((item) => item.name.toLowerCase() === 'searchusertasksv3')
    if (!tool) throw new Error('当前 MCP 未提供 SearchUserTasksV3，无法同步任务。')

    const tasks = new Map(), seenIds = new Set()
    const pagination = paginationProperties(tool.inputSchema)
    let pageToken = '', pageNumber = 1, total = null, pageCount = 0, newRows = 0, truncated = false, truncationReason = '', lastPageSize = 0
    do {
      const result = await client.callTool({ name: tool.name, arguments: buildArguments(tool.inputSchema, owner, { cursor: pageToken, pageNumber }) }, undefined, { signal: deadline })
      const page = taskPage(resultPayload(result))
      if (page.total != null) total = Math.max(total || 0, page.total)
      lastPageSize = page.rows.length
      newRows = countNewTaskRows(page.rows, seenIds)
      const detailIds = []
      for (const row of page.rows) {
        if (isTaskIdOnly(row)) {
          const rowId = taskRowId(row)
          if (rowId) detailIds.push(rowId)
          continue
        }
        const task = normalizeTask(row)
        if (!task || task.isArchived || (task.executorId && task.executorId !== String(owner.id))) continue
        tasks.set(task.id, task)
      }
      if (detailIds.length) {
        const details = await fetchTasksByIds(client, tools, [...new Set(detailIds)], owner, deadline)
        for (const row of details) {
          const task = normalizeTask(row)
          if (!task || task.isArchived || (task.executorId && task.executorId !== String(owner.id))) continue
          tasks.set(task.id, task)
        }
      }
      pageCount++
      const hasNextPage = Boolean(page.next || page.hasMore)
      if (!hasNextPage) break
      if (newRows === 0) { truncated = true; truncationReason = 'repeated_page'; break }
      if (page.next) {
        if (!pagination.cursor) { truncated = true; truncationReason = 'cursor_parameter_missing'; break }
        pageToken = page.next
      } else if (pagination.page) {
        pageNumber++
      } else {
        truncated = true
        truncationReason = 'next_page_without_cursor'
        break
      }
      if (pageCount >= TASK_PAGE_LIMIT) { truncated = true; truncationReason = 'page_limit'; break }
    } while (true)
    if (!truncated && total != null && total > tasks.size) {
      truncated = true
      truncationReason = 'reported_total_exceeds_fetched'
    }
    const normalizedTasks = [...tasks.values()]
    const entities = await resolveEntityNames(client, tools, normalizedTasks, owner, deadline)
    await resolveCustomFieldNames(client, tools, normalizedTasks, owner, deadline)
    for (const task of normalizedTasks) applyWorktimeFields(task)
    const tagEntities = await resolveTagNames(client, tools, normalizedTasks, owner, server, deadline)
    const structureEntities = await resolveStructureNames(client, tools, normalizedTasks, owner, deadline)
    const projectNames = new Map(entities.filter((entity) => entity.type === 'project').map((entity) => [String(entity.id), entity.name]))
    await resolveStatusTransitionTimes(normalizedTasks, owner, server, deadline, projectNames)
    return { tasks: normalizedTasks, entities: [...entities, ...tagEntities, ...structureEntities], fetchedCount: tasks.size, reportedTotal: total, pageCount, lastPageSize, truncated, truncationReason, source: tool.name, serverId: id }
  } catch (error) {
    if (deadline.aborted) throw new Error('Teambition 任务同步超时，请稍后重试。')
    if (/^|userToken=|token=/i.test(String(error?.message))) throw new Error('Teambition 任务同步失败，请检查 MCP 权限与网络。')
    throw error
  } finally {
    await client.close().catch(() => {})
  }
}
