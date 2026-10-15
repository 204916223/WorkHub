export const MCP_EXAMPLE = {
  mcp: { servers: { 'teambition-mcp': { type: 'http', url: 'https://open.teambition.com/api/mcp?userToken=YOUR_USER_TOKEN' } } },
}

export function validateMcpConfig(config) {
  const servers = config?.mcp?.servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers) || !Object.keys(servers).length) throw new Error('请提供包含 mcp.servers 的 MCP JSON 配置。')
  if (Object.keys(servers).length > 10) throw new Error('最多配置 10 个 MCP 服务。')
  for (const server of Object.values(servers)) {
    if (!server || !['http', 'streamable-http'].includes(server.type)) throw new Error('目前支持 HTTP 类型的 MCP 服务。')
    let url
    try { url = new URL(server.url) } catch { throw new Error('MCP 服务地址无效。') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('MCP 服务地址必须为 HTTP 或 HTTPS。')
    let decoded
    try { decoded = decodeURIComponent(url.href) } catch { throw new Error('MCP 服务地址编码无效。') }
    if (/YOUR_|PLACEHOLDER|\$\{|<[^>]*(?:token|key)/i.test(decoded)) throw new Error('请将配置中的占位 Token 替换为真实凭证。')
    if (server.headers && (typeof server.headers !== 'object' || Array.isArray(server.headers) || Object.values(server.headers).some((value) => typeof value !== 'string'))) throw new Error('MCP 请求头格式无效。')
  }
  return Object.keys(servers).length
}
