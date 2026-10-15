import { json } from '../respond.js'

export async function workspaceRoutes({ url, request, response, runtime }) {
  if (request.method !== 'GET') return false
  if (url.pathname === '/api/workspace') json(response, 200, runtime.describe())
  else if (url.pathname === '/api/resources') json(response, 200, runtime.resources())
  else if (url.pathname === '/api/events') json(response, 200, { events: await runtime.events() })
  else return false
  return true
}
