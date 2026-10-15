import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runAgent } from '../server/ai/agent.js'
import { readEventStream } from '../server/ai/event-stream.js'
import { UserStore } from '../server/storage/user-store.js'
import { WorkspacePool } from '../server/workspaces/runtime.js'

const ai = { provider: 'openai-compatible', baseUrl: 'http://model.test/v1', apiKey: 'test-only', model: 'test' }
const signal = () => new AbortController().signal
function stream(events) { return new Response(events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('')) }
function openaiText(text) { return stream([{ choices: [{ delta: { content: text } }] }]) }
function openaiCall(name, input) { return stream([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name, arguments: JSON.stringify(input) } }] } }] }]) }
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'workhub-agent-')), pool = new WorkspacePool(new UserStore(root))
  t.after(async () => { await pool.stop(); await rm(root, { recursive: true, force: true }) })
  return pool.get(randomUUID())
}
test('OpenAI tool execution returns structured result to the model', async (t) => {
  const runtime = await fixture(t), requests = [], events = []
  await runAgent({ runtime, ai, signal: signal(), messages: [{ role: 'user', content: '查看工作区' }], emit: (event) => events.push(event), fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return requests.length === 1 ? openaiCall('workspace_get_info', {}) : openaiText('查询完成') } })
  const result = JSON.parse(requests[1].messages.at(-1).content)
  assert.equal(result.workspaceId, runtime.id)
  assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), '查询完成')
})
test('AI writes pause for approval, resume exact call, and remove disabled tools', async (t) => {
  const runtime = await fixture(t), events = []
  const first = await runAgent({ runtime, ai, signal: signal(), messages: [{ role: 'user', content: '停用插件' }], emit: (event) => events.push(event), fetchImpl: async () => openaiCall('host_set_plugin_enabled', { pluginId: 'workspace', enabled: false }) })
  assert.equal(first.awaitingApproval, true); assert.equal(runtime.manager.getState('workspace'), 'active')
  const pending = events.find((event) => event.type === 'approval').approval
  await runAgent({ runtime, ai, signal: signal(), approval: { id: pending.id, approved: true }, emit() {}, fetchImpl: async (_url, options) => { const request = JSON.parse(options.body); assert.ok(!request.tools.some((tool) => tool.function.name === 'workspace_get_info')); return openaiText('已停用') } })
  assert.equal(runtime.manager.getState('workspace'), 'inactive')
})
test('Anthropic streams tool blocks and sends proper tool results', async (t) => {
  const runtime = await fixture(t); let round = 0
  await runAgent({ runtime, ai: { ...ai, provider: 'anthropic-compatible' }, signal: signal(), messages: [{ role: 'user', content: '查看插件' }], emit() {}, fetchImpl: async (_url, options) => {
    if (++round === 1) return stream([{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'host_list_plugins', input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }])
    const last = JSON.parse(options.body).messages.at(-1)
    assert.equal(last.content[0].tool_use_id, 'tool-1')
    assert.equal(JSON.parse(last.content[0].content).plugins[0].id, 'workspace')
    return stream([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '查询完成' } }])
  } })
  assert.equal(round, 2)
})
test('event stream handles UTF-8 and CRLF split across chunks', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"中文"}\r\n\r\n'), values = []
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close() } }))
  await readEventStream(response, (event) => values.push(event), signal())
  assert.deepEqual(values, [{ text: '中文' }])
})
test('aborted agent never contacts the model', async (t) => {
  const runtime = await fixture(t), controller = new AbortController(); controller.abort()
  await assert.rejects(runAgent({ runtime, ai, signal: controller.signal, messages: [{ role: 'user', content: 'test' }], emit() {}, fetchImpl: async () => { throw Error('must not run') } }), { name: 'AbortError' })
})
