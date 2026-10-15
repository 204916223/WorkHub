export async function readEventStream(response, onEvent, signal) {
  if (!response.body) throw new Error('模型接口没有返回响应流。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  function consume(block) {
    const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    onEvent(JSON.parse(data))
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      buffer = (buffer + (done ? decoder.decode() : decoder.decode(value, { stream: true }))).replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2) }
      if (done) { if (buffer.trim()) consume(buffer); break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function modelRequest(url, body, headers, { signal, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  if (!response.ok) throw new Error(`模型接口请求失败（HTTP ${response.status}），请检查接口地址、密钥和模型名称。`)
  return response
}
