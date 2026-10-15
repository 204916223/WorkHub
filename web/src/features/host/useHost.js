import { computed, ref } from 'vue'
import { apiJson } from '../../services/api.js'

export function useHost() {
  const snapshot = ref({ plugins: [], tools: [] }), online = ref(false), error = ref(''), pending = ref(null), busy = ref(false), syncing = ref(false), lastSyncedAt = ref(null), taskSync = ref(null), revision = ref(0)
  async function refresh() {
    try {
      snapshot.value = await apiJson('/api/workspace')
      online.value = true; error.value = ''; revision.value++
      const local = await apiJson('/api/tasks?page=1&pageSize=1')
      if (local.syncState?.last_success_at) lastSyncedAt.value = new Date(local.syncState.last_success_at)
    }
    catch (reason) { online.value = false; error.value = reason.message }
  }
  async function syncTasks() {
    const result = await apiJson('/api/tasks/sync', {})
    taskSync.value = result
    if (result.status === 'success') lastSyncedAt.value = new Date(result.syncedAt)
    error.value = result.status === 'success' ? '' : '任务同步未完整完成，检查任务清单中的同步状态。'
    revision.value++
    return result
  }
  async function syncAll() {
    syncing.value = true
    try {
      snapshot.value = await apiJson('/api/workspace')
      online.value = true
      error.value = ''
      taskSync.value = await apiJson('/api/tasks/sync', {})
      if (taskSync.value.status === 'success') lastSyncedAt.value = new Date(taskSync.value.syncedAt)
      else error.value = '任务同步未完整完成，检查任务清单中的同步状态。'
      revision.value++
      return taskSync.value
    } catch (reason) {
      online.value = true
      error.value = reason.message
      throw reason
    } finally { syncing.value = false }
  }
  async function invoke(name, input = {}) {
    busy.value = true; error.value = ''
    try {
      const result = await apiJson('/api/tools/invoke', { name, input })
      if (result.approval) pending.value = result.approval
      else await refresh()
      return result.result
    } catch (reason) { error.value = reason.message }
    finally { busy.value = false }
  }
  async function decide(approved) {
    if (!pending.value) return
    busy.value = true; error.value = ''
    try { await apiJson('/api/approvals/decide', { id: pending.value.id, approved }); pending.value = null; await refresh() }
    catch (reason) { error.value = reason.message; pending.value = null }
    finally { busy.value = false }
  }
  return { snapshot, online, error, pending, busy, syncing, lastSyncedAt, taskSync, revision, refresh, syncTasks, syncAll, invoke, decide, plugins: computed(() => snapshot.value.plugins), tools: computed(() => snapshot.value.tools) }
}
