<script setup>
import { inject } from 'vue'
import HubIcon from '../components/HubIcon.vue'
const host = inject('host')
const labels = { active: '已启用', inactive: '已停用', failed: '启用失败', starting: '正在启用', stopping: '正在停用' }
</script>
<template><section v-for="plugin in host.plugins.value" :key="plugin.id" class="plugin-row surface"><span class="feature-icon blue"><HubIcon name="grid" /></span><div class="plugin-copy"><h3>{{ plugin.displayName }} <small>v{{ plugin.version }}</small></h3><p>{{ plugin.description }}</p><div class="chips"><span>{{ plugin.id }}</span><span>{{ labels[plugin.state] }}</span></div></div><button :class="plugin.state === 'active' ? '' : 'primary'" :disabled="host.busy.value" @click="host.invoke('host_set_plugin_enabled', { pluginId: plugin.id, enabled: plugin.state !== 'active' })">{{ plugin.state === 'active' ? '停用' : '启用' }}</button></section><section class="surface tool-catalog"><h3>当前可用工具 <span class="count">{{ host.tools.value.length }}</span></h3><div v-for="tool in host.tools.value" :key="tool.name" class="tool-row"><div><code>{{ tool.name }}</code><p>{{ tool.description }}</p></div><span class="chip">{{ tool.effect === 'write' ? '需确认' : '只读' }}</span></div></section></template>
