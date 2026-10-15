import { reactive, ref, watch } from 'vue'
import { apiJson } from '../services/api.js'
import { getOwnerContext } from '../services/context.js'

const defaults = () => ({ provider: 'openai-compatible', baseUrl: '', apiKey: '', model: '', temperature: 0.2 })
export const settings = reactive(defaults())
export const layout = reactive({ aiVisible: true, aiWidth: 350 })
export const prefsError = ref('')
let ownerKey = '', hydrating = false, timer, chain = Promise.resolve()
export function loadOwnerSettings(key, prefs) {
  hydrating = true; ownerKey = key
  Object.assign(settings, defaults(), prefs.ai || {}, { apiKey: localStorage.getItem(`workhub.ai-key:${key}`) || '' })
  Object.assign(layout, { aiVisible: true, aiWidth: 350 }, prefs.layout || {})
  prefsError.value = ''; hydrating = false
}
export function clearOwnerSettings() {
  clearTimeout(timer); hydrating = true; ownerKey = ''
  Object.assign(settings, defaults()); Object.assign(layout, { aiVisible: true, aiWidth: 350 })
  prefsError.value = ''; hydrating = false
}
export async function flushOwnerSettings() {
  clearTimeout(timer)
  const key = ownerKey
  if (!key || hydrating) return
  const { apiKey, ...ai } = settings
  const prefs = { ai: { ...ai }, layout: { ...layout } }
  const job = chain.then(async () => {
    if (key !== getOwnerContext()) return
    try { await apiJson('/api/prefs/save', { prefs }); if (key === getOwnerContext()) prefsError.value = '' }
    catch (error) { if (key === getOwnerContext()) prefsError.value = `偏好保存失败：${error.message}`; throw error }
  })
  chain = job.catch(() => {})
  return job
}
function schedule() {
  if (!ownerKey || hydrating) return
  localStorage.setItem(`workhub.ai-key:${ownerKey}`, settings.apiKey)
  clearTimeout(timer); timer = setTimeout(() => flushOwnerSettings().catch(() => {}), 400)
}
watch(settings, schedule, { deep: true, flush: 'sync' })
watch(layout, schedule, { deep: true, flush: 'sync' })
export function aiReady() { return !!(settings.baseUrl.trim() && settings.apiKey.trim() && settings.model.trim()) }
