const MENTION_STYLE = { background: '#e8e8ed', backgroundColor: '#e8e8ed', color: '#1d1d1f', bold: true }

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function mentionHtml(name) {
  return `<span style="background-color:#e8e8ed;color:#1d1d1f;border-radius:16px;padding:3px 9px;font-weight:600;">@${escapeHtml(name)}</span>`
}

function appendMentionHtml(html, name, hasText) {
  const base = html || '<p><br></p>'
  const close = base.lastIndexOf('</p>')
  const prefix = hasText ? '&nbsp;' : ''
  const token = `${prefix}${mentionHtml(name)}&nbsp;`
  if (close === -1) return `<p>${base}${token}</p>`
  return base.slice(0, close).replace(/<br\s*\/?>(\s*)$/i, '') + token + base.slice(close)
}

function styleMentionHtml(html, name) {
  const token = `@${escapeHtml(name)}`
  return html && html.includes(token) ? html.replace(token, mentionHtml(name)) : ''
}

function hasMention(text, name) {
  const token = `@${name}`
  let index = text.indexOf(token)
  while (index !== -1) {
    const next = text[index + token.length] || ''
    if (!/[A-Za-z0-9_\u3400-\u9fff]/.test(next)) return true
    index = text.indexOf(token, index + token.length)
  }
  return false
}

function styleMention(delta, name) {
  const token = `@${name}`
  let styled = false
  const ops = []
  for (const op of ((delta && delta.ops) || [])) {
    if (styled || typeof op.insert !== 'string' || !op.insert.includes(token)) { ops.push(op); continue }
    const index = op.insert.indexOf(token)
    if (index) ops.push({ insert: op.insert.slice(0, index), ...(op.attributes ? { attributes: op.attributes } : {}) })
    ops.push({ insert: token, attributes: MENTION_STYLE })
    const rest = op.insert.slice(index + token.length)
    if (rest) ops.push({ insert: rest, ...(op.attributes ? { attributes: op.attributes } : {}) })
    styled = true
  }
  return { ops }
}

module.exports = { appendMentionHtml, hasMention, styleMentionHtml, styleMention }
