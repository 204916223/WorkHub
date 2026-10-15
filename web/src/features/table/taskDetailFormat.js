const valueKeys = ['displayValue', 'displayName', 'name', 'label', 'title', 'value', 'values', 'fieldValue', 'text', 'content', 'metaString', 'html']

function decodeHtml(value) {
  return String(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[\t ]+\n/g, '\n')
    .trim()
}

function parseJsonString(value) {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try { return JSON.parse(text) } catch {}
  }
  return value
}

export function detailValue(value, depth = 0) {
  if (value == null || value === '') return '—'
  if (depth > 6) return '[复杂字段]'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (Array.isArray(value)) return value.map((item) => detailValue(item, depth + 1)).filter((item) => item !== '—').join('、') || '—'
  if (typeof value === 'string') {
    const parsed = parseJsonString(value)
    if (parsed !== value) return detailValue(parsed, depth + 1)
    return /<[^>]+>/.test(value) ? decodeHtml(value) || '—' : value.trim() || '—'
  }
  if (typeof value === 'object') {
    for (const key of valueKeys) {
      if (value[key] != null && value[key] !== '') return detailValue(value[key], depth + 1)
    }
    return JSON.stringify(value)
  }
  return String(value)
}

export function fieldLabel(field, index) {
  const label = field?.fieldName || field?.name || field?.label || field?.alias || field?.key || field?.title
  return label ? detailValue(label) : `自定义字段 ${index + 1}`
}

export function fieldValue(field) {
  if (!field || typeof field !== 'object') return detailValue(field)
  for (const key of ['value', 'values', 'fieldValue', 'content', 'text', 'metaString']) {
    if (field[key] != null && field[key] !== '') return detailValue(field[key])
  }
  return '—'
}

export function priorityLabel(value) {
  if (value == null || value === '') return '—'
  if (Number(value) === 0) return '普通'
  return detailValue(value)
}

const knownSourceFields = new Set(['id', 'content', 'title', 'note', 'description', 'projectid', 'project', 'projectname', 'parenttaskid', 'parenttitle', 'creatorid', 'creatorname', 'creator', 'executorid', 'executor', 'executorname', 'involvemembers', 'involvemembernames', 'tagids', 'tagnames', 'tags', 'tfsid', 'tfsname', 'priority', 'state', 'isdone', 'isarchived', 'startdate', 'duedate', 'accomplishtime', 'created', 'updated', 'customfields', 'taskid', 'sfcname', 'tasklistname', 'stagename', 'worktimeincluded', 'actualeffectiveworkdays', 'workdayduration', 'overdue', 'sourcedata'])

export function extraTaskFields(task) {
  return Object.entries(task || {}).filter(([key]) => !knownSourceFields.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()))
}
