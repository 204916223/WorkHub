import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { validateMcpConfig } from './config.js'
import { extractOwner, findIdentityTool } from './identity.js'
import { LOGIN_ATTEMPTS, LOGIN_TIMEOUT_MS, ATTEMPT_TIMEOUT_MS, attemptDeadline, httpStatus, isCertificateError, isTransientError, waitForRetry, withSignal } from './retry.js'

const SAFE_ERRORS = new Set(['MCP 工具分页出现循环。', 'MCP 工具分页超出上限。', '指定的工具不是受支持的当前用户查询工具。', 'MCP 未提供当前用户查询工具，请检查 Teambition 配置。', 'MCP 未能确认当前用户，请检查 Token 是否有效。', '当前用户查询未返回有效的身份信息。', '当前用户查询缺少稳定的用户标识。', '当前用户标识格式无效。'])
function toolFailure(result) {
  if (!result?.isError) return
  const text = (result.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n')
  let data = result.structuredContent
  if (!data) { try { data = JSON.parse(text) } catch {} }
  const error = new Error(text)
  error.status = data?.status || data?.statusCode || data?.error?.status || data?.error?.statusCode
  if (/unauthorized|forbidden|invalid[ _-]?(?:token|credential)|token.{0,20}(?:expired|invalid)|凭证.{0,10}(?:无效|过期)/i.test(text)) error.status = error.status || 401
  if (httpStatus(error) || isTransientError(error)) throw error
  throw new Error('MCP 未能确认当前用户，请检查 Token 是否有效。')
}
function publicFailure(error, stage, attempt) {
  const status = httpStatus(error)
  if (isCertificateError(error)) return new Error('MCP 服务的 TLS 证书验证失败，请检查服务器的证书信任和网络代理。')
  if ([401, 403].includes(status)) return new Error('Teambition MCP 凭证无效、已过期或无权限，请重新获取个人 MCP 配置。')
  if (SAFE_ERRORS.has(error.message)) return error
  if (status === 404) return new Error('MCP 服务或会话不存在，请确认官方 MCP 地址后重新验证。')
  if (isTransientError(error)) return new Error(`MCP ${stage}时网络异常或超时，已尝试 ${attempt} 次，请稍后点击“重新验证”。`)
  // Upstream errors may contain the full credential-bearing URL: never expose raw messages.
  return new Error(`MCP ${stage}失败，请检查服务地址、Token 和网络连接后重新验证。`)
}

export async function verifyTeambitionIdentity({ config, identity = {} }, {
  signal = AbortSignal.timeout(LOGIN_TIMEOUT_MS), clientFactory = () => new Client({ name: 'workhub', version: '0.1.0' }),
  trustedOrigin = 'https://open.teambition.com', attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, retryDelayMs = 250,
} = {}) {
  validateMcpConfig(config)
  const candidates = Object.entries(config.mcp.servers).filter(([id, server]) => (!identity.serverId || id === identity.serverId) && new URL(server.url).origin === trustedOrigin && new URL(server.url).pathname === '/api/mcp')
  if (candidates.length !== 1) throw new Error('请提供一个 Teambition 官方 MCP 身份服务；有多个时请在高级选项指定身份服务。')
  const [serverId, server] = candidates[0]
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
    signal.throwIfAborted()
    const deadline = attemptDeadline(signal, attemptTimeoutMs), client = clientFactory()
    let stage = '连接服务', failure, failedStage
    try {
      return await withSignal(async () => {
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers || {}, redirect: 'error' } }), { signal: deadline.signal })
        deadline.signal.throwIfAborted(); stage = '读取工具清单'
        const tools = [], seen = new Set()
        let cursor
        do {
          const result = await client.listTools(cursor ? { cursor } : undefined, { signal: deadline.signal })
          deadline.signal.throwIfAborted()
          tools.push(...(result.tools || [])); cursor = result.nextCursor
          if (cursor && seen.has(cursor)) throw new Error('MCP 工具分页出现循环。')
          if (cursor) seen.add(cursor)
          if (seen.size > 30) throw new Error('MCP 工具分页超出上限。')
        } while (cursor)
        const tool = findIdentityTool(tools, identity.toolName)
        stage = '查询当前用户'
        const result = await client.callTool({ name: tool.name, arguments: {} }, undefined, { signal: deadline.signal })
        deadline.signal.throwIfAborted(); toolFailure(result)
        const owner = extractOwner(result)
        return { owner, connector: { id: 'teambition', name: 'Teambition', serverId, toolName: tool.name, toolCount: tools.length, verifiedAt: new Date().toISOString() } }
      }, deadline.signal)
    } catch (error) { failure = error; failedStage = stage }
    finally { deadline.dispose(); await client.close().catch(() => {}) }
    signal.throwIfAborted()
    const retry = isTransientError(failure) || (httpStatus(failure) === 404 && failedStage !== '连接服务')
    if (!retry || attempt === LOGIN_ATTEMPTS) throw publicFailure(failure, failedStage, attempt)
    await waitForRetry(retryDelayMs * attempt, signal)
  }
}
