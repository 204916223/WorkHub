import { reactive } from 'vue'
import { apiJson } from '../../services/api.js'
import { setOwnerContext } from '../../services/context.js'
import { clearOwnerSettings, loadOwnerSettings, flushOwnerSettings } from '../../state/settings.js'

export const identityState = reactive({ owner: null, connector: null, sessions: [] })
const flushers = new Set()
export function registerSessionFlush(flush) { flushers.add(flush); return () => flushers.delete(flush) }
export function forgetIdentity() {
  setOwnerContext(''); clearOwnerSettings()
  identityState.owner = null; identityState.connector = null; identityState.sessions = []
}
async function hydrate(status) {
  setOwnerContext(status.owner.key)
  const [sessions, prefs] = await Promise.all([apiJson('/api/sessions'), apiJson('/api/prefs')])
  loadOwnerSettings(status.owner.key, prefs.prefs)
  identityState.sessions = sessions.sessions; identityState.connector = status.connector; identityState.owner = status.owner
}
export async function restoreIdentity() {
  const status = await apiJson('/api/auth/status')
  if (status.authenticated) await hydrate(status)
  else forgetIdentity()
}
export async function loginIdentity(config, identity, remember) {
  forgetIdentity()
  const status = await apiJson('/api/auth/login', { config, identity })
  try { await hydrate(status) } catch (error) { forgetIdentity(); throw error }
  if (remember) localStorage.setItem('workhub.mcp-login', JSON.stringify(config, null, 2))
  else localStorage.removeItem('workhub.mcp-login')
}
export async function logoutIdentity() {
  await Promise.all([flushOwnerSettings(), ...[...flushers].map((flush) => flush())])
  await apiJson('/api/auth/logout', {})
  forgetIdentity()
}
