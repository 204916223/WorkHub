import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyTeambitionIdentity } from '../connectors/teambition/verify.js'
import { isTransientError, waitForRetry } from '../connectors/teambition/retry.js'

const config = { mcp: { servers: { tb: { type: 'http', url: 'https://open.teambition.com/api/mcp?userToken=test-only' } } } }
const identity = { content: [{ type: 'text', text: JSON.stringify({ id: 'verified-user', name: '测试用户' }) }] }
function client(patch = {}) { return { async connect() {}, async listTools() { return { tools: [{ name: 'GetUsersMe' }] } }, async callTool() { return identity }, async close() {}, ...patch } }
function networkError() { return Object.assign(new Error('fetch failed https://open.teambition.com/api/mcp?userToken=secret'), { cause: { code: 'ECONNRESET' } }) }
for (const phase of ['connect', 'listTools', 'callTool']) test(`login rebuilds connection after transient ${phase} failure`, async () => {
  let made = 0, closed = 0
  const order = []
  const result = await verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() {
    const attempt = ++made; order.push(`open${attempt}`)
    return client({ ...(attempt === 1 ? { async [phase]() { throw networkError() } } : {}), async close() { closed++; order.push(`close${attempt}`) } })
  } })
  assert.equal(result.owner.id, 'verified-user'); assert.equal(made, 2); assert.equal(closed, 2)
  assert.deepEqual(order, ['open1', 'close1', 'open2', 'close2'])
})
test('login stops after three failed attempts and never exposes credentials', async () => {
  let made = 0, closed = 0
  await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async connect() { throw networkError() }, async close() { closed++ } }) } }), (error) => /已尝试 3 次/.test(error.message) && !error.message.includes('secret'))
  assert.equal(made, 3); assert.equal(closed, 3)
})
test('HTTP auth failures stop immediately instead of repeating login', async () => {
  for (const code of [401, 403]) {
    let made = 0
    await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async connect() { throw Object.assign(networkError(), { code }) } }) } }), /凭证无效、已过期或无权限/)
    assert.equal(made, 1)
  }
})
test('MCP read failure reconnects for an expired session, but missing endpoint is permanent', async () => {
  let made = 0
  await verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { const attempt = ++made; return client({ async callTool() { if (attempt === 1) throw Object.assign(new Error('session gone'), { code: 404 }); return identity } }) } })
  assert.equal(made, 2)
  made = 0
  await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async connect() { throw Object.assign(new Error('endpoint gone'), { code: 404 }) } }) } }), /不存在/)
  assert.equal(made, 1)
})
test('current-user upstream errors retry but invalid-token results stop immediately', async () => {
  let made = 0
  await verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { const attempt = ++made; return client({ async callTool() { return attempt === 1 ? { isError: true, structuredContent: { status: 503 }, content: [{ type: 'text', text: 'upstream temporarily unavailable' }] } : identity } }) } })
  assert.equal(made, 2)
  made = 0
  await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async callTool() { return { isError: true, content: [{ type: 'text', text: 'InvalidToken: secret-token' }] } } }) } }), (error) => /凭证无效/.test(error.message) && !error.message.includes('secret-token'))
  assert.equal(made, 1)
})
test('per-attempt timeout closes a hanging client and allows later attempts', async () => {
  let made = 0, closed = 0
  const result = await verifyTeambitionIdentity({ config }, { retryDelayMs: 0, attemptTimeoutMs: 15, clientFactory() { const attempt = ++made; return client({ async connect() { if (attempt === 1) await new Promise(() => {}) }, async close() { closed++ } }) } })
  assert.equal(result.owner.id, 'verified-user'); assert.equal(made, 2); assert.equal(closed, 2)
})
test('aborting during verification or backoff never creates another client', async () => {
  const controller = new AbortController(); let made = 0, closed = 0
  const operation = verifyTeambitionIdentity({ config }, { signal: controller.signal, retryDelayMs: 1000, clientFactory() { made++; return client({ async connect() { throw networkError() }, async close() { closed++ } }) } })
  setTimeout(() => controller.abort(), 15)
  await assert.rejects(operation, { name: 'AbortError' })
  assert.equal(made, 1); assert.equal(closed, 1)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(waitForRetry(1, cancelled.signal), { name: 'AbortError' })
})
test('validation and identity format errors never trigger connection retries', async () => {
  let made = 0
  await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async callTool() { return { structuredContent: { name: 'no stable ID' } } } }) } }), /标识/)
  assert.equal(made, 1)
  assert.equal(isTransientError({ code: 403, message: 'fetch failed' }), false)
  assert.equal(isTransientError({ code: 503, message: 'unavailable' }), true)
})

test('cancellation interrupts a hanging verification and cleans up without retrying', async () => {
  const controller = new AbortController(); let made = 0, closed = 0
  const operation = verifyTeambitionIdentity({ config }, { signal: controller.signal, clientFactory() { made++; return client({ async connect() { await new Promise(() => {}) }, async close() { closed++ } }) } })
  setTimeout(() => controller.abort(), 15)
  await assert.rejects(operation, { name: 'AbortError' })
  assert.equal(made, 1); assert.equal(closed, 1)
})
test('certificate errors are reported safely without repeated attempts', async () => {
  let made = 0
  await assert.rejects(verifyTeambitionIdentity({ config }, { retryDelayMs: 0, clientFactory() { made++; return client({ async connect() { throw Object.assign(networkError(), { cause: { code: 'CERT_HAS_EXPIRED' } }) } }) } }), (error) => /证书验证失败/.test(error.message) && !error.message.includes('secret'))
  assert.equal(made, 1)
})
