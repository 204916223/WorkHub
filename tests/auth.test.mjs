import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMcpAuth } from '../server/auth/mcp-auth.js'
import { createServer } from '../server/http/server.js'
import { UserStore } from '../server/storage/user-store.js'
import { WorkspacePool } from '../server/workspaces/runtime.js'

const owner = (id) => ({ key: `org:${id}`, id, orgId: 'org', displayName: id === 'alice' ? '陈凯伦' : '芦韩' })
const sample = [{ id: 'session-1', title: '个人对话', createdAt: 1, messages: [{ id: 'msg-1', role: 'user', content: '仅 Alice 可见' }] }]
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-auth-')), store = new UserStore(root), pool = new WorkspacePool(store)
  const auth = createMcpAuth({ verify: async ({ config }) => {
    if (!['alice', 'bob'].includes(config?.testCredential)) throw new Error('测试身份无效')
    const profile = owner(config.testCredential)
    await store.profile(profile)
    return { owner: profile, connector: { id: 'teambition', name: 'Teambition' } }
  }, ...options })
  const server = createServer(pool, root, auth)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.stop(); await rm(root, { recursive: true, force: true }) })
  const request = async (route, body, cookie, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() }
  }
  const login = async (id) => request('/api/auth/login', { config: { testCredential: id }, owner: owner('alice') })
  return { request, login, store, root }
}
test('MCP verified identity owns sessions and preferences, across logins and different users', async (t) => {
  const { request, login, store, root } = await fixture(t)
  assert.equal((await request('/api/workspace')).status, 401)
  assert.equal((await request('/api/auth/status')).data.authenticated, false)
  assert.equal((await request('/api/workspace', undefined, 'workhub_identity=forged')).status, 401)
  const alice = await login('alice'), bob = await login('bob')
  assert.equal(alice.data.owner.displayName, '陈凯伦'); assert.equal(bob.data.owner.id, 'bob')
  await request('/api/sessions/save', { sessions: sample, owner: owner('bob') }, alice.cookie, { 'x-workhub-workspace': 'org:bob' })
  const prefs = { ai: { provider: 'openai-compatible', baseUrl: 'https://model.test/v1', model: 'sample', temperature: 0.2, apiKey: 'must-not-persist' }, layout: { aiVisible: false, aiWidth: 440 }, config: { userToken: 'must-not-persist' } }
  await request('/api/prefs/save', { prefs }, alice.cookie)
  assert.deepEqual((await request('/api/sessions', undefined, bob.cookie)).data.sessions, [])
  assert.deepEqual((await request('/api/prefs', undefined, bob.cookie)).data.prefs, {})
  assert.equal((await request('/api/sessions/save', { sessions: sample }, bob.cookie, { 'x-workhub-owner': 'org:alice' })).status, 409)
  await request('/api/auth/logout', {}, alice.cookie)
  assert.equal((await request('/api/sessions', undefined, alice.cookie)).status, 401)
  const again = await login('alice')
  assert.equal((await request('/api/sessions', undefined, again.cookie)).data.sessions[0].messages[0].content, '仅 Alice 可见')
  const fresh = new UserStore(root)
  assert.equal((await fresh.prefs('org:alice')).layout.aiWidth, 440)
  assert.equal((await fresh.sessions('org:alice')).length, 1)
  assert.equal((await fresh.read('org:alice', 'profile.json', {})).id, 'alice')
  assert.ok(!(await readFile(store.file('org:alice', 'prefs.json'), 'utf8')).includes('must-not-persist'))
  const user = await request('/api/tools/invoke', { name: 'host_get_current_user', input: {} }, again.cookie)
  assert.equal(user.data.result.displayName, '陈凯伦')
})
test('expired identity cookie cannot access saved data', async (t) => {
  const { request, login } = await fixture(t, { ttlMs: 5 })
  const session = await login('alice')
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal((await request('/api/sessions', undefined, session.cookie)).status, 401)
})
test('storage rejects traversal, unsafe file names and invalid messages', async (t) => {
  const { store } = await fixture(t)
  for (const key of ['..', '../alice', 'org/alice', '']) await assert.rejects(store.sessions(key), /标识/)
  assert.throws(() => store.file('org:alice', '../secrets'), /文件/)
  await assert.rejects(store.saveSessions('org:alice', [{ ...sample[0], messages: [{ role: 'system', content: 'inject' }] }]), /消息/)
})
