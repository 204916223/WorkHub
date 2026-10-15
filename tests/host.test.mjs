import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginRegistry } from '../build/host/plugin-registry.js'
import { PluginManager } from '../build/host/plugin-manager.js'
import { DisposableStore } from '../build/host/plugin-context.js'
import { MessageBus } from '../build/host/message-bus.js'
import { AiToolRegistry } from '../build/host/ai/ai-tool-registry.js'

const logger = { info() {}, error() {}, warn() {} }
function plugin(id, options = {}) {
  return { manifest: { id, version: '1', defaultEnabled: true, dependencies: options.dependencies || [] }, activate: options.activate || (() => {}), deactivate: options.deactivate || (() => {}) }
}
function create(plugins, options = {}) {
  const registry = new PluginRegistry()
  for (const item of plugins) registry.register(item)
  return new PluginManager(registry, { logger, ...options })
}
test('BTT lifecycle: dependencies activate first and shutdown reverses order', async () => {
  const events = []
  const plugins = ['consumer', 'source'].map((id) => plugin(id, { dependencies: id === 'consumer' ? ['source'] : [], activate: () => events.push(`+${id}`), deactivate: () => events.push(`-${id}`) }))
  const manager = create(plugins)
  await manager.enable('consumer')
  assert.deepEqual(events, ['+source', '+consumer'])
  await assert.rejects(manager.disable('source'), /required/)
  await manager.deactivateAll()
  assert.deepEqual(events, ['+source', '+consumer', '-consumer', '-source'])
})
test('BTT lifecycle: cycles and missing dependencies fail before activation', async () => {
  await assert.rejects(create([plugin('a', { dependencies: ['b'] }), plugin('b', { dependencies: ['a'] })]).activateEnabled(), /cycle/)
  await assert.rejects(create([plugin('a', { dependencies: ['missing'] })]).activateEnabled(), /missing/)
})
test('failed activation and failed cleanup do not block unrelated plugins', async () => {
  const manager = create([plugin('broken', { activate(ctx) { ctx.disposables.add({ dispose() { throw Error('cleanup') } }); throw Error('activate') } }), plugin('ok')])
  const report = await manager.activateEnabled()
  assert.equal(report.failed[0].error.message, 'activate')
  assert.deepEqual(report.activated, ['ok'])
  await manager.deactivateAll()
})
test('cleanup runs every resource in reverse order even when one fails', async () => {
  const store = new DisposableStore(), seen = []
  store.add({ dispose() { seen.push('first') } })
  store.add({ dispose() { seen.push('second'); throw Error('failure') } })
  store.add({ async dispose() { await Promise.resolve(); seen.push('third') } })
  await assert.rejects(store.dispose(), AggregateError)
  assert.deepEqual(seen, ['third', 'second', 'first'])
  await store.dispose()
})
test('shutdown cleans all plugins and settles state despite lifecycle failures', async () => {
  const manager = create([plugin('one'), plugin('two', { activate(ctx) { ctx.disposables.add({ dispose() { throw Error('dispose') } }) }, deactivate() { throw Error('deactivate') } })])
  await manager.activateEnabled()
  await assert.rejects(manager.deactivateAll(), AggregateError)
  assert.equal(manager.getState('one'), 'inactive'); assert.equal(manager.getState('two'), 'inactive')
})
test('plugin-owned tools are automatically removed on disable', async () => {
  const tools = new AiToolRegistry()
  const manager = create([plugin('demo', { activate(ctx) { ctx.aiTools.register({ name: 'demo_read', description: 'read', inputSchema: {}, effect: 'read', validate() {}, async execute() { return 1 } }) } })], { aiTools: tools })
  await manager.enable('demo'); assert.equal(tools.list()[0].pluginId, 'demo')
  await manager.disable('demo'); assert.deepEqual(tools.list(), [])
  await manager.enable('demo'); assert.equal(tools.list().length, 1)
  await manager.deactivateAll()
})
test('message subscriptions release their handlers', async () => {
  const bus = new MessageBus(); let calls = 0
  const subscription = bus.on('changed', () => { calls++ })
  await bus.dispatch({ type: 'changed' }); subscription.dispose()
  assert.equal(await bus.dispatch({ type: 'changed' }), false); assert.equal(calls, 1)
})
