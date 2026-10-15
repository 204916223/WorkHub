import { mkdir, chmod } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const taskFields = {
  title: { column: 'title', type: 'text' },
  projectName: { column: 'project_name', type: 'text' },
  executorName: { column: 'executor_name', type: 'text' },
  tfsName: { column: 'tfs_name', type: 'text' },
  state: { column: 'state', type: 'state' },
  dueDate: { column: 'date(due_date)', type: 'date' },
  updated: { column: 'date(source_updated_at)', type: 'date' },
}
const sortableTaskFields = {
  title: 'title', projectName: 'project_name', executorName: 'executor_name', tfsName: 'tfs_name', state: 'state',
  dueDate: "COALESCE(due_date, '')", updated: "COALESCE(source_updated_at, '')",
}
const dateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))

export class TaskDatabase {
  constructor(userStore, ownerKey) {
    this.file = userStore.taskDatabasePath(ownerKey)
  }

  async open() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.file)
    await chmod(this.file, 0o600).catch(() => {})
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS tasks (
        org_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        project_name TEXT NOT NULL DEFAULT '',
        executor_id TEXT NOT NULL DEFAULT '',
        executor_name TEXT NOT NULL DEFAULT '',
        tfs_name TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'unfinished',
        due_date TEXT,
        created_at TEXT,
        source_updated_at TEXT,
        synced_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (org_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS tasks_updated_idx ON tasks(source_updated_at);
      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_attempt_at TEXT,
        last_success_at TEXT,
        status TEXT NOT NULL DEFAULT 'never',
        fetched_count INTEGER NOT NULL DEFAULT 0,
        reported_total INTEGER,
        page_count INTEGER NOT NULL DEFAULT 0,
        last_page_size INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        unchanged_count INTEGER NOT NULL DEFAULT 0,
        truncated INTEGER NOT NULL DEFAULT 0,
        truncation_reason TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT ''
      );
      INSERT OR IGNORE INTO sync_state (id) VALUES (1);
    `)
    const syncColumns = new Set(db.prepare('PRAGMA table_info(sync_state)').all().map((column) => column.name))
    const taskColumns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name))
    if (!taskColumns.has('tfs_name')) {
      db.exec("ALTER TABLE tasks ADD COLUMN tfs_name TEXT NOT NULL DEFAULT ''")
      db.exec("UPDATE tasks SET tfs_name = COALESCE(json_extract(payload, '$.tfsName'), '')")
    }
    if (!syncColumns.has('reported_total')) db.exec('ALTER TABLE sync_state ADD COLUMN reported_total INTEGER')
    if (!syncColumns.has('page_count')) db.exec('ALTER TABLE sync_state ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0')
    if (!syncColumns.has('last_page_size')) db.exec('ALTER TABLE sync_state ADD COLUMN last_page_size INTEGER NOT NULL DEFAULT 0')
    if (!syncColumns.has('truncation_reason')) db.exec("ALTER TABLE sync_state ADD COLUMN truncation_reason TEXT NOT NULL DEFAULT ''")
    return db
  }

  async state() {
    const db = await this.open()
    try {
      const state = db.prepare('SELECT * FROM sync_state WHERE id = 1').get()
      const count = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count
      return { ...state, taskCount: count }
    } finally { db.close() }
  }

  async list({ orgId, query = '', state = '', startDate = '', endDate = '', filters = [], sorts = [], groupBy = '', page = 1, pageSize = 50 } = {}) {
    const db = await this.open()
    try {
      const where = ['org_id = ?']
      const params = [orgId]
      if (query) {
        where.push('(title LIKE ? ESCAPE \'\\\' OR project_name LIKE ? ESCAPE \'\\\')')
        const escaped = `%${query.replace(/[\\%_]/g, '\\$&')}%`
        params.push(escaped, escaped)
      }
      if (state) { where.push('state = ?'); params.push(state) }
      if (startDate) { where.push('date(due_date) >= date(?)'); params.push(startDate) }
      if (endDate) { where.push('date(due_date) <= date(?)'); params.push(endDate) }
      function buildFilterList(items, depth = 0) {
        const expressions = []
        for (const item of items.slice(0, 8)) {
          if (item?.type === 'group') {
            if (depth >= 3) continue
            const nested = buildFilterList(Array.isArray(item.rules) ? item.rules : [], depth + 1)
            if (nested) expressions.push({ ...nested, conjunction: item.conjunction === 'or' ? 'OR' : 'AND' })
            continue
          }
          const field = taskFields[item?.field]
          if (!field || typeof item.value !== 'string') continue
          const value = item.value.trim().slice(0, 150), operator = item.operator
          let expression = ''
          const expressionParams = []
          if (operator === 'is_empty') expression = `(${field.column} IS NULL OR ${field.column} = '')`
          else if (operator === 'is_not_empty') expression = `(${field.column} IS NOT NULL AND ${field.column} <> '')`
          else if (value && operator === 'contains' && field.type === 'text') {
            expression = `${field.column} LIKE ? ESCAPE '\\'`
            expressionParams.push(`%${value.replace(/[\\%_]/g, '\\$&')}%`)
          } else if (value && ['equals', 'not_equals', 'before', 'after', 'on_or_before', 'on_or_after'].includes(operator)) {
            if (['before', 'after', 'on_or_before', 'on_or_after'].includes(operator) && (field.type !== 'date' || !dateValue(value))) continue
            if (operator === 'before') expression = `${field.column} < date(?)`
            else if (operator === 'after') expression = `${field.column} > date(?)`
            else if (operator === 'on_or_before') expression = `${field.column} <= date(?)`
            else if (operator === 'on_or_after') expression = `${field.column} >= date(?)`
            else expression = `${field.column} ${operator === 'not_equals' ? '<>' : '='} ?`
            expressionParams.push(value)
          }
          if (expression) expressions.push({ expression, params: expressionParams, conjunction: item.conjunction === 'or' ? 'OR' : 'AND' })
        }
        if (!expressions.length) return null
        let expression = expressions[0].expression
        const expressionParams = [...expressions[0].params]
        for (const item of expressions.slice(1)) {
          expression = `(${expression} ${item.conjunction} ${item.expression})`
          expressionParams.push(...item.params)
        }
        return { expression, params: expressionParams }
      }
      const filtersExpression = buildFilterList(filters)
      if (filtersExpression) {
        where.push(`(${filtersExpression.expression})`)
        params.push(...filtersExpression.params)
      }
      const filter = where.join(' AND ')
      const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${filter}`).get(...params).count
      const order = []
      const safeGroupBy = sortableTaskFields[groupBy]
      const groupCount = safeGroupBy
        ? db.prepare(`SELECT COUNT(DISTINCT COALESCE(${safeGroupBy}, '')) AS count FROM tasks WHERE ${filter}`).get(...params).count
        : 0
      if (safeGroupBy) order.push(`${safeGroupBy} ASC`)
      for (const item of sorts.slice(0, 4)) {
        const column = sortableTaskFields[item?.field]
        if (column) order.push(`${column} ${item.direction === 'desc' ? 'DESC' : 'ASC'}`)
      }
      if (!order.length) order.push("COALESCE(due_date, '9999-12-31') ASC", 'source_updated_at DESC')
      const rows = db.prepare(`SELECT payload FROM tasks WHERE ${filter} ORDER BY ${order.join(', ')}, task_id ASC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize)
      return { tasks: rows.map((row) => JSON.parse(row.payload)), total, groupCount }
    } finally { db.close() }
  }

  async worktimeRows({ orgId } = {}) {
    const db = await this.open()
    try {
      return db.prepare(`SELECT task_id, title, project_name, executor_name, due_date, payload
        FROM tasks WHERE org_id = ? ORDER BY COALESCE(due_date, '') DESC, task_id ASC`).all(orgId)
        .map((row) => {
          let task = {}
          try { task = JSON.parse(row.payload) } catch {}
          return { ...task, id: row.task_id, title: row.title, projectName: task.projectName || row.project_name, executorName: task.executorName || row.executor_name, dueDate: task.dueDate || row.due_date }
        })
    } finally { db.close() }
  }

  async saveSync({ orgId, tasks, fetchedCount, reportedTotal = null, pageCount = 0, lastPageSize = 0, truncated, truncationReason = '', error = '' }) {
    const db = await this.open()
    const now = new Date().toISOString()
    let inserted = 0, updated = 0, unchanged = 0
    const upsert = db.prepare(`
      INSERT INTO tasks (org_id, task_id, title, project_id, project_name, executor_id, executor_name, tfs_name, state, due_date, created_at, source_updated_at, synced_at, payload)
      VALUES (@org_id, @task_id, @title, @project_id, @project_name, @executor_id, @executor_name, @tfs_name, @state, @due_date, @created_at, @source_updated_at, @synced_at, @payload)
      ON CONFLICT(org_id, task_id) DO UPDATE SET
        title=excluded.title, project_id=excluded.project_id, project_name=excluded.project_name,
        executor_id=excluded.executor_id, executor_name=excluded.executor_name, tfs_name=excluded.tfs_name, state=excluded.state,
        due_date=excluded.due_date, created_at=excluded.created_at, source_updated_at=excluded.source_updated_at,
        synced_at=excluded.synced_at, payload=excluded.payload
    `)
    const existing = db.prepare('SELECT source_updated_at, payload FROM tasks WHERE org_id = ? AND task_id = ?')
    const updateState = db.prepare(`UPDATE sync_state SET last_attempt_at=?, last_success_at=COALESCE(?, last_success_at), status=?, fetched_count=?, reported_total=?, page_count=?, last_page_size=?, inserted_count=?, updated_count=?, unchanged_count=?, truncated=?, truncation_reason=?, error=? WHERE id=1`)
    try {
      db.exec('BEGIN IMMEDIATE')
      for (const task of tasks) {
        if (!task?.id) continue
        const prior = existing.get(orgId, task.id)
        if (prior && task.updated && prior.source_updated_at === task.updated) {
          let priorTask
          let legacyPayload = true
          // 旧版 payload 把原始字段另存一份 sourceData；遇到就重写成去重后的结构
          try { priorTask = JSON.parse(prior.payload); legacyPayload = Object.hasOwn(priorTask, 'sourceData') } catch {}
          const namesUnchanged = priorTask?.projectName === (task.projectName || '')
            && priorTask?.executorName === (task.executorName || '')
            && priorTask?.creatorName === (task.creatorName || '')
          const structureNames = (entry) => ['tfsName', 'sfcName', 'tasklistName', 'stageName'].map((field) => String(entry?.[field] || '')).join('|')
          const structureNamesUnchanged = structureNames(priorTask) === structureNames(task)
          const customFieldNames = (fields) => (Array.isArray(fields) ? fields : [])
            .map((field) => [String(field?.cfId || field?.customFieldId || field?.id || ''), String(field?.name || field?.label || field?.title || '')])
            .sort(([left], [right]) => left.localeCompare(right))
          const customFieldNamesUnchanged = JSON.stringify(customFieldNames(priorTask?.customfields))
            === JSON.stringify(customFieldNames(task.customfields))
          const sortedTagNames = (names) => (Array.isArray(names) ? names : []).map(String).sort()
          const tagNamesUnchanged = JSON.stringify(sortedTagNames(priorTask?.tagNames)) === JSON.stringify(sortedTagNames(task.tagNames))
          const worktimeFields = (entry) => ['worktimeIncluded', 'actualEffectiveWorkdays', 'workdayDuration', 'overdue', 'statusChangedAt'].map((field) => JSON.stringify(entry?.[field] ?? null)).join('|')
          const worktimeFieldsUnchanged = worktimeFields(priorTask) === worktimeFields(task)
          if (!legacyPayload && namesUnchanged && structureNamesUnchanged && customFieldNamesUnchanged && tagNamesUnchanged && worktimeFieldsUnchanged) { unchanged++; continue }
        }
        upsert.run({
          org_id: orgId, task_id: task.id, title: task.title || '未命名任务', project_id: task.projectId || '',
          project_name: task.projectName || '', executor_id: task.executorId || '', executor_name: task.executorName || '', tfs_name: task.tfsName || '',
          state: task.state || 'unfinished', due_date: task.dueDate || null, created_at: task.created || null,
          source_updated_at: task.updated || null, synced_at: now, payload: JSON.stringify(task),
        })
        if (prior) updated++
        else inserted++
      }
      const status = error ? 'failed' : truncated ? 'partial' : 'success'
      updateState.run(now, !error && !truncated ? now : null, status, fetchedCount, reportedTotal, pageCount, lastPageSize, inserted, updated, unchanged, truncated ? 1 : 0, truncationReason, error)
      db.exec('COMMIT')
      return { status, fetchedCount, reportedTotal, pageCount, lastPageSize, inserted, updated, unchanged, truncated, truncationReason, syncedAt: now }
    } catch (cause) {
      try { db.exec('ROLLBACK') } catch {}
      throw cause
    } finally { db.close() }
  }

  async failSync(error) {
    const db = await this.open()
    try {
      const now = new Date().toISOString()
      db.prepare("UPDATE sync_state SET last_attempt_at=?, status='failed', error=? WHERE id=1").run(now, String(error || '同步失败').slice(0, 500))
      return db.prepare('SELECT * FROM sync_state WHERE id=1').get()
    } finally { db.close() }
  }
}
