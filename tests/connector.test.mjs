import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyTeambitionIdentity } from '../connectors/teambition/verify.js'
import { extractOwner } from '../connectors/teambition/identity.js'
import { validateMcpConfig } from '../connectors/teambition/config.js'
const config = { mcp: { servers: { tb: { type: 'http', url: 'https://open.teambition.com/api/mcp?userToken=test-only' } } } }
test('connector queries the current user through paginated MCP tools and closes the client', async () => {
  let closed = 0, page = 0
  const verified = await verifyTeambitionIdentity({ config }, { clientFactory: () => ({
    async connect() {}, async listTools(args) { page++; if (!args) return { tools: [{ name: 'GetTask' }], nextCursor: 'next' }; assert.equal(args.cursor, 'next'); return { tools: [{ name: 'GetUsersMe' }] } },
    async callTool(args) { assert.equal(args.name, 'GetUsersMe'); assert.deepEqual(args.arguments, {}); return { content: [{ type: 'text', text: JSON.stringify({ data: { _id: 'user-1', orgId: 'org-1', name: '陈凯伦', email: 'sample@example.test' } }) }] } }, async close() { closed++ },
  }) })
  assert.equal(verified.owner.key, 'org-1:user-1'); assert.equal(verified.owner.displayName, '陈凯伦')
  assert.equal(verified.connector.toolCount, 2); assert.equal(page, 2); assert.equal(closed, 1)
  assert.ok(!JSON.stringify(verified).includes('test-only'))
})
test('untrusted endpoints cannot supply another user identity', async () => {
  let connected = false
  await assert.rejects(verifyTeambitionIdentity({ config: { mcp: { servers: { fake: { type: 'http', url: 'http://127.0.0.1:3000/api/mcp' } } } } }, { clientFactory: () => { connected = true } }), /官方/)
  assert.equal(connected, false)
})
test('transport errors are sanitized and client closes on failure', async () => {
  let closed = false
  await assert.rejects(verifyTeambitionIdentity({ config }, { clientFactory: () => ({ async connect() { throw new Error('当前用户 https://open.teambition.com/api/mcp?userToken=secret-token') }, async close() { closed = true } }) }), (error) => !error.message.includes('secret-token') && /失败/.test(error.message))
  assert.equal(closed, true)
})
test('identity requires a stable ID and a supported current-user tool', async () => {
  assert.throws(() => extractOwner({ structuredContent: { name: 'Alice' } }), /标识/)
  assert.throws(() => extractOwner({ isError: true, content: [{ type: 'text', text: 'Token failure' }] }), /未能确认/)
  assert.throws(() => extractOwner({ structuredContent: { id: '../alice' } }), /格式/)
  assert.throws(() => validateMcpConfig({ mcp: { servers: { tb: { type: 'http', url: 'https://open.teambition.com/api/mcp?userToken=YOUR_USER_TOKEN' } } } }), /占位/)
  await assert.rejects(verifyTeambitionIdentity({ config, identity: { toolName: 'GetTask' } }, { clientFactory: () => ({ async connect() {}, async listTools() { return { tools: [{ name: 'GetTask' }] } }, async close() {} }) }), /不是受支持/)
})

test('real SDK transport retries HTTP 503 with a fresh connection and queries identity', async (t) => {
  const { createServer } = await import('node:http')
  const calls = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    let text = ''; for await (const chunk of request) text += chunk
    const rpc = JSON.parse(text); calls.push(rpc.method)
    if (calls.length === 1) { response.writeHead(503); response.end('Temporary upstream failure'); return }
    if (rpc.id === undefined) { response.writeHead(202); response.end(); return }
    let result
    if (rpc.method === 'initialize') result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-mcp-fixture', version: '1.0.0' } }
    else if (rpc.method === 'tools/list') result = { tools: [{ name: 'GetUsersMe', description: 'Current user', inputSchema: { type: 'object' } }] }
    else if (rpc.method === 'tools/call') { assert.equal(rpc.params.name, 'GetUsersMe'); result = { content: [{ type: 'text', text: JSON.stringify({ data: { _id: 'verified-user', name: '本地测试用户' } }) }] } }
    else throw new Error(`Unexpected MCP method ${rpc.method}`)
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const result = await verifyTeambitionIdentity({ config: { mcp: { servers: { test: { type: 'http', url: `${origin}/api/mcp?userToken=test-only` } } } } }, { trustedOrigin: origin, retryDelayMs: 0 })
  assert.equal(result.owner.id, 'verified-user')
  assert.equal(result.owner.displayName, '本地测试用户')
  assert.deepEqual(calls, ['initialize', 'initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
})
