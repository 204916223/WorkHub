import { randomBytes } from 'node:crypto'
import { verifyTeambitionIdentity } from '../../connectors/teambition/verify.js'
import { LOGIN_TIMEOUT_MS } from '../../connectors/teambition/retry.js'
import { body, json } from '../http/respond.js'

const COOKIE = 'workhub_identity='
export function createMcpAuth({ verify = verifyTeambitionIdentity, ttlMs = 12 * 60 * 60_000 } = {}) {
  const sessions = new Map(), attempts = new Map()
  function session(request) {
    const token = (request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(COOKIE))?.slice(COOKIE.length)
    const entry = token && sessions.get(token)
    if (!entry || entry.expiresAt <= Date.now()) { if (token) sessions.delete(token); return null }
    return entry
  }
  return {
    session,
    async route(url, request, response) {
      if (url.pathname === '/api/auth/status' && request.method === 'GET') {
        const entry = session(request)
        json(response, 200, { authenticated: !!entry, owner: entry?.owner || null, connector: entry?.connector || null }); return true
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        const token = (request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(COOKIE))?.slice(COOKIE.length)
        if (token) sessions.delete(token)
        response.setHeader('Set-Cookie', `${COOKIE}; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
        json(response, 200, { authenticated: false }); return true
      }
      if (url.pathname !== '/api/auth/login' || request.method !== 'POST') return false
      const now = Date.now(), remote = request.socket.remoteAddress
      for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key)
      const attempt = attempts.get(remote) || { count: 0, resetAt: now + 60_000 }
      if (attempt.count >= 8) { json(response, 429, { error: '验证次数过多，请一分钟后再试。' }); return true }
      attempt.count++; attempts.set(remote, attempt)
      const data = await body(request)
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(new DOMException('MCP login deadline exceeded', 'TimeoutError')), LOGIN_TIMEOUT_MS)
      const abort = () => { if (!response.writableEnded) controller.abort() }
      response.on('close', abort)
      let verified
      try { verified = await verify({ config: data.config, identity: data.identity }, { signal: controller.signal }) }
      catch (error) { if (controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError') throw new Error('MCP 身份验证超时，请稍后重新验证。'); throw error }
      finally { clearTimeout(timeout); response.off('close', abort) }
      controller.signal.throwIfAborted()
      if (!verified?.owner?.key || !verified.owner.id) throw new Error('身份验证未返回稳定的用户标识。')
      attempts.delete(remote)
      for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key)
      if (sessions.size >= 500) sessions.delete(sessions.keys().next().value)
      const token = randomBytes(32).toString('hex')
      // Persist neither MCP config nor credentials: only verified profile and connector summary.
      // Keep credentials in memory only so the authenticated user can explicitly sync data.
      // Never return or write this config to disk.
      sessions.set(token, { ...verified, mcpConfig: data.config, expiresAt: now + ttlMs })
      response.setHeader('Set-Cookie', `${COOKIE}${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlMs / 1000}`)
      json(response, 200, { authenticated: true, ...verified }); return true
    },
  }
}
