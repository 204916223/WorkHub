import { mkdir, chmod } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ENTITY_TYPES = ['member', 'project', 'tag', 'tfs', 'sfc', 'tasklist', 'stage']
const TYPES = new Set(ENTITY_TYPES)
const TYPE_CHECK = ENTITY_TYPES.map((type) => `'${type}'`).join(', ')
const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS {name} (
    entity_type TEXT NOT NULL CHECK (entity_type IN (${TYPE_CHECK})),
    entity_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    name_quality INTEGER NOT NULL DEFAULT 0,
    name_source TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT '',
    observed_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  );
`
// lookup 请求键 -> 实体类型（members→member、tasklists→tasklist 等，单复数均接受）
function requestType(key) {
  if (TYPES.has(key)) return key
  const singular = key.endsWith('s') ? key.slice(0, -1) : key
  return TYPES.has(singular) ? singular : null
}

export class EntityDatabase {
  constructor(userStore, orgId) {
    this.file = userStore.entityDatabasePath(orgId)
  }

  async open() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const db = new DatabaseSync(this.file)
    await chmod(this.file, 0o600).catch(() => {})
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      ${TABLE_SQL.replace('{name}', 'entities')}
    `)
    const columns = new Set(db.prepare('PRAGMA table_info(entities)').all().map((column) => column.name))
    if (!columns.has('name_quality')) db.exec('ALTER TABLE entities ADD COLUMN name_quality INTEGER NOT NULL DEFAULT 0')
    if (!columns.has('name_source')) db.exec("ALTER TABLE entities ADD COLUMN name_source TEXT NOT NULL DEFAULT ''")
    if (!columns.has('first_seen_at')) db.exec("ALTER TABLE entities ADD COLUMN first_seen_at TEXT NOT NULL DEFAULT ''")
    // 旧库 CHECK 约束只放行 member/project，重建表以支持全部实体类型
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='entities'").get()
    if (schema?.sql && !schema.sql.includes("'tag'")) {
      db.exec(`
        BEGIN IMMEDIATE;
        ${TABLE_SQL.replace('{name}', 'entities_migrated')}
        INSERT INTO entities_migrated (entity_type, entity_id, display_name, name_quality, name_source, first_seen_at, observed_at)
          SELECT entity_type, entity_id, display_name, name_quality, name_source, first_seen_at, observed_at FROM entities;
        DROP TABLE entities;
        ALTER TABLE entities_migrated RENAME TO entities;
        COMMIT;
      `)
    }
    return db
  }

  async save(entities = []) {
    const clean = entities.filter((entity) => TYPES.has(entity?.type)
      && typeof entity.id === 'string' && entity.id.trim()
      && typeof entity.name === 'string' && entity.name.trim()
      && entity.id.trim() !== entity.name.trim())
    if (!clean.length) return 0
    const db = await this.open()
    const now = new Date().toISOString()
    try {
      const save = db.prepare(`
        INSERT INTO entities (entity_type, entity_id, display_name, name_quality, name_source, first_seen_at, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          display_name=CASE WHEN excluded.name_quality >= entities.name_quality THEN excluded.display_name ELSE entities.display_name END,
          name_source=CASE WHEN excluded.name_quality >= entities.name_quality THEN excluded.name_source ELSE entities.name_source END,
          name_quality=MAX(entities.name_quality, excluded.name_quality),
          observed_at=excluded.observed_at
      `)
      db.exec('BEGIN IMMEDIATE')
      for (const entity of clean) save.run(
        entity.type,
        entity.id.trim(),
        entity.name.trim().slice(0, 200),
        Math.max(0, Math.min(100, Number(entity.quality) || 0)),
        String(entity.source || '').slice(0, 120),
        now,
        now,
      )
      db.exec('COMMIT')
      return clean.length
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    } finally { db.close() }
  }

  // 请求形如 { members: [...], projects: [...], tfs: [...], tasklists: [...] }，
  // 键为实体类型（接受单复数），返回同键结构的 { [键]: { id: 名称 } }
  async lookup(request = {}) {
    const wanted = new Map()
    for (const [key, ids] of Object.entries(request)) {
      const type = requestType(String(key).toLowerCase())
      if (!type) continue
      const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id.trim()))]
      wanted.set(key, { type, ids: list.map((id) => id.trim()) })
    }
    const result = Object.fromEntries([...wanted.keys()].map((key) => [key, {}]))
    if (!wanted.size) return result
    const db = await this.open()
    try {
      const allIds = [...new Set([...wanted.values()].flatMap((entry) => entry.ids))]
      const query = (chunk) => {
        const placeholders = chunk.map(() => '?').join(', ')
        return db.prepare(`SELECT entity_type, entity_id, display_name FROM entities WHERE entity_id IN (${placeholders})`).all(...chunk)
      }
      const rows = []
      for (let index = 0; index < allIds.length; index += 500) rows.push(...query(allIds.slice(index, index + 500)))
      for (const row of rows) {
        for (const [key, entry] of wanted) {
          if (entry.type === row.entity_type && entry.ids.includes(row.entity_id)) result[key][row.entity_id] = row.display_name
        }
      }
      return result
    } finally { db.close() }
  }
}
