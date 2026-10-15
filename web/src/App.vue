<script setup>
import { computed, onMounted, provide, ref, watch } from 'vue'
import HubIcon from './components/HubIcon.vue'
import AssetIcon from './components/AssetIcon.vue'
import ModuleLayout from './components/ModuleLayout.vue'
import WorkspaceSyncButton from './components/WorkspaceSyncButton.vue'
import ModuleGallery from './components/ModuleGallery.vue'
import { UiContextMenu } from './components/ui/index.js'
import AiPanel from './components/AiPanel.vue'
import ApprovalDialog from './components/ApprovalDialog.vue'
import { useHost } from './features/host/useHost.js'
import { useChat } from './features/chat/useChat.js'
import { usePanelResize } from './features/host/usePanelResize.js'
import { availableViews } from './views/registry.js'
import { layout, aiReady } from './state/settings.js'

const props = defineProps({ owner: { type: Object, required: true } })
const host = useHost(), activeId = ref(''), resize = usePanelResize()
const recentIds = ref([])
const recentStorageKey = computed(() => `workhub.recent-modules:${props.owner.id}`)
provide('host', host)
const views = computed(() => availableViews(host.plugins.value))
function openModule(id) {
  activeId.value = id
  if (id === 'host.settings') return
  const next = [id, ...recentIds.value.filter((item) => item !== id)].slice(0, 8)
  recentIds.value = next
  localStorage.setItem(recentStorageKey.value, JSON.stringify(next))
}
watch(recentStorageKey, (key) => {
  try { recentIds.value = JSON.parse(localStorage.getItem(key) || '[]').filter((id) => typeof id === 'string') }
  catch { recentIds.value = [] }
}, { immediate: true })
const active = computed(() => views.value.find((view) => view.id === activeId.value))
const chat = useChat(host, activeId)
const lastSyncTime = computed(() => host.lastSyncedAt.value ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(host.lastSyncedAt.value) : '尚未同步')
const lastSyncTitle = computed(() => host.lastSyncedAt.value ? `最近同步：${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(host.lastSyncedAt.value)}` : '尚未同步')
watch(views, () => { if (activeId.value && !active.value) activeId.value = '' })
onMounted(async () => { await host.refresh(); if (host.online.value) chat.expireMissingApprovals() })
function ask(text) { layout.aiVisible = true; if (!aiReady()) { activeId.value = 'host.settings'; chat.error.value = '配置模型后即可开始对话。' } else chat.send(text) }
async function syncAll() { try { await host.syncAll() } catch {} }
</script>
<template>
  <div class="app-shell" :style="{ '--ai-width': `${layout.aiWidth}px` }">
  <header class="topbar"><button class="brand" @click="activeId = ''"><strong>WorkHub</strong><span class="brand-user" :title="owner.displayName">{{ owner.displayName }}</span></button><div class="topbar-actions"><WorkspaceSyncButton :loading="host.syncing.value" :last-synced-at="host.lastSyncedAt.value" @refresh="syncAll" /><span class="sync-time" :title="lastSyncTitle">{{ lastSyncTime }}</span><button class="settings-button" aria-label="设置" title="设置" @click="activeId = 'host.settings'"><AssetIcon name="设置" :size="19" /></button><button v-if="!layout.aiVisible" class="panel-open" @click="layout.aiVisible = true"><HubIcon name="chat" :size="16" />工作助理</button></div></header>
    <div class="workspace-shell" :class="{ 'ai-hidden': !layout.aiVisible }">
      <main class="workspace">
        <template v-if="!active"><div class="workspace-content"><div v-if="host.error.value" class="error-banner" role="alert">{{ host.error.value }}<button @click="host.refresh">重试</button></div><ModuleGallery :modules="views.filter(view => view.gallery !== false)" :recent-ids="recentIds" @select="openModule" /></div></template>
        <ModuleLayout v-else :title="active.title" :info="active.info" @back="activeId = ''"><template #actions><component :is="active.headerActions" v-if="active.headerActions" /></template><div v-if="host.error.value" class="error-banner" role="alert">{{ host.error.value }}<button @click="host.refresh">重试</button></div><component :is="active.component" :key="active.id" /></ModuleLayout>
      </main>
      <div v-if="layout.aiVisible" class="panel-divider" role="separator" aria-label="调整助理宽度" aria-orientation="vertical" tabindex="0" @pointerdown="resize.start" @keydown.left.prevent="layout.aiWidth = Math.min(600, layout.aiWidth + 20)" @keydown.right.prevent="layout.aiWidth = Math.max(280, layout.aiWidth - 20)" />
      <AiPanel v-if="layout.aiVisible" :chat="chat" :active-title="active?.title" @settings="activeId = 'host.settings'" />
    </div>
    <UiContextMenu :can-go-back="!!active" @back="activeId = ''" @sync="syncAll" />
    <ApprovalDialog v-if="host.pending.value" :approval="host.pending.value" :busy="host.busy.value" @decide="host.decide" />
  </div>
</template>
