import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { UserStore } from '../server/storage/user-store.js'
import { WorkspacePool } from '../server/workspaces/runtime.js'
import { createServer } from '../server/http/server.js'
import { createMcpAuth } from '../server/auth/mcp-auth.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-test-'))
  const store = new UserStore(root), pool = new WorkspacePool(store)
  t.after(async () => { await pool.stop(); await rm(root, { recursive: true, force: true }) })
  return { pool, store, root }
}
test('workspaces isolate plugin state and reject approval from another workspace', async (t) => {
  const { pool } = await fixture(t)
  const one = await pool.get(randomUUID()), two = await pool.get(randomUUID())
  const outcome = await one.executor.invoke('host_set_plugin_enabled', { pluginId: 'workspace', enabled: false })
  assert.equal(one.manager.getState('workspace'), 'active')
  await assert.rejects(two.executor.decide(outcome.approval.id, true), /不存在/)
  await one.executor.decide(outcome.approval.id, true)
  assert.equal(one.manager.getState('workspace'), 'inactive'); assert.equal(two.manager.getState('workspace'), 'active')
  assert.ok(!one.tools.list().some((tool) => tool.name === 'workspace_get_info'))
  assert.ok(two.tools.list().some((tool) => tool.name === 'workspace_get_info'))
  await assert.rejects(one.executor.decide(outcome.approval.id, true), /不存在/)
})
test('refusal and cancellation never apply a write', async (t) => {
  const { pool } = await fixture(t), runtime = await pool.get(randomUUID())
  const input = { pluginId: 'workspace', enabled: false }
  const outcome = await runtime.executor.invoke('host_set_plugin_enabled', input)
  input.enabled = true
  assert.equal(outcome.approval.input.enabled, false)
  const denied = await runtime.executor.decide(outcome.approval.id, false)
  assert.equal(denied.result.denied, true); assert.equal(runtime.manager.getState('workspace'), 'active')
  const next = await runtime.executor.invoke('host_set_plugin_enabled', input)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(runtime.executor.decide(next.approval.id, true, controller.signal), { name: 'AbortError' })
  assert.equal(runtime.manager.getState('workspace'), 'active')
})
test('enabled plugins persist across a fresh runtime', async (t) => {
  const { pool, store } = await fixture(t), id = randomUUID(), runtime = await pool.get(id)
  const pending = await runtime.executor.invoke('host_set_plugin_enabled', { pluginId: 'workspace', enabled: false })
  await runtime.executor.decide(pending.approval.id, true)
  const next = new WorkspacePool(store); t.after(() => next.stop())
  assert.equal((await next.get(id)).manager.getState('workspace'), 'inactive')
})
test('serialized storage updates preserve concurrent events', async (t) => {
  const { store } = await fixture(t), id = randomUUID()
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.update(id, (state) => state.events.push(index))))
  assert.equal((await store.read(id)).events.length, 20)
  await assert.rejects(store.read('../escape'), /标识/)
})
test('HTTP validates workspace and arguments and exposes no unavailable plugin tool', async (t) => {
  const { pool, root } = await fixture(t), server = createServer(pool, root, createMcpAuth({ verify: async () => ({ owner: { key: 'org:alice', id: 'alice', displayName: 'Alice' }, connector: { name: 'Teambition' } }) }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`, id = randomUUID()
  const consume = async (response) => ({ status: response.status, data: await response.json() })
  assert.equal((await consume(await fetch(`${base}/api/workspace`))).status, 401)
  assert.equal((await consume(await fetch(`${base}/api/workspace`, { headers: { 'x-workhub-workspace': id, Origin: 'http://other-host' } }))).status, 403)
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: {} }) })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const post = async (url, data) => consume(await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-workhub-workspace': id, Cookie: cookie }, body: JSON.stringify(data) }))
  assert.equal((await post('/api/tools/invoke', { name: 'host_set_plugin_enabled', input: { pluginId: 'workspace', enabled: 'false' } })).status, 400)
  const pending = (await post('/api/tools/invoke', { name: 'host_set_plugin_enabled', input: { pluginId: 'workspace', enabled: false } })).data
  await post('/api/approvals/decide', { id: pending.approval.id, approved: true })
  const workspace = await (await fetch(`${base}/api/workspace`, { headers: { 'x-workhub-workspace': id, Cookie: cookie } })).json()
  assert.equal(workspace.plugins[0].state, 'inactive')
  assert.ok(!workspace.tools.some((tool) => tool.name === 'workspace_get_info'))
  assert.equal((await post('/api/tools/invoke', { name: 'workspace_get_info', input: {} })).status, 400)
})
