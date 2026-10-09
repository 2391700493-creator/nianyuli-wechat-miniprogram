function personIds(event) {
  return Array.isArray(event.personIds) && event.personIds.length ? event.personIds : [event.personId].filter(Boolean)
}

function tagsFor(event, personId) {
  if (event.tagsByPerson) return event.tagsByPerson[personId] || []
  return event.tags || []
}

function allTags(event) {
  if (event.tagsByPerson) return [...new Set(Object.values(event.tagsByPerson).reduce((all, tags) => all.concat(tags || []), []))]
  return event.tags || []
}

// 兼容旧数据：历史记录保存时把人名拼在了正文开头（`${names.join('、')} ${description}`），展示时剥离掉
function displayText(event, people) {
  let text = (event && event.text) || ''
  const names = personIds(event)
    .map(id => ((people || []).find(person => person.id === id) || {}).name)
    .filter(Boolean)
  const prefixes = names.length > 1 ? [names.join('、'), ...names] : names
  for (const prefix of prefixes) {
    if (prefix && text.startsWith(prefix + ' ')) return text.slice(prefix.length + 1).trim()
  }
  return text
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function parseDate(dateStr) {
  const parts = String(dateStr || '').split('-').map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

// 相对日期：今天 / 昨天 / M月D日（跨年由分组层的年份分隔线表达，不重复进文本）
function relativeDate(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return { text: String(dateStr || ''), weekday: '', today: false, yesterday: false, date: null }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today - d) / 86400000)
  const monthDay = `${d.getMonth() + 1}月${d.getDate()}日`
  if (diff === 0) return { text: '今天', weekday: '', today: true, yesterday: false, date: d }
  if (diff === 1) return { text: '昨天', weekday: '', today: false, yesterday: true, date: d }
  return { text: monthDay, weekday: WEEKDAYS[d.getDay()], today: false, yesterday: false, date: d }
}

// 按日期分组（events 需已按时间倒序），返回 [{ key, label, yearLabel?, events }]；条目附加 dateText
function groupEvents(events, getDate) {
  const groups = []
  const index = new Map()
  const nowYear = new Date().getFullYear()
  for (const event of events || []) {
    const dateStr = String(getDate ? getDate(event) : (event && event.date) || '')
    const rel = relativeDate(dateStr)
    const key = rel.date ? dateStr.slice(0, 10) : dateStr || '-'
    let group = index.get(key)
    if (!group) {
      group = { key, label: rel.text, events: [] }
      if (rel.date && rel.date.getFullYear() !== nowYear) group.yearLabel = `${rel.date.getFullYear()} 年`
      index.set(key, group)
      groups.push(group)
    }
    const dateText = rel.today || rel.yesterday || !rel.weekday ? rel.text : `${rel.text} · ${rel.weekday}`
    group.events.push({ ...event, dateText })
  }
  return groups
}

module.exports = { personIds, tagsFor, allTags, displayText, relativeDate, groupEvents }
