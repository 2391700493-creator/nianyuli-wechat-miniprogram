const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function pageFor(events = []) {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/all-records/all-records.js'), 'utf8'), {
    Page(value) { definition = value }, Date,
    require(id) { return id.endsWith('/store') ? { load: async () => ({ events, people: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], moods: [] }) } : require('../utils/' + id.split('/').pop()) }
  })
  return { ...definition, data: structuredClone(definition.data), setData(value, callback) { Object.assign(this.data, value); if (callback) callback() } }
}
const tap = iso => ({ currentTarget: { dataset: { iso } } })
const fixtures = [{ id: 'old', date: '2026-09-30', text: '见面', personId: 'a' }, { id: 'new', date: '2026-10-04', text: '散步', personId: 'b' }, { id: 'same', date: '2026-09-30', text: '散步', personId: 'a' }]
test('默认全部记录倒序，日历收起；同日记录只显示一次日期', async () => {
  const p = pageFor(fixtures); await p.refresh()
  assert.equal(p.data.showCalendar, false)
  assert.deepEqual(Array.from(p.data.events, e => e.id), ['new', 'old', 'same'])
  assert.deepEqual(Array.from(p.data.events, e => e.showDate), [true, true, false])
})
test('选日同步结果并收起，再次选择同日不会意外取消', async () => {
  const p = pageFor(fixtures); await p.refresh()
  p.toggleCalendar(); p.tapDay(tap('2026-09-30'))
  assert.equal(p.data.showCalendar, false)
  assert.equal(p.data.filteredCount, 2)
  p.toggleCalendar(); p.tapDay(tap('2026-09-30'))
  assert.equal(p.data.startDate, '2026-09-30')
  p.clearDates(); assert.equal(p.data.filteredCount, 3)
})
test('月历跨年和闰年正确，翻月不改变已选日期，重开定位选中月', async () => {
  const p = pageFor(fixtures); await p.refresh()
  p.tapDay(tap('2024-02-29')); p.toggleCalendar()
  assert.equal(p.data.days.filter(d => d.iso).length, 29)
  assert.equal(p.data.days[3].iso, '2024-02-01')
  p.prevMonth(); assert.equal(p.data.monthTitle, '2024年1月')
  p.prevMonth(); assert.equal(p.data.monthTitle, '2023年12月')
  p.nextMonth(); assert.equal(p.data.monthTitle, '2024年1月')
  assert.equal(p.data.startDate, '2024-02-29')
  p.toggleCalendar(); p.toggleCalendar()
  assert.equal(p.data.monthTitle, '2024年2月')
})
test('日历圆点遵循搜索和人物条件；清除日期保留其他条件', async () => {
  const p = pageFor(fixtures); await p.refresh()
  p.setData({ selectedPeople: ['a'] }); p.search({ detail: { value: '散步' } })
  p.tapDay(tap('2026-10-04')); p.toggleCalendar()
  assert.equal(p.data.filteredCount, 0)
  assert.equal(p.data.days.find(d => d.iso === '2026-10-04').has, false)
  p.clearDates(); assert.equal(p.data.filteredCount, 1)
  p.clearFilters(); assert.equal(p.data.filteredCount, 3)
})
test('今天选择与列表一致，分页不会重复同日标题', async () => {
  const now = new Date(); const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
  const p = pageFor(Array.from({ length: 25 }, (_, i) => ({ id: String(i), date: today, text: '记录', personId: 'a' })))
  await p.refresh(); p.selectToday()
  assert.equal(p.data.startDate, today)
  assert.equal(p.data.events.length, 20)
  p.loadMore(); assert.equal(p.data.events.length, 25)
  assert.equal(p.data.events.filter(e => e.showDate).length, 1)
  assert.equal(p.data.hasMore, false)
})

test('日历打开隐藏独立导航，所有关闭路径和离开页面均恢复导航', async () => {
  for (const close of [p => p.closeCalendar(), p => p.toggleCalendar(), p => p.tapDay(tap('2026-10-04')), p => p.selectToday(), p => p.clearDates(), p => p.clearFilters(), p => p.togglePanel(), p => p.onHide(), p => p.onUnload()]) {
    const p = pageFor(fixtures)
    const tab = { data: { hidden: false }, setData(value) { Object.assign(this.data, value) } }
    p.getTabBar = () => tab
    await p.refresh()
    p.toggleCalendar()
    assert.equal(tab.data.hidden, true, '打开日历时隐藏导航，防止遮住按钮')
    close(p)
    assert.equal(tab.data.hidden, false, '关闭或离开后恢复导航')
    assert.equal(p.data.showCalendar, false)
  }
})

test('时间线仅跨日分隔，跨周月年不叠加，筛选后重新判断', async () => {
  const p = pageFor([
    { id: 'a', date: '2026-01-01', text: '散步', personId: 'a' },
    { id: 'b', date: '2026-01-01', text: '吃饭', personId: 'b' },
    { id: 'c', date: '2025-12-28', text: '散步', personId: 'a' }
  ])
  await p.refresh()
  assert.deepEqual(Array.from(p.data.events, e => e.showDivider), [false, true, false])
  p.search({ detail: { value: '散步' } })
  assert.deepEqual(Array.from(p.data.events, e => e.showDivider), [true, false])
  p.selectDate('2026-01-01')
  assert.deepEqual(Array.from(p.data.events, e => e.showDivider), [false])
})

test('分页截断同一天不产生分界，加载后正确显示组尾', async () => {
  const events = Array.from({ length: 21 }, (_, i) => ({ id: String(i), date: '2026-10-02', text: '记录', personId: 'a' }))
  events.push({ id: 'older', date: '2026-10-01', text: '昨天', personId: 'a' })
  const p = pageFor(events)
  await p.refresh()
  assert.equal(p.data.events.some(e => e.showDivider), false)
  p.loadMore()
  assert.equal(p.data.events[20].showDivider, true)
  assert.equal(p.data.events[21].showDivider, false)
  assert.equal(p.data.events.filter(e => e.showDivider).length, 1)
})
