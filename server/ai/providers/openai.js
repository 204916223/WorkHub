import { modelRequest, readEventStream } from '../event-stream.js'

export const openaiProvider = {
  initialize(messages, system) { return [{ role: 'system', content: system }, ...messages] },
  appendResults(messages, results) { for (const { call, result } of results) messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) }) },
  async request({ ai, messages, tools, signal, emit, fetchImpl }) {
    const response = await modelRequest(`${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      model: ai.model, messages, stream: true, temperature: ai.temperature ?? 0.2,
      ...(tools.length ? { tools: tools.map(({ name, description, inputSchema }) => ({ type: 'function', function: { name, description, parameters: inputSchema } })) } : {}),
    }, { Authorization: `Bearer ${ai.apiKey}` }, { signal, fetchImpl })
    const message = { role: 'assistant', content: '', tool_calls: [] }
    await readEventStream(response, (payload) => {
      if (payload.error) throw new Error('模型接口返回了错误，请检查配置。')
      const delta = payload.choices?.[0]?.delta || {}
      if (delta.content) { message.content += delta.content; emit({ type: 'delta', text: delta.content }) }
      if (delta.reasoning_content) message.reasoning_content = (message.reasoning_content || '') + delta.reasoning_content
      for (const item of delta.tool_calls || []) {
        const index = item.index ?? 0
        if (index > 11) throw new Error('模型一次请求了过多工具。')
        const call = message.tool_calls[index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } }
        if (item.id) call.id = item.id
        call.function.name += item.function?.name || ''
        call.function.arguments += item.function?.arguments || ''
      }
    }, signal)
    message.tool_calls = message.tool_calls.filter(Boolean)
    const calls = message.tool_calls.map((call) => ({ id: call.id, name: call.function.name, rawInput: call.function.arguments }))
    if (!calls.length) delete message.tool_calls
    return { message, calls, text: message.content }
  },
}
