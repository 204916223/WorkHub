import PluginsView from './PluginsView.vue'
import ActivityView from './ActivityView.vue'
import ResourcesView from './ResourcesView.vue'
import SettingsView from './SettingsView.vue'
import { pluginViews } from '../../../plugins/web-registry.js'

export const hostViews = [
  { id: 'host.plugins', title: '插件管理', subtitle: 'Plugins', description: '查看已安装插件、管理启停状态，并了解插件提供的工具。', category: '中控管理', icon: 'puzzle', iconAsset: '关联', color: 'purple', component: PluginsView, info: { summary: '列出当前工作区注册的插件和 AI 工具，并管理插件启停。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '工作区 API', text: '读取插件与工具快照。', code: 'GET /api/workspace' }, { label: 'AI 工具', text: '插件状态变更由统一工具执行。', code: 'host_set_plugin_enabled' }] },
    { title: '数据字段', icon: '映', items: ['插件名称、版本、描述、ID 和生命周期状态来自插件 manifest 与运行时。', '工具名称、描述和读写效果来自当前 AI 工具注册表。'] },
    { title: '规则与限制', icon: '规', items: ['停用插件会回收它注册的页面、工具及资源；再次启用会重新注册。', '启停属于写操作，需要用户确认；状态更新后持久化到当前用户工作区。', '插件目录展示当前服务端已注册的插件，不代表所有可开发或计划中的插件。'] },
    { title: '防呆说明', icon: '!', items: ['切换插件前会展示确认弹窗；失败时状态不会标记为成功，并通过工作区错误提示反馈。'] },
  ] } },
  { id: 'host.activity', title: '运行记录', subtitle: 'Activity', description: '追踪工作助理和插件的工具调用、操作确认与执行结果。', category: '运行与监控', icon: 'list', iconAsset: '信息-圈', color: 'blue', component: ActivityView, info: { summary: '查看当前用户工作区内最近的工具执行、操作审批和结果事件。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '工作区 API', text: '读取当前用户的事件记录。', code: 'GET /api/events' }, { label: '生成位置', text: '由 ToolExecutor 执行工具或创建审批时记录。', code: 'server/tools/executor.js' }] },
    { title: '字段说明', icon: '映', items: ['记录包含事件类型、工具名称、状态、说明和发生时间；执行完成后可能包含耗时。', '事件按时间倒序显示，最多保留最近 200 条。'] },
    { title: '规则与限制', icon: '规', items: ['这是操作审计摘要，不是完整模型对话记录，也不保存完整工具返回内容。', '待确认、完成、失败、取消和拒绝分别记录；服务重启后的待审批操作不会保留。'] },
    { title: '防呆说明', icon: '!', items: ['事件按 MCP 验证后的用户身份隔离；不支持通过页面参数读取其他用户记录。'] },
  ] } },
  { id: 'host.resources', title: '资源状态', subtitle: 'Resources', description: '查看工作区运行状态、可用工具数量和服务端资源。', category: '运行与监控', icon: 'activity', iconAsset: '全部', color: 'green', component: ResourcesView, info: { summary: '显示当前工作区、服务进程和工具运行状态的快照。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '工作区 API', text: '读取工作区资源快照。', code: 'GET /api/resources' }, { label: '计算位置', text: '由服务端进程内存、运行时和工具执行器提供。', code: 'WorkspaceRuntime.resources()' }] },
    { title: '字段说明', icon: '映', items: ['启用插件和工具数量来自当前工作区注册表。', '运行任务和待确认数来自当前进程中的执行状态。', '内存、Node 版本、平台和运行时间描述的是承载服务的 Node 进程。'] },
    { title: '规则与限制', icon: '规', items: ['页面每 5 秒轮询一次；数值是采样时快照，不是历史趋势。', '服务进程重启后，进程运行时间重新计数；内存数据不是单用户独占用量。'] },
    { title: '防呆说明', icon: '!', items: ['工作区级和进程级指标分开解释，避免将服务器总内存误认为当前用户专属资源。'] },
  ] } },
  { id: 'host.settings', gallery: false, title: '设置', subtitle: 'Settings', description: '管理模型偏好、工作台布局和当前登录身份。', category: '中控管理', icon: 'settings', color: 'amber', component: SettingsView, info: { summary: '管理当前浏览器的模型连接与布局偏好，并查看或退出当前验证身份。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '个人偏好 API', text: '保存非敏感模型配置。', code: '/api/prefs' }, { label: '浏览器本地存储', text: '保存 API 密钥、工作台布局和会话偏好。', code: 'localStorage' }, { label: '登录会话', text: '展示由 Teambition MCP 当前用户工具验证的身份。', code: 'host_get_current_user' }] },
    { title: '规则与限制', icon: '规', items: ['模型密钥只保存在当前浏览器，并在发起对话时发送；服务器不持久化该密钥。', 'MCP 配置默认不保存；选择记住后仅保存在当前浏览器。', '登录会话有效期为 12 小时，服务重启后需要重新验证。'] },
    { title: '防呆说明', icon: '!', items: ['退出登录会清理当前浏览器对应身份的会话状态；发现其他标签页切换用户时要求重新登录。', '模型配置在首次对话时验证；保存配置不代表模型服务已连通。'] },
  ] } },
]
export function availableViews(plugins) {
  return [...hostViews, ...plugins.filter((plugin) => plugin.state === 'active').flatMap((plugin) => (plugin.views || []).filter((view) => pluginViews[view.id]).map((view) => ({ ...view, pluginId: plugin.id, component: pluginViews[view.id] })))]
}
