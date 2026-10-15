export const worktimeManifest = {
  id: 'worktime', version: '0.1.0', apiVersion: 1,
  displayName: '工时统计', description: '查看任务自定义字段中的实际有效工时与工作日耗时。', defaultEnabled: true,
  capabilities: ['worktime.read'],
  views: [{ id: 'worktime.dashboard', title: '工时统计', subtitle: 'Work Time', description: '通过表格筛选项目、日期和任务范围。', category: '工作管理', icon: 'grid', color: 'blue', info: { summary: '在当前用户的本地任务快照中读取工时自定义字段，使用表格筛选器定义项目与日期范围。', sections: [
    { title: '数据来源', icon: '源', items: [{ label: '本地任务库', text: '使用当前用户已同步的任务及其自定义字段。', code: 'data/users/<owner>/tasks.sqlite' }] },
    { title: '统计字段', icon: '映', items: ['实际有效工时：实际有效工时 / 实际有效工作日 / actualEffectiveWorkdays。', '工作日耗时：工作日耗时天 / 工作日耗时 / workdayDuration。', '是否计入工时统计为否的任务不计入汇总；未填写此字段时默认计入。'] },
    { title: '规则与限制', icon: '规', items: ['通过“截止日期”的不早于 / 不晚于条件组合统计周期；项目字段可筛选项目。', '已归档任务不参与列表；没有截止日期的任务可用“为空”条件筛选。', '任务自定义字段来自任务清单同步结果；来源未返回相关字段时单元格显示为空。'] },
    { title: '防呆说明', icon: '!', items: ['只统计当前登录用户自己的本地任务，不汇总其他用户的数据。', '本模块只读取本地快照；如来源字段发生变化，请先在任务清单中同步。'] },
  ], disclaimer: '工时数据反映任务自定义字段当前保存的值，不对缺失字段进行推算或补齐。' } }],
}
