const test = require('node:test')
const assert = require('node:assert/strict')
const { relativeDate, groupEvents } = require('../utils/events')

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('relativeDate 输出今天/昨天/月日与星期，非法输入原样返回', () => {
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  assert.equal(relativeDate(iso(now)).text, '今天')
  assert.equal(relativeDate(iso(yesterday)).text, '昨天')
  const rel = relativeDate('2020-01-15')
  assert.equal(rel.text, '1月15日')
  assert.equal(rel.weekday.length, 2)
  assert.equal(relativeDate('').text, '')
  assert.equal(relativeDate('bad').text, 'bad')
  assert.equal(relativeDate('bad').date, null)
})

test('groupEvents 按日期分组、跨年标记年份、条目带 dateText', () => {
  const now = new Date()
  const today = iso(now)
  const yesterday = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const lastYear = `${now.getFullYear() - 1}-12-14`
  const events = [
    { id: 'a', date: today },
    { id: 'b', date: today },
    { id: 'c', date: yesterday },
    { id: 'd', date: lastYear }
  ]
  const groups = groupEvents(events)
  assert.deepEqual(groups.map(group => group.label), ['今天', '昨天', '12月14日'])
  assert.equal(groups[0].events.length, 2)
  assert.equal(groups[0].events[0].dateText, '今天')
  assert.equal(groups[2].yearLabel, `${now.getFullYear() - 1} 年`)
  assert.match(groups[2].events[0].dateText, /12月14日/)
  assert.equal(groupEvents([]).length, 0)
})

test('模块导出完整性：页面用到的函数都在（防编辑时误删导出）', () => {
  // utils/events.js 曾因重写文件丢掉 relativeDate / groupEvents 的导出，
  // 导致 person.js、all-records.js、home.js 拿到 undefined 后页面整片空白。
  const events = require('../utils/events')
  for (const name of ['personIds', 'tagsFor', 'allTags', 'displayText', 'relativeDate', 'groupEvents']) {
    assert.equal(typeof events[name], 'function', `utils/events 缺少导出 ${name}`)
  }

  const store = require('../utils/store')
  for (const name of ['load', 'getTags', 'saveTag', 'deleteTag', 'renameTag', 'saveMoods',
    'deletePerson', 'addEvent', 'updateEvent', 'deleteEvent',
    'addPerson', 'updatePerson', 'updatePersonAvatar', 'reorderPeople']) {
    assert.equal(typeof store[name], 'function', `utils/store 缺少导出 ${name}`)
  }

  const moods = require('../utils/moods')
  for (const name of ['moodKey', 'moodColor', 'normalizeMoods']) {
    assert.equal(typeof moods[name], 'function', `utils/moods 缺少导出 ${name}`)
  }
})
