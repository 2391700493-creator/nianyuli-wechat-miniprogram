const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function markup(page) {
  return fs.readFileSync(path.join(root, 'pages', page, `${page}.wxml`), 'utf8')
}

test('记录列表只用左侧圆点表达情绪颜色', () => {
  const home = markup('home')
  const person = markup('person')
  const records = markup('all-records')

  assert.match(home, /class="recent-marker"[^>]+item\.moodColor/)
  assert.doesNotMatch(home, /class="recent-mood"|class="mood-point"/)

  assert.match(person, /class="record-dot"[^>]+item\.moodColor/)
  assert.doesNotMatch(person, /class="event-mood"|class="mood-dot"/)

  assert.match(records, /class="entry-marker"[^>]+item\.moodColor/)
})

test('首页记录按钮只显示操作文案', () => {
  const home = markup('home')
  const button = home.match(/<button class="quick"[\s\S]*?<\/button>/)

  assert.ok(button)
  assert.doesNotMatch(button[0], /＋|quick-plus/)
  assert.match(button[0], />记一件事</)
})
