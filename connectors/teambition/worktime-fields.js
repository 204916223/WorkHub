// 工时派生字段：从任务的自定义字段中按名称提取。与 tb-agent shared/tasks.js 口径一致，
// 必须在自定义字段名称补全（cfId → 名称）之后调用，否则找不到字段。
const text = (value) => (value === undefined || value === null ? '' : String(value))
const normalizeFieldKey = (value) => text(value).toLowerCase().replace(/[\s_\-（）()【】\[\]]/g, '')

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const match = text(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

// TB 自定义字段的真实形态是 value:[{id,title}]，转成标量文本才能被数值/布尔解析识别
function fieldValue(value) {
  const raw = value?.value ?? value?.val ?? value?.text ?? value?.content
  if (Array.isArray(raw)) {
    return raw.map((item) => text(item && typeof item === 'object' ? (item.title ?? item.name ?? item.value) : item)).filter(Boolean).join('、')
  }
  return raw
}

const fieldName = (value) => text(value.name || value.title || value.label || value.fieldName || value.displayName)

function search(value, seen, visit) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (!Array.isArray(value)) {
    const found = visit(value)
    if (found !== null) return found
  }
  for (const nested of Object.values(value)) {
    const found = search(nested, seen, visit)
    if (found !== null) return found
  }
  return null
}

function parseBoolean(raw) {
  if (typeof raw === 'boolean') return raw
  if (/^(否|no|false|0)$/i.test(text(raw).trim())) return false
  if (/^(是|yes|true|1)$/i.test(text(raw).trim())) return true
  return null
}

export function findActualEffectiveWorkdays(value) {
  return search(value, new Set(), (node) => {
    const directKey = Object.keys(node).find((key) => ['actualeffectiveworkdays', 'actualeffectiveworkday', 'actualeffectivehoursdays', '实际有效工时天'].includes(normalizeFieldKey(key)))
    if (directKey) {
      const numeric = toFiniteNumber(node[directKey]?.value ?? node[directKey]?.val ?? node[directKey])
      if (numeric !== null) return Math.max(0, numeric)
    }
    const name = normalizeFieldKey(fieldName(node))
    if (name === '实际有效工时天' || name.includes('actualeffectivework')) {
      const numeric = toFiniteNumber(fieldValue(node))
      if (numeric !== null) return Math.max(0, numeric)
    }
    return null
  })
}

export function findWorktimeIncluded(value) {
  return search(value, new Set(), (node) => {
    const key = Object.keys(node).find((item) => {
      const normalized = normalizeFieldKey(item)
      return normalized === '是否计入工时统计' || normalized.includes('inworktimestatistics')
    })
    if (key) {
      const parsed = parseBoolean(node[key]?.value ?? node[key]?.val ?? node[key])
      if (parsed !== null) return parsed
    }
    const name = normalizeFieldKey(fieldName(node))
    if (name === '是否计入工时统计' || name.includes('inworktimestatistics')) return parseBoolean(fieldValue(node))
    return null
  })
}

export function findWorkdayDuration(value) {
  return search(value, new Set(), (node) => {
    const directKey = Object.keys(node).find((key) => {
      const normalized = normalizeFieldKey(key)
      return normalized === '工作日耗时天' || normalized.includes('workdayduration')
    })
    if (directKey) {
      const numeric = toFiniteNumber(node[directKey]?.value ?? node[directKey]?.val ?? node[directKey])
      if (numeric !== null) return Math.max(0, numeric)
    }
    const name = normalizeFieldKey(fieldName(node))
    if (name === '工作日耗时天' || name.includes('workdayduration')) {
      const numeric = toFiniteNumber(fieldValue(node))
      if (numeric !== null) return Math.max(0, numeric)
    }
    return null
  })
}

// 「不计入工时统计」只归零工作日耗时，不动实际有效工时（口径同 tb-agent）。
export function applyWorktimeFields(task, now = new Date()) {
  const source = { customfields: task.customfields }
  const worktimeIncluded = findWorktimeIncluded(source)
  const dueTime = task.dueDate ? Date.parse(task.dueDate) : NaN
  task.worktimeIncluded = worktimeIncluded
  task.actualEffectiveWorkdays = findActualEffectiveWorkdays(source) ?? 0
  task.workdayDuration = worktimeIncluded === false ? 0 : (findWorkdayDuration(source) ?? 0)
  task.overdue = !task.isDone && !task.isArchived && Number.isFinite(dueTime) && dueTime < now.getTime()
  return task
}
