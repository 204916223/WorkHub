import { getOwnerContext } from './context.js'
export async function api(path, body, options = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(getOwnerContext() ? { 'x-workhub-owner': getOwnerContext() } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options })
  if (!response.ok) { const data = await response.json().catch(() => ({})); if ((response.status === 401 && path !== '/api/auth/login') || data.code === 'identity-changed') window.dispatchEvent(new Event('workhub:unauthorized')); throw new Error(data.error || `请求失败（${response.status}）`) }
  return response
}
export async function apiJson(path, body) { return (await api(path, body)).json() }
export async function chatStream(body, signal, receive) {
  const response = await api('/api/chat', body, { signal })
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', ended = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer = (buffer + (done ? decoder.decode() : decoder.decode(value, { stream: true }))).replace(/\r\n/g, '\n')
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2)
        const text = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5)).join('\n')
        if (text) {
          const event = JSON.parse(text)
          if (event.type === 'error') throw new Error(event.message)
          if (event.type === 'end') ended = true
          receive(event)
        }
      }
      if (done) break
    }
    if (!ended) throw new Error('连接中断，请重新发起请求。')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
