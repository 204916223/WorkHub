import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { settings, aiReady } from '../../state/settings.js'
import { chatStream, apiJson } from '../../services/api.js'
import { uuid } from '../../services/identity.js'

import { identityState, registerSessionFlush } from '../auth/useIdentity.js'
import { getOwnerContext } from '../../services/context.js'
function fresh() { return { id: uuid(), title: '新对话', messages: [], createdAt: Date.now() } }
export function useChat(host, activeView) {
  const ownerKey = getOwnerContext(), saved = JSON.parse(JSON.stringify(identityState.sessions))
  const blank = saved.find((session) => !session.messages?.length)
  const conversations = ref([...saved.filter((session) => session.messages?.length), ...(blank ? [blank] : saved.length ? [] : [fresh()])])
  const selectedId = ref(conversations.value[0].id), busy = ref(false), status = ref(''), error = ref('')
  const saveError = ref('')
  let controller, timer, chain = Promise.resolve()
  const history = computed(() => conversations.value.filter((session) => session.id !== selectedId.value && session.messages.length).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)))
  async function persist() {
    clearTimeout(timer)
    const sessions = JSON.parse(JSON.stringify(conversations.value))
    const job = chain.then(async () => {
      if (ownerKey !== getOwnerContext()) return
      try { await apiJson('/api/sessions/save', { sessions }); if (ownerKey === getOwnerContext()) saveError.value = '' }
      catch (reason) { if (ownerKey === getOwnerContext()) saveError.value = `会话保存失败：${reason.message}`; throw reason }
    })
    chain = job.catch(() => {})
    return job
  }
  const unregister = registerSessionFlush(async () => { stop(); await persist() })
  const current = computed(() => conversations.value.find((item) => item.id === selectedId.value))
  watch(conversations, () => { clearTimeout(timer); timer = setTimeout(() => persist().catch(() => {}), 600) }, { deep: true })
  function newChat() {
    if (busy.value) return
    if (!current.value?.messages.length) { error.value = ''; return }
    const item = conversations.value.find((session) => !session.messages.length)
    if (item) { selectedId.value = item.id; error.value = ''; return }
    conversations.value.unshift(fresh()); conversations.value = conversations.value.slice(0, 30); selectedId.value = conversations.value[0].id; error.value = ''
  }
  function openSession(id) { if (busy.value || !conversations.value.some((item) => item.id === id)) return; selectedId.value = id; error.value = '' }
  function deleteSession(id) {
    if (busy.value) return
    conversations.value = conversations.value.filter((item) => item.id !== id)
    if (!conversations.value.length) conversations.value.push(fresh())
    if (selectedId.value === id) selectedId.value = conversations.value.find((item) => item.messages.length)?.id || conversations.value[0].id
    error.value = ''
  }
  async function execute(assistant, payload) {
    busy.value = true; error.value = ''; status.value = '正在连接'
    controller = new AbortController()
    try {
      await chatStream({ ai: { ...settings }, activeView: activeView.value, ...payload }, controller.signal, (event) => {
        if (event.type === 'delta') assistant.content += event.text
        if (event.type === 'status') status.value = event.text
        if (event.type === 'tool') { assistant.steps ||= []; const step = assistant.steps.findLast((item) => item.name === event.name && item.status === 'running'); if (step) Object.assign(step, event); else assistant.steps.push(event) }
        if (event.type === 'approval') { assistant.approval = event.approval; assistant.approvalState = 'pending' }
      })
    } catch (reason) { error.value = controller.signal.aborted ? '已停止生成。' : reason.message }
    finally {
      const session = conversations.value.find((item) => item.messages.includes(assistant))
      if (session) session.updatedAt = Date.now()
      busy.value = false; status.value = ''; controller = null
      await persist().catch(() => {})
      if (ownerKey === getOwnerContext()) await host.refresh()
    }
  }
  async function send(text) {
    if (busy.value || !text.trim()) return
    if (!aiReady()) { error.value = '请先在设置中配置模型接口、密钥和模型名称。'; return false }
    if (current.value.messages.some((item) => item.approvalState === 'pending')) { error.value = '请先处理当前对话中等待确认的操作。'; return false }
    const history = current.value.messages.map(({ role, content }) => ({ role, content }))
    const user = { id: uuid(), role: 'user', content: text.trim() }
    if (!current.value.messages.length) current.value.title = text.trim().slice(0, 18)
    current.value.updatedAt = Date.now()
    current.value.messages.push(user)
    const assistant = { id: uuid(), role: 'assistant', content: '', steps: [] }
    current.value.messages.push(assistant)
    await execute(current.value.messages.at(-1), { messages: [...history, user] })
    return true
  }
  async function decide(message, approved) {
    if (busy.value || message.approvalState !== 'pending') return
    if (!aiReady()) { error.value = '请先恢复模型配置后完成确认。'; return }
    message.approvalState = approved ? 'approved' : 'denied'
    current.value.updatedAt = Date.now()
    await execute(message, { approval: { id: message.approval.id, approved } })
  }
  function stop() { controller?.abort() }
  function expireMissingApprovals() {
    const pending = new Set(host.snapshot.value.pendingApprovals || [])
    for (const conversation of conversations.value) for (const message of conversation.messages) if (message.approvalState === 'pending' && !pending.has(message.approval?.id)) message.approvalState = 'expired'
  }
  onBeforeUnmount(() => { stop(); clearTimeout(timer); unregister() })
  return { conversations, selectedId, current, history, busy, status, error, saveError, expireMissingApprovals, newChat, openSession, deleteSession, send, decide, stop }
}
