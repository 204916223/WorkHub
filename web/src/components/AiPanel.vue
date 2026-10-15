<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import HubIcon from './HubIcon.vue'
import AssetIcon from './AssetIcon.vue'
import { UiConfirmDialog } from './ui/index.js'
import { aiReady } from '../state/settings.js'

const props = defineProps({ chat: Object, activeTitle: String })
defineEmits(['settings'])
const input = ref(''), list = ref(null), activeTab = ref('assistant'), pendingDelete = ref(null)
const labels = { running: '执行中', done: '完成', failed: '失败', denied: '已拒绝' }
const history = computed(() => props.chat.history.value)
watch(() => JSON.stringify(props.chat.current.value?.messages), async () => { await nextTick(); if (list.value) list.value.scrollTop = list.value.scrollHeight })
watch(() => props.chat.selectedId.value, () => { input.value = '' })
async function submit() { const text = input.value; if (!text.trim()) return; input.value = ''; if (await props.chat.send(text) === false) input.value = text }
function keyboard(event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() } }
function newSession() { props.chat.newChat(); activeTab.value = 'assistant' }
function openSession(id) { props.chat.openSession(id); activeTab.value = 'assistant' }
function deleteSession(session) { pendingDelete.value = session }
function confirmDelete() { if (pendingDelete.value) props.chat.deleteSession(pendingDelete.value.id); pendingDelete.value = null }
function formatTime(session) {
  const at = Number(session.updatedAt || session.createdAt)
  if (!Number.isFinite(at)) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
}
defineExpose({ focus: () => list.value?.focus() })
</script>

<template>
  <aside class="ai-panel">
    <div class="assistant-toolbar">
      <button class="assistant-new-session" title="新建会话" aria-label="新建会话" :disabled="chat.busy.value" @click="newSession"><AssetIcon name="加" :size="16" /></button>
      <nav class="assistant-tabs" role="tablist" aria-label="工作助理视图">
      <button type="button" role="tab" :aria-selected="activeTab === 'assistant'" :class="{ active: activeTab === 'assistant' }" @click="activeTab = 'assistant'">工作助理</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'history'" :class="{ active: activeTab === 'history' }" @click="activeTab = 'history'">历史会话 <span>{{ history.length }}</span></button>
      </nav>
    </div>

    <div v-if="activeTab === 'assistant'" ref="list" class="message-list" aria-live="polite">
      <div v-if="!chat.current.value?.messages.length" class="chat-empty"><span class="assistant-mark"><HubIcon name="chat" :size="25" /></span><h3>有什么可以帮你？</h3><p>选择左侧功能，或直接描述你的任务。</p><button v-if="!aiReady()" class="text-link" @click="$emit('settings')">配置模型，开始对话 <AssetIcon name="箭头-右" :size="12" /></button></div>
      <article v-for="message in chat.current.value?.messages" :key="message.id" class="message" :class="message.role"><small>{{ message.role === 'user' ? '你' : 'WorkHub' }}</small><div v-if="message.content" class="message-content">{{ message.content }}</div><div v-if="message.steps?.length" class="tool-steps"><div v-for="(step, index) in message.steps" :key="index"><span :class="['step-dot', step.status]" /><span>{{ step.name }}</span><small>{{ labels[step.status] }}</small></div></div>
        <section v-if="message.approval" class="inline-approval"><strong>操作确认</strong><p>{{ message.approval.description }}</p><pre>{{ JSON.stringify(message.approval.input, null, 2) }}</pre><div v-if="message.approvalState === 'pending'" class="actions"><button :disabled="chat.busy.value" @click="chat.decide(message, false)">拒绝</button><button class="primary" :disabled="chat.busy.value" @click="chat.decide(message, true)">批准执行</button></div><small v-else>{{ message.approvalState === 'approved' ? '已批准' : message.approvalState === 'expired' ? '确认已失效，请重新发起操作' : '已拒绝' }}</small></section>
      </article>
      <p v-if="chat.saveError.value" class="error-banner">{{ chat.saveError.value }}</p><div v-if="chat.busy.value" class="chat-status"><span class="pulse" />{{ chat.status.value }}</div>
      <p v-if="chat.error.value" class="error-banner">{{ chat.error.value }} <button v-if="!aiReady()" class="text-link" @click="$emit('settings')">打开设置</button></p>
    </div>

    <section v-else class="history-view" aria-label="历史会话">
      <div class="history-heading"><h3>历史会话</h3><span>自动保存最近的对话</span></div>
      <div v-if="history.length" class="history-list">
        <article v-for="session in history" :key="session.id" class="history-row">
          <time>{{ formatTime(session) }}</time><strong :title="session.title">{{ session.title || '新对话' }}</strong>
          <div class="history-actions"><button type="button" class="history-open" @click="openSession(session.id)"><span>继续</span><AssetIcon name="箭头-右" :size="14" /></button><button type="button" class="icon-action history-delete" title="删除历史会话" :aria-label="`删除会话：${session.title || '新对话'}`" @click="deleteSession(session)"><AssetIcon name="删除" :size="15" /></button></div>
        </article>
      </div>
      <div v-else class="history-empty"><span class="assistant-mark"><AssetIcon name="信息-圈" :size="23" /></span><strong>还没有历史会话</strong><p>开始一段对话后，会自动保存在这里。</p></div>
    </section>

    <footer v-if="activeTab === 'assistant'" class="ai-footer">
      <div class="context-label"><span class="status-dot" />当前功能：{{ activeTitle || '功能首页' }}</div>
      <form class="assistant-composer" @submit.prevent="submit"><textarea v-model="input" aria-label="描述任务，输入问题" placeholder="描述任务，输入问题…" :disabled="chat.busy.value" @keydown="keyboard" /><small class="composer-hint">Enter 发送 · Shift + Enter 换行</small><button v-if="chat.busy.value" class="composer-send composer-stop" type="button" title="停止生成" aria-label="停止生成" @click="chat.stop">停止</button><button v-else class="primary composer-send" type="submit" :disabled="!input.trim()" aria-label="发送"><AssetIcon name="带尾箭头-上" :size="19" /></button></form>
    </footer>
  </aside>
  <UiConfirmDialog :open="!!pendingDelete" title="删除历史会话" :message="`确定删除“${pendingDelete?.title || '新对话'}”吗？删除后无法恢复。`" confirm-label="删除" @cancel="pendingDelete = null" @confirm="confirmDelete" />
</template>
