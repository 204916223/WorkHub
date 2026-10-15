import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { PluginRegistry } from '../../build/host/plugin-registry.js'
import { PluginManager } from '../../build/host/plugin-manager.js'
import { ServiceRegistry } from '../../build/host/plugin-context.js'
import { MessageBus } from '../../build/host/message-bus.js'
import { AiToolRegistry } from '../../build/host/ai/ai-tool-registry.js'
import { createPlugins } from '../../plugins/server-registry.js'
import { ToolExecutor } from '../tools/executor.js'

const emptySchema = { type: 'object', properties: {}, additionalProperties: false }
function noArgs(input) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('此工具不接受参数。') }

export class WorkspaceRuntime {
  constructor(owner, store) {
    this.owner = typeof owner === 'string' ? { key: owner, id: owner, displayName: owner } : owner
    this.id = this.owner.key; this.store = store; this.startedAt = new Date().toISOString(); this.runs = new Map()
    this.registry = new PluginRegistry(); this.tools = new AiToolRegistry(); this.bus = new MessageBus(); this.services = new ServiceRegistry()
    for (const plugin of createPlugins()) this.registry.register(plugin)
    this.services.set('workspace', { info: () => this.info() })
    this.manager = new PluginManager(this.registry, { services: this.services, messageBus: this.bus, aiTools: this.tools })
    this.executor = new ToolExecutor(this.tools, (event) => this.record(event))
    this.tools.register({ name: 'host_list_plugins', description: '查看插件清单、启停状态和已注册工具。', inputSchema: emptySchema, effect: 'read', validate: noArgs, execute: async () => this.describe() })
    this.tools.register({ name: 'host_get_status', description: '查看中控资源和运行状态。', inputSchema: emptySchema, effect: 'read', validate: noArgs, execute: async () => this.resources() })
    this.tools.register({ name: 'host_get_current_user', description: '查看经 MCP 验证的当前用户基本信息。', inputSchema: emptySchema, effect: 'read', validate: noArgs, execute: async () => this.owner })
    this.tools.register({
      name: 'host_set_plugin_enabled', description: '启用或停用一个插件，同时更新其页面和 AI 能力。', effect: 'write',
      inputSchema: { type: 'object', properties: { pluginId: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['pluginId', 'enabled'], additionalProperties: false },
      validate: (input) => {
        if (!input || typeof input.pluginId !== 'string' || typeof input.enabled !== 'boolean' || Object.keys(input).some((key) => !['pluginId', 'enabled'].includes(key))) throw new Error('需要插件 ID 和布尔类型的启用状态。')
        this.registry.get(input.pluginId)
      },
      execute: async (input, { signal }) => {
        signal.throwIfAborted()
        if (input.enabled) {
          const report = await this.manager.enable(input.pluginId)
          if (report.failed.length || report.skipped.length) throw new Error(report.failed[0]?.error.message || report.skipped[0].reason)
        } else await this.manager.disable(input.pluginId)
        await this.store.update(this.id, (state) => { state.enabledPlugins = this.manager.getActivePluginIds() })
        return this.describe()
      },
    })
  }
  async start() {
    const state = await this.store.read(this.id)
    if (state.pluginDefaultsVersion !== 2) {
      if (Array.isArray(state.enabledPlugins)) {
        for (const pluginId of ['tasks', 'worktime']) if (!state.enabledPlugins.includes(pluginId)) state.enabledPlugins.push(pluginId)
      }
      state.pluginDefaultsVersion = 2
      await this.store.write(this.store.file(this.id), state)
    }
    await this.manager.activateEnabled(state.enabledPlugins ?? undefined)
    return this
  }
  describe() {
    this.executor.prune()
    return { workspaceId: this.id, owner: this.owner, pendingApprovals: [...this.executor.pending.keys()], plugins: this.registry.list().map(({ manifest }) => ({ ...manifest, state: this.manager.getState(manifest.id) })), tools: this.tools.list() }
  }
  info() { return { name: 'WorkHub', version: '0.1.0', workspaceId: this.id, owner: this.owner, startedAt: this.startedAt, activePlugins: this.manager.getActivePluginIds(), toolCount: this.tools.list().length } }
  resources() {
    const memory = process.memoryUsage()
    return { ...this.info(), nodeVersion: process.version, platform: `${os.platform()} / ${os.arch()}`, uptimeSeconds: Math.floor(process.uptime()), memory: { rss: memory.rss, heapUsed: memory.heapUsed }, activeRuns: this.runs.size, pendingApprovals: this.executor.pending.size }
  }
  async record(event) {
    await this.store.update(this.id, (state) => { state.events = [{ id: randomUUID(), at: new Date().toISOString(), ...event }, ...(state.events || [])].slice(0, 200) })
  }
  async events() { return (await this.store.read(this.id)).events || [] }
  async stop() {
    for (const controller of this.runs.values()) controller.abort()
    this.executor.clear()
    try { await this.manager.deactivateAll() } finally { this.bus.clear() }
  }
}

export class WorkspacePool {
  constructor(store) { this.store = store; this.workspaces = new Map() }
  async get(owner) {
    const id = typeof owner === 'string' ? owner : owner.key
    this.store.file(id)
    if (!this.workspaces.has(id)) {
      const pending = new WorkspaceRuntime(owner, this.store).start()
      this.workspaces.set(id, pending)
      pending.catch(() => this.workspaces.delete(id))
    }
    const runtime = await this.workspaces.get(id)
    if (typeof owner !== 'string') runtime.owner = owner
    return runtime
  }
  async stop() { await Promise.allSettled([...this.workspaces.values()].map(async (pending) => (await pending).stop())) }
}
