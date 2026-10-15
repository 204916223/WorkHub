import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { UserStore } from '../server/storage/user-store.js'
import { TaskDatabase } from '../server/storage/task-database.js'
import { applyWorktimeFields } from '../connectors/teambition/worktime-fields.js'
import { EntityDatabase } from '../server/storage/entity-database.js'
import { normalizeTask, resolveStructureNames, extractEntityMappings } from '../connectors/teambition/tasks.js'

const owner = { id: 'user-1', orgId: 'org-1', displayName: '陈凯伦' }
const signal = () => new AbortController().signal

test('normalizeTask extracts structure fields as first-class values', () => {
  const task = normalizeTask({
    id: 'task-1', content: '中控18-白云 小车行为树调测', projectId: 'p1',
    tfsId: 'tfs-1', sfcId: 'sfc-1', tasklistId: 'tl-1', stageId: 'st-1',
    sprintId: null, uniqueId: 14036, storyPoint: null, visible: 'projectMembers',
    tagIds: ['tag-1'],
  })
  assert.equal(task.tfsId, 'tfs-1')
  assert.equal(task.sfcId, 'sfc-1')
  assert.equal(task.tasklistId, 'tl-1')
  assert.equal(task.stageId, 'st-1')
  assert.equal(task.sprintId, '')
  assert.equal(task.uniqueId, 14036)
  assert.equal(task.storyPoint, null)
  assert.equal(task.visible, 'projectMembers')
  assert.equal(task.tfsName, '')
})

test('resolveStructureNames maps names onto tasks and returns entities via exact tool names', async () => {
  const definitions = {
    SearchTaskflowStatusesV3: { result: [{ id: 'tfs-1', name: '已完成' }] },
    'teambition.project.sfc-query': { result: [{ id: 'sfc-1', name: '软件开发' }] },
    'teambition.project.task-group-query': { result: [{ id: 'tl-1', title: '团队任务' }] },
    'teambition.project.task-list-query': { result: [{ id: 'st-1', name: '对接组' }] },
  }
  const calls = []
  const tools = Object.keys(definitions).map((name) => ({
    name, description: `查询${name}`,
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, id: { type: 'string' }, tfsIds: { type: 'string' }, pageSize: { type: 'integer' }, taskGroupId: { type: 'string' }, taskListId: { type: 'string' } }, required: ['projectId'] },
  }))
  const client = {
    async callTool({ name, arguments: args }) {
      calls.push({ name, args })
      return { structuredContent: definitions[name] }
    },
  }
  const tasks = [{ projectId: 'p1', tfsId: 'tfs-1', sfcId: 'sfc-1', tasklistId: 'tl-1', stageId: 'st-1' }]
  const entities = await resolveStructureNames(client, tools, tasks, owner, signal())
  assert.equal(tasks[0].tfsName, '已完成')
  assert.equal(tasks[0].sfcName, '软件开发')
  assert.equal(tasks[0].tasklistName, '团队任务')
  assert.equal(tasks[0].stageName, '对接组')
  const byType = new Map(entities.map((entity) => [entity.type, entity]))
  assert.equal(byType.get('tfs').name, '已完成')
  assert.equal(byType.get('sfc').name, '软件开发')
  assert.equal(byType.get('tasklist').name, '团队任务')
  assert.equal(byType.get('stage').name, '对接组')
  for (const call of calls) assert.equal(call.args.projectId, 'p1')
  const tfsCall = calls.find((call) => call.name === 'SearchTaskflowStatusesV3')
  assert.equal(tfsCall.args.tfsIds, 'tfs-1')
  assert.equal(tfsCall.args.pageSize, 100)
})

test('resolveStructureNames discovers fallback tools by schema and skips unavailable kinds', async () => {
  const tools = [{
    name: 'QueryProjectTfsV3', description: '按当前项目有效工作流查询工作流状态',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, id: { type: 'string' } }, required: ['projectId'] },
  }]
  const client = {
    async callTool({ name, arguments: args }) {
      assert.equal(name, 'QueryProjectTfsV3')
      assert.equal(args.id, 'tfs-2')
      return { structuredContent: { result: [{ id: 'tfs-2', name: '进行中' }] } }
    },
  }
  const tasks = [{ projectId: 'p2', tfsId: 'tfs-2' }]
  const entities = await resolveStructureNames(client, tools, tasks, owner, signal())
  assert.equal(tasks[0].tfsName, '进行中')
  assert.equal(entities.filter((entity) => entity.type === 'tfs')[0].name, '进行中')
})

test('extractEntityMappings harvests structure and tag mappings from tasks', () => {
  const entities = extractEntityMappings([{
    projectId: 'p1', projectName: '本体开发部',
    tfsId: 'tfs-1', tfsName: '已完成', tagIds: ['tag-1', 'tag-2'], tagNames: ['订单', '售前'],
  }], owner)
  const key = (type, id) => entities.find((entity) => entity.type === type && entity.id === id)
  assert.equal(key('tfs', 'tfs-1')?.name, '已完成')
  assert.equal(key('tag', 'tag-1')?.name, '订单')
  assert.equal(key('tag', 'tag-2')?.name, '售前')
  assert.equal(key('project', 'p1')?.name, '本体开发部')
})

test('EntityDatabase persists new entity types and lookups by singular or plural keys', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-entities-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const store = new UserStore(root)
  const database = new EntityDatabase(store, 'org-1')
  const saved = await database.save([
    { type: 'member', id: 'user-1', name: '陈凯伦', source: 'test', quality: 90 },
    { type: 'tfs', id: 'tfs-1', name: '已完成', source: 'test', quality: 95 },
    { type: 'tag', id: 'tag-1', name: '订单', source: 'test', quality: 90 },
    { type: 'stage', id: 'st-1', name: '对接组', source: 'test', quality: 95 },
    { type: 'unknown', id: 'x', name: '不应入库', source: 'test', quality: 90 },
  ])
  assert.equal(saved, 4)
  const found = await database.lookup({ members: ['user-1'], tfs: ['tfs-1'], tags: ['tag-1'], stages: ['st-1'], nope: ['x'] })
  assert.equal(found.members['user-1'], '陈凯伦')
  assert.equal(found.tfs['tfs-1'], '已完成')
  assert.equal(found.tags['tag-1'], '订单')
  assert.equal(found.stages['st-1'], '对接组')
  assert.equal(found.nope, undefined)
})

test('EntityDatabase migrates legacy member/project CHECK constraint without losing rows', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-entities-legacy-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const store = new UserStore(root)
  const file = store.entityDatabasePath('org-legacy')
  mkdirSync(path.dirname(file), { recursive: true })
  const legacy = new DatabaseSync(file)
  legacy.exec(`CREATE TABLE entities (
    entity_type TEXT NOT NULL CHECK (entity_type IN ('member', 'project')),
    entity_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    name_quality INTEGER NOT NULL DEFAULT 0,
    name_source TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT '',
    observed_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (entity_type, entity_id)
  )`)
  legacy.prepare("INSERT INTO entities (entity_type, entity_id, display_name, name_quality, name_source, first_seen_at, observed_at) VALUES ('member', 'user-9', '旧用户', 50, 'legacy', '2026-01-01', '2026-01-01')").run()
  legacy.close()

  const database = new EntityDatabase(store, 'org-legacy')
  await database.save([{ type: 'tag', id: 'tag-1', name: '订单', source: 'test', quality: 90 }])
  const found = await database.lookup({ members: ['user-9'], tags: ['tag-1'] })
  assert.equal(found.members['user-9'], '旧用户')
  assert.equal(found.tags['tag-1'], '订单')

  const check = new DatabaseSync(file)
  const schema = check.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'").get().sql
  const types = check.prepare("SELECT DISTINCT entity_type FROM entities ORDER BY entity_type").all().map((row) => row.entity_type)
  check.close()
  assert.ok(schema.includes("'tag'"))
  assert.deepEqual(types, ['member', 'tag'])
})

test('normalizeTask keeps raw fields like tb-agent while stripping attachments', () => {
  const task = normalizeTask({
    id: 'task-1', content: '回放模式', ancestorIds: ['a1', 'a2'], recurrence: null, taskId: 'task-1',
    attachments: [{ id: 'f1' }], comments: [{ id: 'c1' }],
  })
  assert.deepEqual(task.ancestorIds, ['a1', 'a2'])
  assert.equal(task.taskId, 'task-1')
  assert.equal(task.content, '回放模式')
  assert.equal(task.title, '回放模式')
  assert.equal(task.attachments, undefined)
  assert.equal(task.comments, undefined)
})

test('applyWorktimeFields derives worktime fields from named custom fields', () => {
  const field = (name, title) => ({ cfId: name, name, value: [{ title }] })
  const included = applyWorktimeFields({ isDone: false, isArchived: false, dueDate: '2020-01-01T00:00:00.000Z',
    customfields: [field('是否计入工时统计', '是'), field('工作日耗时（天）', '2.5'), field('实际有效工时(天)', '1')] })
  assert.equal(included.worktimeIncluded, true)
  assert.equal(included.workdayDuration, 2.5)
  assert.equal(included.actualEffectiveWorkdays, 1)
  assert.equal(included.overdue, true)
  const excluded = applyWorktimeFields({ isDone: true, dueDate: '2020-01-01T00:00:00.000Z',
    customfields: [field('是否计入工时统计', '否'), field('工作日耗时（天）', '3')] })
  assert.equal(excluded.worktimeIncluded, false)
  assert.equal(excluded.workdayDuration, 0)
  assert.equal(excluded.overdue, false)
  const bare = applyWorktimeFields({ customfields: [] })
  assert.equal(bare.worktimeIncluded, null)
  assert.equal(bare.workdayDuration, 0)
})

test('TaskDatabase persists sfcName, tagNames and worktime fields and refreshes stale rows', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-tasks-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const database = new TaskDatabase(new UserStore(root), 'org-1:user-1')
  const base = { id: 'task-1', title: '回放模式', projectName: '', executorName: '', creatorName: '', updated: '2026-10-01T00:00:00.000Z', state: 'unfinished',
    sfcId: 'sfc-1', sfcName: '软件开发', tagIds: ['tag-1'], tagNames: ['研发'], customfields: [] }
  const withFields = { ...base, worktimeIncluded: true, workdayDuration: 2.5, actualEffectiveWorkdays: 0, overdue: true }

  await database.saveSync({ orgId: 'org-1', tasks: [base], fetchedCount: 1 })
  const second = await database.saveSync({ orgId: 'org-1', tasks: [withFields], fetchedCount: 1 })
  assert.equal(second.updated, 1)

  const { tasks } = await database.list({ orgId: 'org-1' })
  assert.equal(tasks[0].sfcName, '软件开发')
  assert.deepEqual(tasks[0].tagNames, ['研发'])
  assert.equal(tasks[0].workdayDuration, 2.5)
  assert.equal(tasks[0].overdue, true)

  const third = await database.saveSync({ orgId: 'org-1', tasks: [withFields], fetchedCount: 1 })
  assert.equal(third.unchanged, 1)
})

test('TaskDatabase stores tfsName for filtering and rewrites legacy sourceData payloads', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-tfs-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const store = new UserStore(root)
  const database = new TaskDatabase(store, 'org-1:user-1')
  const task = (id, tfsName, extra = {}) => ({ id, title: id, projectName: '', executorName: '', creatorName: '', updated: '2026-10-01T00:00:00.000Z', state: 'unfinished', tfsName, customfields: [], ...extra })
  await database.saveSync({ orgId: 'org-1', tasks: [task('a', '待评审'), task('b', '开发中')], fetchedCount: 2 })
  const filtered = await database.list({ orgId: 'org-1', filters: [{ field: 'tfsName', operator: 'equals', value: '待评审' }] })
  assert.deepEqual(filtered.tasks.map((item) => item.id), ['a'])
  const grouped = await database.list({ orgId: 'org-1', groupBy: 'tfsName' })
  assert.equal(grouped.groupCount, 2)

  const raw = new DatabaseSync(store.taskDatabasePath('org-1:user-1'))
  raw.prepare("UPDATE tasks SET payload = json_set(payload, '$.sourceData', json('{}')) WHERE task_id = 'a'").run()
  raw.close()
  const resaved = await database.saveSync({ orgId: 'org-1', tasks: [task('a', '待评审'), task('b', '开发中')], fetchedCount: 2 })
  assert.equal(resaved.updated, 1)
  assert.equal(resaved.unchanged, 1)
  const { tasks } = await database.list({ orgId: 'org-1', query: 'a' })
  assert.equal(Object.hasOwn(tasks[0], 'sourceData'), false)
})

test('TaskDatabase migrates tfs_name for databases created before the column existed', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-tfs-migrate-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const store = new UserStore(root)
  const file = store.taskDatabasePath('org-1:user-2')
  mkdirSync(path.dirname(file), { recursive: true })
  const legacy = new DatabaseSync(file)
  legacy.exec(`CREATE TABLE tasks (org_id TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', executor_id TEXT NOT NULL DEFAULT '', executor_name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'unfinished', due_date TEXT, created_at TEXT, source_updated_at TEXT, synced_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (org_id, task_id))`)
  legacy.prepare("INSERT INTO tasks (org_id, task_id, title, synced_at, payload) VALUES ('org-1', 'x', 'x', '2026-01-01', ?)").run(JSON.stringify({ id: 'x', title: 'x', tfsName: '评审中' }))
  legacy.close()
  const found = await new TaskDatabase(store, 'org-1:user-2').list({ orgId: 'org-1', filters: [{ field: 'tfsName', operator: 'equals', value: '评审中' }] })
  assert.equal(found.total, 1)
})
