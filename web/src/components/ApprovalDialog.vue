<script setup>
import { computed } from 'vue'
defineProps({ approval: Object, busy: Boolean })
defineEmits(['decide'])
</script>
<template><div class="modal-backdrop"><section class="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title"><span class="eyebrow">操作确认</span><h2 id="approval-title">{{ approval.input.enabled ? '启用插件' : '停用插件' }}</h2><p>{{ approval.description }}</p><pre>{{ JSON.stringify(approval.input, null, 2) }}</pre><div class="actions"><button :disabled="busy" @click="$emit('decide', false)">取消</button><button class="primary" :disabled="busy" @click="$emit('decide', true)">确认执行</button></div></section></div></template>
