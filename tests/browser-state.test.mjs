import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick, ref } from 'vue'

const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) }
globalThis.window = new EventTarget()
const { restoreIdentity, loginIdentity, logoutIdentity, identityState, forgetIdentity } = await import('../web/src/features/auth/useIdentity.js')
const { settings, layout, prefsError } = await import('../web/src/state/settings.js')
const { useChat } = await import('../web/src/features/chat/useChat.js')
const { apiJson } = await import('../web/src/services/api.js')
const renderer = createRenderer({ createElement: () => ({}), createComment: () => ({}), createText: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
function mountChat() {
  let chat
  const host = { snapshot: ref({ pendingApprovals: [] }), async refresh() {} }
  const app = renderer.createApp({ setup() { chat = useChat(host, ref('')); return () => null } })
  app.mount({})
  return { chat, app }
}
test('browser loads verified personal sessions, flushes on logout, and separates model keys', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; forgetIdentity(); storage.clear() })
  let loggedIn = 'alice'
  const writes = [], data = {
    alice: { sessions: [{ id: 'alice-chat', title: 'Alice', createdAt: 1, messages: [{ id: 'a', role: 'assistant', content: 'Alice only', approvalState: 'pending', approval: { id: 'lost-on-restart' } }] }], prefs: { ai: { provider: 'openai-compatible', baseUrl: 'https://model.test/v1', model: 'alice-model', temperature: 0.2 }, layout: { aiVisible: false, aiWidth: 440 } } },
    bob: { sessions: [], prefs: {} },
  }
  storage.set('workhub.conversations', JSON.stringify([{ title: 'Unverified old data' }]))
  storage.set('workhub.ai', JSON.stringify({ apiKey: 'old-anonymous-key' }))
  storage.set('workhub.ai-key:org:alice', 'alice-key')
  const status = () => ({ authenticated: !!loggedIn, owner: loggedIn ? { key: `org:${loggedIn}`, id: loggedIn, displayName: loggedIn } : null, connector: { name: 'Teambition' } })
  globalThis.fetch = async (path, options) => {
    const body = options.body && JSON.parse(options.body)
    if (path === '/api/auth/status') return Response.json(status())
    if (path === '/api/auth/login') { loggedIn = body.config.user; return Response.json(status()) }
    if (path === '/api/auth/logout') { loggedIn = ''; return Response.json({ authenticated: false }) }
    assert.equal(options.headers['x-workhub-owner'], `org:${loggedIn}`)
    if (path === '/api/sessions') return Response.json({ sessions: data[loggedIn].sessions })
    if (path === '/api/prefs') return Response.json({ prefs: data[loggedIn].prefs })
    if (path === '/api/sessions/save') { writes.push({ owner: loggedIn, ...body }); data[loggedIn].sessions = body.sessions; return Response.json(body) }
    if (path === '/api/prefs/save') { writes.push({ owner: loggedIn, ...body }); data[loggedIn].prefs = body.prefs; return Response.json(body) }
    throw new Error(`Unexpected request ${path}`)
  }
  await restoreIdentity()
  assert.equal(identityState.owner.id, 'alice'); assert.equal(settings.model, 'alice-model'); assert.equal(settings.apiKey, 'alice-key'); assert.equal(layout.aiWidth, 440)
  const { app, chat } = mountChat(); t.after(() => app.unmount())
  assert.equal(chat.current.value.title, 'Alice')
  chat.expireMissingApprovals(); assert.equal(chat.current.value.messages[0].approvalState, 'expired')
  chat.current.value.messages.push({ id: 'user', role: 'user', content: 'Saved on logout' })
  settings.model = 'updated-model'; await nextTick()
  await logoutIdentity(); app.unmount()
  assert.equal(writes.find((item) => item.sessions).sessions[0].messages.at(-1).content, 'Saved on logout')
  assert.equal(writes.find((item) => item.prefs).prefs.ai.apiKey, undefined)
  assert.equal(settings.apiKey, '')
  await loginIdentity({ user: 'bob' }, {}, false)
  assert.equal(identityState.sessions.length, 0); assert.equal(settings.apiKey, ''); assert.equal(settings.model, ''); assert.equal(layout.aiWidth, 350)
  settings.apiKey = 'bob-key'; await logoutIdentity()
  await loginIdentity({ user: 'alice' }, {}, false)
  assert.equal(settings.apiKey, 'alice-key'); assert.equal(settings.model, 'updated-model')
  assert.equal(storage.get('workhub.ai-key:org:bob'), 'bob-key'); assert.equal(prefsError.value, '')
})
test('browser detects another tab changing identity before saving', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; forgetIdentity() })
  let event = false
  window.addEventListener('workhub:unauthorized', () => { event = true }, { once: true })
  globalThis.fetch = async () => Response.json({ error: '身份变化', code: 'identity-changed' }, { status: 409 })
  await assert.rejects(apiJson('/api/sessions/save', { sessions: [] }), /身份变化/)
  assert.equal(event, true)
})
