import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function safeOwnerKey(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9._:@-]{1,180}$/.test(id) || ['.', '..'].includes(id)) throw new Error('用户标识无效。')
  return id
}
const FILES = new Set(['state.json', 'profile.json', 'sessions.json', 'prefs.json'])
export class UserStore {
  constructor(root) { this.root = root; this.queues = new Map() }
  file(id, name = 'state.json') { if (!FILES.has(name)) throw new Error('数据文件无效。'); return path.join(this.root, safeOwnerKey(id), name) }
  taskDatabasePath(id) { return path.join(this.root, safeOwnerKey(id), 'tasks.sqlite') }
  entityDatabasePath(orgId) { return path.join(this.root, 'organizations', safeOwnerKey(orgId), 'entities.sqlite') }
  async read(id, name = 'state.json', fallback = { enabledPlugins: null, events: [] }) {
    try { return JSON.parse(await readFile(this.file(id, name), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error }
  }
  update(id, mutate, name = 'state.json', fallback) {
    const file = this.file(id, name)
    const task = (this.queues.get(file) || Promise.resolve()).then(async () => {
      const state = await this.read(id, name, fallback)
      await mutate(state)
      await this.write(file, state)
      return state
    })
    const settled = task.catch(() => {})
    this.queues.set(file, settled)
    settled.finally(() => { if (this.queues.get(file) === settled) this.queues.delete(file) })
    return task
  }
  async write(file, value) {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const temp = `${file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temp, file)
  }
  async profile(owner) { return this.update(owner.key, (profile) => Object.assign(profile, owner, { lastVerifiedAt: new Date().toISOString() }), 'profile.json', {}) }
  async sessions(id) { return this.read(id, 'sessions.json', []) }
  async saveSessions(id, sessions) {
    if (!Array.isArray(sessions) || sessions.length > 30) throw new Error('最多保留 30 个会话。')
    const clean = sessions.map((item) => {
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !Array.isArray(item.messages)) throw new Error('会话格式无效。')
      return { id: item.id.slice(0, 80), title: item.title.slice(0, 120), createdAt: Number(item.createdAt) || Date.now(), updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(), messages: item.messages.slice(-200).map((message) => {
        if (!['assistant', 'user'].includes(message.role) || typeof message.content !== 'string') throw new Error('消息格式无效。')
        return { id: String(message.id || randomUUID()).slice(0, 80), role: message.role, content: message.content.slice(0, 100_000), ...(Array.isArray(message.steps) ? { steps: message.steps.slice(-100) } : {}), ...(message.approval ? { approval: message.approval, approvalState: message.approvalState } : {}) }
      }) }
    })
    return this.update(id, (current) => current.splice(0, current.length, ...clean), 'sessions.json', [])
  }
  async prefs(id) { return this.read(id, 'prefs.json', {}) }
  async savePrefs(id, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('偏好格式无效。')
    const clean = {}
    if (patch.layout) {
      const { aiVisible, aiWidth } = patch.layout
      if (typeof aiVisible !== 'boolean' || !Number.isFinite(aiWidth)) throw new Error('布局偏好格式无效。')
      clean.layout = { aiVisible, aiWidth: Math.max(280, Math.min(600, aiWidth)) }
    }
    if (patch.ai) {
      const { provider, baseUrl, model, temperature } = patch.ai
      if (!['openai-compatible', 'anthropic-compatible'].includes(provider) || typeof baseUrl !== 'string' || typeof model !== 'string' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('模型偏好格式无效。')
      clean.ai = { provider, baseUrl: baseUrl.slice(0, 1000), model: model.slice(0, 200), temperature }
    }
    return this.update(id, (current) => Object.assign(current, clean), 'prefs.json', {})
  }
}
