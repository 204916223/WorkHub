const USER_TOOLS = new Set(['getusersme', 'get_current_user', 'get_current_user_info', 'get_authenticated_user', 'get_me', 'whoami'])
export function findIdentityTool(tools, requested = '') {
  if (requested) {
    const item = tools.find((tool) => tool.name.toLowerCase() === requested.toLowerCase())
    if (!item || !USER_TOOLS.has(item.name.toLowerCase())) throw new Error('指定的工具不是受支持的当前用户查询工具。')
    return item
  }
  const item = tools.find((tool) => USER_TOOLS.has(tool.name.toLowerCase()))
  if (!item) throw new Error('MCP 未提供当前用户查询工具，请检查 Teambition 配置。')
  return item
}

function unwrap(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return null
  if (Array.isArray(value)) { for (const item of value) { const found = unwrap(item, depth + 1); if (found) return found }; return null }
  for (const key of ['user', 'currentUser', 'data', 'result', 'profile']) { const nested = unwrap(value[key], depth + 1); if (nested) return nested }
  if (['id', '_id', 'userId', 'uid', 'accountId'].some((key) => typeof value[key] === 'string' || typeof value[key] === 'number')) return value
  return null
}
export function extractOwner(result) {
  if (result?.isError) throw new Error('MCP 未能确认当前用户，请检查 Token 是否有效。')
  let source = result?.structuredContent ?? result
  if (Array.isArray(result?.content)) {
    const text = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    if (text) { try { source = JSON.parse(text) } catch { if (!result.structuredContent) throw new Error('当前用户查询未返回有效的身份信息。') } }
  }
  if (typeof source === 'string') { try { source = JSON.parse(source) } catch { throw new Error('当前用户查询未返回有效的身份信息。') } }
  const user = unwrap(source)
  if (!user) throw new Error('当前用户查询缺少稳定的用户标识。')
  const pick = (keys) => keys.map((key) => user[key]).find((value) => ['string', 'number'].includes(typeof value) && String(value).trim())
  const id = String(pick(['id', '_id', 'userId', 'uid', 'accountId']) || '')
  const orgId = String(pick(['orgId', 'organizationId', 'companyId']) || '')
  const key = orgId ? `${orgId}:${id}` : id
  if (!/^[a-zA-Z0-9._:@-]{1,180}$/.test(key) || ['.', '..'].includes(key)) throw new Error('当前用户标识格式无效。')
  return {
    key, id, orgId,
    displayName: String(pick(['displayName', 'name', 'nickName', 'nickname', 'username']) || id).slice(0, 120),
    username: String(pick(['username', 'userName', 'login']) || '').slice(0, 120),
    email: String(pick(['email', 'mail']) || '').slice(0, 200),
  }
}
