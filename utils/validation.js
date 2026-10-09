// 日期使用 YYYY-MM-DD；禁止自动进位（例如 2 月 30 日）。
function validDate(value, optional = false) {
  if (optional && !value) return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式无效')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效')
  return value
}
function tagName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 8) throw new Error('印象词需为 1 至 8 字')
  return name
}
module.exports = { validDate, tagName }
