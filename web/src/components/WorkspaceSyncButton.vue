<script setup>
import { computed } from 'vue'
import AssetIcon from './AssetIcon.vue'

const props = defineProps({
  loading: { type: Boolean, default: false },
  lastSyncedAt: { type: [Date, String, Number], default: null },
})
defineEmits(['refresh'])

const lastSyncLabel = computed(() => {
  if (!props.lastSyncedAt) return '尚未同步'
  const date = new Date(props.lastSyncedAt)
  if (!Number.isFinite(date.getTime())) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
})
const title = computed(() => props.loading ? '正在同步任务数据' : `同步任务数据，最近同步：${lastSyncLabel.value}`)
</script>

<template>
  <button class="workspace-sync" type="button" :disabled="loading" :title="title" :aria-label="title" @click="$emit('refresh')">
    <span :class="{ spinning: loading }"><AssetIcon name="刷新" :size="15" /></span>
    <span>{{ loading ? '同步中' : '同步' }}</span>
  </button>
</template>
