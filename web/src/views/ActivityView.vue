<script setup>
import { inject, onMounted, ref, watch } from 'vue'
import { apiJson } from '../services/api.js'
const host = inject('host'), events = ref([]), error = ref('')
const labels = { done: '完成', failed: '失败', pending: '待确认', cancelled: '已停止', denied: '已拒绝' }
async function load() { try { events.value = (await apiJson('/api/events')).events; error.value = '' } catch (reason) { error.value = reason.message } }
onMounted(load); watch(host.revision, load)
</script>
<template><p v-if="error" class="error-banner">{{ error }}</p><div v-if="!events.length" class="empty-state surface">还没有运行记录，执行一次工具或开始一段对话后会显示在这里。</div><section v-else class="surface event-list"><article v-for="event in events" :key="event.id" class="event-row"><span :class="['step-dot', event.status]" /><div><strong>{{ event.name }}</strong><p>{{ event.detail }}</p></div><div class="event-meta"><span>{{ labels[event.status] || event.status }}</span><small>{{ new Date(event.at).toLocaleString('zh-CN', { hour12: false }) }}</small><small v-if="event.durationMs != null">{{ event.durationMs }} ms</small></div></article></section></template>
