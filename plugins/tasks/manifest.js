export const tasksManifest = {
  id: 'tasks', version: '0.1.0', apiVersion: 1,
  displayName: '任务清单', description: '同步当前用户有权访问的 Teambition 任务，并在本地数据库中查询。', defaultEnabled: true,
  capabilities: ['tasks.read', 'tasks.sync'],
  views: [{ id: 'tasks.list', title: '任务清单', subtitle: 'Tasks', description: '查看已同步到当前用户本地数据库的 Teambition 任务。', category: '工作管理', icon: 'list', iconAsset: '日期', color: 'blue', info: { summary: '将当前登录用户可访问的任务同步到其独立 SQLite 数据库，列表查询在本地完成。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: 'Teambition MCP', text: '只调用当前登录身份的 SearchUserTasksV3。', code: 'SearchUserTasksV3' }, { label: '本地任务库', text: '按当前用户身份隔离保存任务快照。', code: 'data/users/<owner>/tasks.sqlite' }] },
    { title: '字段说明', icon: '映', items: ['保存任务标题、描述、项目、负责人、状态、优先级、日期及非附件自定义字段。', '任务 ID 与组织 ID 组成唯一键；更新时间相同的任务跳过本地写入。'] },
    { title: '规则与限制', icon: '规', items: ['当前版本通过 SearchUserTasksV3 并以 roleTypes=executor 查询当前用户作为执行人的任务，不读取其他用户数据库。', '任务查询使用更新时间倒序分页；MCP 未提供增量游标时，同步仍需扫描来源页，更新时间相同的任务跳过本地写入。', '每次最多读取 30 页；重复游标、缺少分页参数、来源总数不匹配或达到页数上限都会显示具体的不完整原因，并保留已同步数据。', '周、月、季度、自定义日期筛选依据任务截止日期 dueDate；没有截止日期的任务不会出现在这些日期范围内。', '评论和附件暂不处理；首次同步后，任务筛选与搜索读取本地数据库。'] },
    { title: '防呆说明', icon: '!', items: ['MCP 凭证仅保存在服务端内存中的登录会话，不写入数据库或个人文件。', '同步失败会保留已有本地任务，并记录失败状态。'] },
  ], disclaimer: '本说明描述当前任务清单实现，不代表 Teambition MCP 已支持按更新时间增量拉取。' } }],
}
