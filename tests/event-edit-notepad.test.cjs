const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const moods = require('../utils/moods')
function setup() {
  let definition
  vm.runInNewContext(fs.readFileSync('pages/event/event.js', 'utf8'), {
    Page(value) { definition = value },
    require(id) { return id.endsWith('/store') ? { saveMoods: async () => {} } : require('../utils/' + id.split('/').pop()) },
    wx: { hideKeyboard() {} },
    setTimeout
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value) } }
  page.allPeople = [{ id: 'a', name: '林夏' }]
  page.data.event = { id: 'e', date: '2026-10-04', personIds: ['a'], text: '一起散步', mood: '感动' }
  page.data.moodList = moods.DEFAULT_MOODS.map(item => ({ ...item }))
  page.edit()
  return page
}
const choice = name => ({ currentTarget: { dataset: { name } } })
test('打开关闭心情面板不改草稿；选择及清空进入未保存状态', () => {
  const p = setup()
  assert.equal(p.data.editContext, '10月4日 · 周日')
  assert.equal(p.data.selectedMoodColor, '#6b8fa3')
  p.openMoodPicker(); p.closeMoodPicker()
  assert.equal(p.isDirty(), false)
  p.openMoodPicker(); p.chooseMood(choice('平静'))
  assert.equal(p.data.moodPickerOpen, false)
  assert.equal(p.data.mood, '平静')
  assert.equal(p.data.selectedMoodColor, '#4a7a6a')
  assert.equal(p.isDirty(), true)
  p.chooseMood(choice(''))
  assert.equal(p.data.mood, '')
  assert.equal(p.data.selectedMoodColor, '')
})
test('管理心情关闭选择面板，改色同步摘要，移除选中词清空心情', () => {
  const p = setup()
  p.openMoodPicker(); p.openMoodManager()
  assert.equal(p.data.moodPickerOpen, false)
  assert.equal(p.data.moodSheetOpen, true)
  p.onMoodsChange({ detail: { moods: [{ name: '感动', color: '#123456' }] } })
  assert.equal(p.data.selectedMoodColor, '#123456')
  p.onMoodsChange({ detail: { moods: [{ name: '平静', color: '#654321' }] } })
  assert.equal(p.data.mood, '')
  assert.equal(p.isDirty(), true)
})
test('保存及删除期间禁止心情输入，未知选项不污染草稿', () => {
  for (const busy of ['saving', 'deleting']) {
    const p = setup(); p.data[busy] = true
    p.openMoodPicker(); p.chooseMood(choice('平静'))
    assert.equal(p.data.moodPickerOpen, false)
    assert.equal(p.data.mood, '感动')
  }
  const p = setup(); p.chooseMood(choice('不存在'))
  assert.equal(p.data.mood, '感动')
})
