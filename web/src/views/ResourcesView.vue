<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { apiJson } from '../services/api.js'
const resources = ref(null), error = ref('')
let timer
async function load() { try { resources.value = await apiJson('/api/resources'); error.value = '' } catch (reason) { error.value = reason.message } }
onMounted(() => { load(); timer = setInterval(load, 5000) }); onBeforeUnmount(() => clearInterval(timer))
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
</script>
<template><p v-if="error" class="error-banner">{{ error }}</p><template v-if="resources"><div class="metric-grid"><section class="surface metric"><small>启用插件</small><strong>{{ resources.activePlugins.length }}</strong><span>当前工作区</span></section><section class="surface metric"><small>可用工具</small><strong>{{ resources.toolCount }}</strong><span>包含中控工具</span></section><section class="surface metric"><small>运行任务</small><strong>{{ resources.activeRuns }}</strong><span>{{ resources.pendingApprovals }} 个操作等待确认</span></section><section class="surface metric"><small>进程内存</small><strong>{{ mb(resources.memory.rss) }}</strong><span>服务端进程总量</span></section></div><section class="surface detail-list"><h3>运行环境</h3><dl><dt>Node.js</dt><dd>{{ resources.nodeVersion }}</dd><dt>平台</dt><dd>{{ resources.platform }}</dd><dt>服务运行时间</dt><dd>{{ Math.floor(resources.uptimeSeconds / 60) }} 分钟</dd><dt>工作区启动时间</dt><dd>{{ new Date(resources.startedAt).toLocaleString() }}</dd></dl></section></template></template>
