<script setup>
import { computed, ref } from 'vue'
import { MCP_EXAMPLE, validateMcpConfig } from '../../../connectors/teambition/config.js'
import { buildTokenCommand, DEFAULT_YEARS, TB_MCP_CONFIG_URL } from '../../../connectors/teambition/token-command.js'
import { loginIdentity } from '../features/auth/useIdentity.js'
import AssetIcon from './AssetIcon.vue'
import { UiNumberStepper, UiScrollArea } from './ui/index.js'
const props = defineProps({ error: String })
const saved = localStorage.getItem('workhub.mcp-login') || ''
const source = ref(saved), remember = ref(!!saved), advanced = ref(false), example = ref(false)
const serverId = ref(''), toolName = ref(''), busy = ref(false), error = ref(''), attempted = ref(false)
const years = ref(DEFAULT_YEARS), tokenName = ref(''), showCommand = ref(false), copied = ref(false), selectHint = ref(false)
const mode = ref('login')
const tokenCommand = computed(() => buildTokenCommand({ years: Number(years.value), name: tokenName.value }))
async function copyCommand() {
  copied.value = false; selectHint.value = false
  const text = tokenCommand.value.command
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); copied.value = true; resetCopyState(); return } catch {}
  }
  // HTTP 局域网下 Clipboard API 不可用时，用隐藏文本框尝试兼容复制，不展开命令预览。
  const fallback = document.createElement('textarea')
  fallback.value = text; fallback.readOnly = true; fallback.tabIndex = -1; fallback.setAttribute('aria-hidden', 'true')
  Object.assign(fallback.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' })
  document.body.appendChild(fallback)
  fallback.select()
  try { if (document.execCommand?.('copy')) { copied.value = true; resetCopyState(); return } } catch {}
  finally { fallback.remove() }
  selectHint.value = true; resetCopyState()
}
let copyTimer
function resetCopyState() { clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = false; selectHint.value = false }, 5000) }
const validation = computed(() => { if (!source.value.trim()) return ''; try { const count = validateMcpConfig(JSON.parse(source.value)); return `已识别 ${count} 个 MCP 服务` } catch (reason) { return reason instanceof SyntaxError ? 'JSON 格式尚不完整' : reason.message } })
async function login() {
  error.value = ''; busy.value = true; attempted.value = true
  try {
    let config
    try { config = JSON.parse(source.value) } catch { throw new Error('请粘贴有效的 MCP JSON 配置。') }
    validateMcpConfig(config)
    await loginIdentity(config, { serverId: serverId.value.trim(), toolName: toolName.value.trim() }, remember.value)
  } catch (reason) { error.value = reason.message }
  finally { busy.value = false }
}
</script>
<template>
  <main class="login-screen"><section class="login-guide"><div class="login-brand"><span class="brand-mark">W</span><strong>WorkHub</strong></div><h1>连接你的工作身份</h1><p>通过 Teambition MCP 确认当前用户，进入自己的工作区。</p>
  <ol class="login-steps"><li>打开 <a :href="TB_MCP_CONFIG_URL" target="_blank" rel="noopener noreferrer">Teambition MCP 配置页面 <AssetIcon name="箭头-右" :size="12" /></a>，确认处于登录状态</li><li>切换到右侧「生成签发命令」，填写 Token 名称和有效期，复制命令</li><li>在配置页面按 F12 打开 Console，粘贴命令并回车（Chrome 首次粘贴需先输入 <code>allow pasting</code> 回车）</li><li>回到配置页面点「查看详情」，复制包含个人 Token 的 MCP JSON 配置</li><li>切换到右侧「登录」，粘贴配置并验证身份</li></ol><p class="login-note">个人会话、偏好、插件状态和运行记录按用户分别保存。AI 模型可在进入后配置。<br>Token 等同于你的 Teambition 身份，请勿分享。随时可在配置页面删除该 Token，删除后 WorkHub 会立即失效并提示重新粘贴。</p></section>
  <section class="login-panel"><div class="mode-switch" role="tablist" aria-label="登录方式"><button type="button" role="tab" :aria-selected="mode === 'login'" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button><button type="button" role="tab" :aria-selected="mode === 'token'" :class="{ active: mode === 'token' }" @click="mode = 'token'">生成签发命令</button></div>
    <UiScrollArea v-if="mode === 'login'" as="form" class="surface login-form" @submit.prevent="login"><h2>MCP 身份验证</h2><label for="mcp-json">MCP JSON 配置</label><textarea id="mcp-json" v-model="source" rows="10" spellcheck="false" autocomplete="off" placeholder="粘贴从 Teambition 复制的完整 MCP JSON" :disabled="busy" required /><small class="parse-status">{{ validation || '配置含个人凭证，请勿分享给其他人。' }}</small><label class="checkbox-label"><input v-model="remember" type="checkbox" :disabled="busy" />在此浏览器记住配置（含个人 Token）</label><div class="login-options"><button type="button" class="text-link" @click="advanced = !advanced">{{ advanced ? '收起高级选项' : '高级选项' }}</button><button type="button" class="text-link" @click="example = !example">配置示例</button></div><pre v-if="example">{{ JSON.stringify(MCP_EXAMPLE, null, 2) }}</pre><div v-if="advanced" class="advanced-fields"><label>身份服务名称<input v-model="serverId" placeholder="留空自动识别 Teambition" /></label><label>当前用户查询工具<input v-model="toolName" placeholder="留空自动识别 GetUsersMe" /></label></div><p v-if="busy" class="parse-status" role="status">正在连接 MCP 并确认身份。网络异常时会自动重试，最多尝试 3 次。</p><p v-if="error || props.error" class="error-banner" role="alert">{{ error || props.error }}</p><button class="primary login-submit" :disabled="busy || !source.trim()" type="submit">{{ busy ? '正在验证身份…' : attempted ? '重新验证' : '验证身份并进入' }}</button></UiScrollArea>
    <UiScrollArea v-else as="section" class="surface login-form token-guide"><h2>生成 Teambition 签发命令</h2><p class="token-intro">先生成个人 Token，再回到「登录」粘贴 MCP 配置。</p><div class="name-row"><label for="token-name">Token 名称</label><input id="token-name" v-model="tokenName" maxlength="40" spellcheck="false" :placeholder="tokenCommand.namePreview" /></div><div class="years-field"><div class="years-row"><label for="token-years">Token 有效期</label><UiNumberStepper id="token-years" v-model.number="years" class="years-stepper" :min="1" :step="1" suffix="年" aria-label="Token 有效期" /></div><button type="button" class="text-link years-reset" @click="years = DEFAULT_YEARS; tokenName = ''">重置</button></div><p class="expiry-line">到期 <strong>{{ tokenCommand.expiryText }}</strong> · 权限 <code>*</code>（读写全开）</p><p class="expiry-line">签发为 <strong>{{ tokenCommand.namePreview }}</strong></p><button type="button" class="text-link command-toggle" @click="showCommand = !showCommand">{{ showCommand ? '收起命令' : '查看命令内容' }}</button><p v-if="selectHint" class="copy-fallback-hint" role="status">自动复制失败，可点“查看命令内容”后手动复制。</p><UiScrollArea v-if="showCommand" class="token-command" axis="both">{{ tokenCommand.command }}</UiScrollArea><ul v-if="tokenCommand.warnings.length" class="warn-line"><li v-for="line in tokenCommand.warnings" :key="line">{{ line }}</li></ul><div class="guide-actions"><button type="button" class="primary" @click="copyCommand">{{ copied ? '已复制' : selectHint ? '重试复制签发命令' : '复制签发命令' }}</button></div></UiScrollArea>
  </section></main>
</template>
<style scoped>
.login-screen { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr) 470px; align-items: center; gap: 70px; max-width: 1040px; margin: auto; padding: 50px 35px; }
.login-brand { display: flex; align-items: center; gap: 10px; font-size: 23px; margin-bottom: 36px; }
h1 { font-size: 28px; margin-bottom: 18px; } p, li { color: #959eac; line-height: 1.9; font-size: 13px; } .login-steps { padding-left: 20px; margin: 25px 0; } .login-steps li { margin: 12px 0; } a { color: #79bdd3; } .login-note { padding-top: 24px; border-top: 1px solid var(--border); }
.login-panel { display: flex; flex-direction: column; width: 470px; max-width: 100%; height: min(600px, calc(100dvh - 40px)); min-width: 0; } .mode-switch { display: grid; grid-template-columns: 1fr 1fr; flex: 0 0 50px; gap: 3px; margin-bottom: 8px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); } .mode-switch button { min-height: 40px; border: 0; border-radius: 7px; color: var(--muted); background: transparent; cursor: pointer; font: inherit; } .mode-switch button.active { color: #d8d9dc; background: #242529; box-shadow: 0 0 0 1px var(--border); }
.login-form { flex: 1 1 auto; min-height: 0; padding: 30px; } h2 { font-size: 19px; margin-bottom: 25px; } label { display: block; font-size: 12px; color: #a2acbb; margin: 16px 0 9px; } textarea { font-family: monospace; font-size: 12px; min-height: 210px; resize: vertical; } .parse-status { display: block; margin: 10px 0 20px; font-size: 11px; color: #8393a7; } .checkbox-label { display: flex; align-items: center; gap: 8px; } .login-options { display: flex; justify-content: space-between; margin: 22px 0; } pre { overflow: auto; padding: 12px; background: #121418; border-radius: 5px; font-size: 11px; } .login-submit { width: 100%; min-height: 40px; margin-top: 16px; } .error-banner { margin-top: 16px; }
.token-guide { display: flex; flex-direction: column; margin: 0; } .token-intro { margin: -10px 0 20px; }
.name-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; } .name-row input { flex: 1; padding: 7px 10px; }
.name-row label, .years-row label { width: 78px; flex-shrink: 0; margin: 0; white-space: nowrap; }
.years-field { margin-bottom: 4px; } .years-row { display: flex; align-items: center; gap: 12px; } .years-stepper { flex: 1; } .years-reset { display: block; margin: 6px 0 0 auto; }
.expiry-line { margin-top: 12px; font-size: 12px; color: #959eac; } .expiry-line + .expiry-line { margin-top: 5px; } .expiry-line strong { color: #d8d9dc; font-weight: 600; } .expiry-line code { padding: 1px 5px; border-radius: 4px; background: #242529; color: #cfaa59; }
.warn-line { margin: 10px 0 0; padding-left: 18px; } .warn-line li { color: #cfaa59; font-size: 11px; line-height: 1.7; }
.command-toggle { display: block; margin: 8px 0 0 auto; } .copy-fallback-hint { margin-top: 8px; color: var(--muted); font-size: 11px; } .guide-actions { display: flex; align-items: center; margin-top: auto; padding-top: 22px; } .guide-actions .primary { width: 100%; min-height: 40px; }
.token-command { display: block; flex: 0 0 auto; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; margin-top: 14px; max-height: 200px; overflow: auto; white-space: pre; overflow-wrap: normal; padding: 12px; border-radius: 5px; background: #111214; color: #b5b9c3; font-size: 11px; }
code { padding: 1px 5px; border-radius: 4px; background: #242529; font-size: 11px; }
@media (max-width: 960px) { .login-screen { grid-template-columns: minmax(0, 1fr); gap: 25px; padding: 25px 18px; } .login-brand { margin-bottom: 20px; } .login-panel { grid-row: 2; width: 100%; } .login-steps { margin: 4px 0 0; } .login-note { margin: 0; padding-top: 16px; } .login-form { padding: 22px; } }
</style>
