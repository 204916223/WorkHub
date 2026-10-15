<script setup>
import { inject, onMounted, ref, watch } from 'vue'
import { apiJson } from '../../web/src/services/api.js'
const host = inject('host'), info = ref(null)
async function load() { info.value = await apiJson('/api/resources') }
onMounted(load); watch(host.revision, load)
</script>
<template><section v-if="info" class="surface detail-list"><h3>{{ info.name }} <span class="chip">v{{ info.version }}</span></h3><dl><dt>当前用户</dt><dd>{{ info.owner.displayName }}</dd><dt>用户 ID</dt><dd class="mono">{{ info.owner.id }}</dd><dt>启动时间</dt><dd>{{ new Date(info.startedAt).toLocaleString() }}</dd><dt>已启用插件</dt><dd>{{ info.activePlugins.join('、') || '无' }}</dd><dt>可用工具</dt><dd>{{ info.toolCount }} 个</dd></dl></section><section class="surface plugin-explanation"><h3>插件如何参与中控</h3><p>启用时，插件注册页面和工具；停用时，这些入口和资源一起回收。工作助理通过 <code>workspace_get_info</code> 获取与此页面相同的数据。</p></section></template>
