import { randomUUID } from 'node:crypto'

export class ToolExecutor {
  constructor(registry, record, ttlMs = 10 * 60_000) {
    this.registry = registry; this.record = record; this.pending = new Map(); this.ttlMs = ttlMs
  }
  prune() { for (const [id, item] of this.pending) if (item.expiresAt <= Date.now()) this.pending.delete(id) }
  async invoke(name, input, { signal = new AbortController().signal, continuation = null } = {}) {
    signal.throwIfAborted()
    const tool = this.registry.get(name)
    const args = structuredClone(input)
    tool.validate(args)
    if (tool.effect === 'write') {
      this.prune()
      const approval = { id: randomUUID(), name, description: tool.description, input: args, expiresAt: Date.now() + this.ttlMs }
      this.pending.set(approval.id, { ...approval, continuation, tool })
      await this.record({ type: 'approval', name, status: 'pending', detail: '等待操作确认' })
      return { approval }
    }
    return { result: await this.execute(tool, args, signal) }
  }
  async decide(id, approved, signal = new AbortController().signal) {
    const item = this.pending.get(id)
    if (!item || item.expiresAt <= Date.now()) { this.pending.delete(id); throw new Error('确认请求不存在或已过期，请重新发起操作。') }
    this.pending.delete(id)
    let result
    if (!approved) {
      result = { ok: false, denied: true, message: '用户拒绝了该操作。' }
      await this.record({ type: 'approval', name: item.name, status: 'denied', detail: '用户拒绝执行' })
    } else {
      signal.throwIfAborted()
      if (this.registry.get(item.name) !== item.tool) throw new Error('工具已经发生变化，请重新发起操作。')
      item.tool.validate(item.input)
      result = await this.execute(item.tool, item.input, signal)
    }
    return { result, continuation: item.continuation }
  }
  async execute(tool, input, signal) {
    const started = Date.now()
    signal.throwIfAborted()
    try {
      const result = await tool.execute(input, { signal })
      await this.record({ type: 'tool', name: tool.name, status: 'done', durationMs: Date.now() - started, detail: tool.description })
      return result
    } catch (error) {
      await this.record({ type: 'tool', name: tool.name, status: signal.aborted ? 'cancelled' : 'failed', durationMs: Date.now() - started, detail: error.message })
      throw error
    }
  }
  clear() { this.pending.clear() }
}
