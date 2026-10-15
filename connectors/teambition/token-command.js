// 签发命令生成器。Teambition 的 user-mcp 签发接口只认 open.teambition.com 的登录
// Cookie（Secure/SameSite + CORS 预检），WorkHub 后端与本页都拿不到，因此只能把命令
// 交给用户、由 TA 在配置页的 Console 里自己执行。这里只负责把「年限」翻译成一段可读命令。
export const TB_MCP_CONFIG_URL = 'https://open.teambition.com/user-mcp'
export const DEFAULT_ORG = { id: '613f0dacd4147ebbe9283b8f', name: '杭州迦智科技有限公司' }
export const DEFAULT_YEARS = 1
export const SUGGESTED_MAX_YEARS = 20

const DAYS_PER_YEAR = 365
const MAX_NAME_LENGTH = 40

export function normalizeYears(input) {
  const years = Number(input)
  if (!Number.isFinite(years) || years <= 0) return { years: DEFAULT_YEARS, valid: false }
  return { years, valid: true }
}

// 名称只用于 TB 的 Token 列表认领，不做鉴权含义；这里负责清洗 + 截断，避免撑爆生成命令。
export function normalizeName(input) {
  const cleaned = String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return { name: cleaned, valid: cleaned.length > 0 }
}

// TB 服务端把 expired 当作「秒」直接加到签发时间上，且不校验上限。
export function secondsOf(years) { return Math.round(years * DAYS_PER_YEAR * 24 * 60 * 60) }

export function expiryOf(years, from = new Date()) { return new Date(from.getTime() + secondsOf(years) * 1000) }

export function formatExpiry(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function buildTokenCommand({ years = DEFAULT_YEARS, name = '', orgId = DEFAULT_ORG.id, from = new Date() } = {}) {
  const safe = normalizeYears(years)
  const seconds = secondsOf(safe.years)
  const expiredAt = expiryOf(safe.years, from)
  const named = normalizeName(name)
  const warnings = []
  if (!safe.valid) warnings.push(`有效期需为大于 0 的年数，已按 ${DEFAULT_YEARS} 年生成。`)
  if (safe.years > SUGGESTED_MAX_YEARS) warnings.push(`${safe.years} 年相当于一把长期全权限钥匙，建议不超过 ${SUGGESTED_MAX_YEARS} 年，到期重新粘贴一次即可完成权限复核。`)

  const pad = (value) => String(value).padStart(2, '0')
  const ym = `${from.getFullYear()}${pad(from.getMonth() + 1)}`
  const preview = named.valid ? named.name : `wh:<你的姓名>:${ym}`

  const command = [
    '(async () => {',
    `  const YEARS = ${safe.years};                                  // Token 有效期（年）`,
    `  const NAME = ${JSON.stringify(named.name)};              // Token 名称，留空则按「工具:姓名:年月」自动命名`,
    `  const PREFERRED_ORG = ${JSON.stringify(String(orgId))};   // 默认企业：${DEFAULT_ORG.name}`,
    "  const opt = { credentials: 'include' };",
    "  const me = (await fetch('https://www.teambition.com/api/users/me', opt).then((r) => r.json()));",
    "  const orgs = (await fetch('https://www.teambition.com/api/v2/organizations', opt).then((r) => r.json())).result || [];",
    '  if (!orgs.length) return console.error(\'未取到企业列表，请确认已登录 Teambition。\');',
    '  const org = orgs.find((o) => o._id === PREFERRED_ORG) || orgs[0];',
    '  const now = new Date();',
    '  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, \'0\')}`;',
    '  const name = NAME || `wh:${(me.result || me).name}:${ym}`;   // 命名规范：工具:姓名:年月，便于日后认领与单独撤销',
    '  const expired = Math.round(YEARS * 365 * 24 * 60 * 60);        // TB 按秒累加，不校验上限',
    `  const res = await fetch(\`https://open.teambition.com/api/v1/developer/organization/\${org._id}/mcp/userTokens\`, {`,
    "    method: 'POST', credentials: 'include',",
    "    headers: { 'content-type': 'application/json' },",
    "    body: JSON.stringify({ name, expired, scopes: ['*'] }),",
    '  });',
    '  const data = await res.json().catch(() => null);',
    "  if (!res.ok) return console.error('创建失败', res.status, data);",
    '  const until = new Date(Date.now() + expired * 1000);',
    '  console.log(`企业：${org.name}\\nToken：${name}\\n到期：${until.toLocaleString(\'zh-CN\')}\\n权限：*（读写全开）`);',
    "  console.log(JSON.stringify(data, null, 2));",
    '  console.log(\'刷新配置页面即可看到新 Token，点「查看详情」复制 MCP JSON 粘回 WorkHub。\');',
    '})();',
  ].join('\n')

  return { command, years: safe.years, seconds, expiredAt, expiryText: formatExpiry(expiredAt), tokenName: named.name, namePreview: preview, warnings }
}
