import http from 'node:http'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { json } from './respond.js'
import { workspaceRoutes } from './routes/workspace.js'
import { toolRoutes } from './routes/tools.js'
import { chatRoute } from './routes/chat.js'
import { createMcpAuth } from '../auth/mcp-auth.js'
import { userDataRoutes } from './routes/user-data.js'
import { taskRoutes } from './routes/tasks.js'
import { worktimeRoutes } from './routes/worktime.js'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
export function createServer(pool, staticRoot, auth = createMcpAuth()) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/api/health') return json(response, 200, { name: 'WorkHub', version: '0.1.0', ok: true })
      if (url.pathname.startsWith('/api/')) {
        const origin = request.headers.origin
        if (origin && new URL(origin).host !== request.headers.host) return json(response, 403, { error: '请求来源与当前应用不一致。' })
        if (await auth.route(url, request, response)) return
        const session = auth.session(request)
        if (!session) return json(response, 401, { error: '请先通过 MCP 验证身份并登录。' })
        const expectedOwner = request.headers['x-workhub-owner']
        if (expectedOwner && expectedOwner !== session.owner.key) return json(response, 409, { error: '登录用户已发生变化，请重新加载个人工作区。', code: 'identity-changed' })
        const runtime = await pool.get(session.owner)
        const context = { url, request, response, runtime, session }
        for (const route of [workspaceRoutes, toolRoutes, userDataRoutes, chatRoute, taskRoutes, worktimeRoutes]) if (await route(context)) return
        return json(response, 404, { error: '接口不存在。' })
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: '请求方法不支持。' })
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = path.resolve(staticRoot, relative || 'index.html')
      if (file !== staticRoot && !file.startsWith(`${staticRoot}${path.sep}`)) return json(response, 403, { error: '路径无效。' })
      let content
      try { content = await readFile(file) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (path.extname(relative)) return json(response, 404, { error: '资源不存在。' })
        content = await readFile(path.join(staticRoot, 'index.html'))
      }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch (error) {
      if (response.headersSent) response.end()
      else json(response, 400, { error: error.code === 'ENOENT' ? '请先执行 npm run build。' : error.message })
    }
  })
}
