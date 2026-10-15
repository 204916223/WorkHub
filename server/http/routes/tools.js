import { body, json } from '../respond.js'

export async function toolRoutes({ url, request, response, runtime }) {
  if (request.method !== 'POST') return false
  if (!['/api/tools/invoke', '/api/approvals/decide'].includes(url.pathname)) return false
  const data = await body(request)
  if (url.pathname === '/api/tools/invoke') json(response, 200, await runtime.executor.invoke(data.name, data.input ?? {}))
  else {
    if (typeof data.approved !== 'boolean') throw new Error('确认结果必须为布尔值。')
    if (runtime.executor.pending.get(data.id)?.continuation) throw new Error('请从原对话完成该确认。')
    const { result } = await runtime.executor.decide(data.id, data.approved)
    json(response, 200, { result })
  }
  return true
}
