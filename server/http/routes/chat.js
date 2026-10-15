import { randomUUID } from 'node:crypto'
import { body } from '../respond.js'
import { runAgent, validateAi } from '../../ai/agent.js'

export async function chatRoute({ url, request, response, runtime }) {
  if (url.pathname !== '/api/chat' || request.method !== 'POST') return false
  const data = await body(request)
  validateAi(data.ai)
  if (data.approval && typeof data.approval.approved !== 'boolean') throw new Error('确认结果必须为布尔值。')
  const id = randomUUID(), controller = new AbortController()
  runtime.runs.set(id, controller)
  const abort = () => { if (!response.writableEnded) controller.abort() }
  response.on('close', abort)
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  const emit = (event) => { if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`) }
  try {
    const result = await runAgent({ runtime, ai: data.ai, messages: data.messages, approval: data.approval, activeView: data.activeView, signal: controller.signal, emit })
    await runtime.record({ type: 'chat', name: 'AI 对话', status: result.awaitingApproval ? 'pending' : 'done', detail: result.awaitingApproval ? '等待工具操作确认' : '对话完成' })
    emit({ type: 'end', ...result })
  } catch (error) {
    const message = String(error.message || '请求失败').split(data.ai.apiKey).join('[已隐藏]')
    await runtime.record({ type: 'chat', name: 'AI 对话', status: controller.signal.aborted ? 'cancelled' : 'failed', detail: controller.signal.aborted ? '已停止生成' : message })
    emit({ type: 'error', message })
  } finally {
    runtime.runs.delete(id)
    response.off('close', abort)
    response.end()
  }
  return true
}
