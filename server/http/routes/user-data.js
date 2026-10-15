import { body, json } from '../respond.js'

export async function userDataRoutes({ url, request, response, runtime }) {
  const store = runtime.store, id = runtime.id
  if (url.pathname === '/api/sessions' && request.method === 'GET') json(response, 200, { sessions: await store.sessions(id) })
  else if (url.pathname === '/api/sessions/save' && request.method === 'POST') json(response, 200, { sessions: await store.saveSessions(id, (await body(request)).sessions) })
  else if (url.pathname === '/api/prefs' && request.method === 'GET') json(response, 200, { prefs: await store.prefs(id) })
  else if (url.pathname === '/api/prefs/save' && request.method === 'POST') json(response, 200, { prefs: await store.savePrefs(id, (await body(request)).prefs) })
  else return false
  return true
}
