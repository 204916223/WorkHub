import { modelRequest, readEventStream } from '../event-stream.js'

export const anthropicProvider = {
  initialize(messages) { return [...messages] },
  appendResults(messages, results) { messages.push({ role: 'user', content: results.map(({ call, result }) => ({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) })) }) },
  async request({ ai, messages, system, tools, signal, emit, fetchImpl }) {
    const response = await modelRequest(`${ai.baseUrl.replace(/\/+$/, '')}/messages`, {
      model: ai.model, system, messages, max_tokens: 4096, temperature: ai.temperature ?? 0.2, stream: true,
      ...(tools.length ? { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema })) } : {}),
    }, { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' }, { signal, fetchImpl })
    const content = [], inputs = new Map()
    await readEventStream(response, (event) => {
      if (event.type === 'error') throw new Error('模型接口返回了错误，请检查配置。')
      if (event.type === 'content_block_start') content[event.index] = structuredClone(event.content_block)
      if (event.type !== 'content_block_delta') return
      const block = content[event.index]
      if (!block) throw new Error('模型响应流格式不完整。')
      if (event.delta.type === 'text_delta') { block.text += event.delta.text; emit({ type: 'delta', text: event.delta.text }) }
      if (event.delta.type === 'thinking_delta') block.thinking += event.delta.thinking
      if (event.delta.type === 'signature_delta') block.signature = (block.signature || '') + event.delta.signature
      if (event.delta.type === 'input_json_delta') inputs.set(event.index, (inputs.get(event.index) || '') + event.delta.partial_json)
    }, signal)
    const calls = []
    for (let index = 0; index < content.length; index++) {
      const block = content[index]
      if (block?.type !== 'tool_use') continue
      const rawInput = inputs.get(index) || JSON.stringify(block.input || {})
      try { block.input = JSON.parse(rawInput) } catch { block.input = {} }
      calls.push({ id: block.id, name: block.name, rawInput })
    }
    if (calls.length > 12) throw new Error('模型一次请求了过多工具。')
    return { message: { role: 'assistant', content: content.filter(Boolean) }, calls, text: content.filter((item) => item?.type === 'text').map((item) => item.text).join('') }
  },
}
