export const workspaceManifest = {
  id: 'workspace', version: '0.1.0', apiVersion: 1,
  displayName: '工作区信息', description: '查看当前工作区与中控运行状态。', defaultEnabled: true,
  capabilities: ['workspace.read'],
  views: [{ id: 'workspace.info', title: '工作区信息', subtitle: 'Workspace', description: '查看当前用户、启用插件、可用工具和中控启动状态。', category: '工作区', icon: 'grid', iconAsset: '信息', color: 'blue', info: { summary: '展示当前登录用户与 WorkHub 工作区运行时状态。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '内部服务', text: '工作区运行时信息。', code: 'workspace.info() / workspace_get_info' }] },
    { title: '字段说明', icon: '映', items: ['当前用户来自 MCP 身份验证后建立的登录会话。', '已启用插件和可用工具数量来自当前工作区运行时注册表。', '启动时间是当前工作区运行时启动时间。'] },
    { title: '规则与限制', icon: '规', items: ['本页不查询 Teambition 任务、工时或项目业务数据。', '数据按当前已验证用户隔离；插件状态随工作区生命周期更新。'] },
    { title: '防呆说明', icon: '!', items: ['用户身份发生变化时需要重新登录，避免将前一用户的数据混入当前工作区。'] },
  ], disclaimer: '此说明对应当前 WorkHub 实现；其他业务模块应在自身注册信息中维护来源、规则和限制。' } }],
}
