const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function record(overrides = {}, { navigateBackFails = false } = {}) {
  let definition
  const notices = [], saved = [], routes = [], guards = []
  const people = [{ id: 'a', name: '小刘' }, { id: 'b', name: '小王' }]
  const moods = [{ name: '平静', color: '#4a7a6a' }, { name: '开心', color: '#b08f3d' }]
  const store = {
    async load() { return { people, moods } },
    async saveMoods() {},
    async addEvent(event) { saved.push(structuredClone(event)); return event },
    ...overrides
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/record/record.js'), 'utf8'), {
    Page(value) { definition = value },
    require(id) { return id === '../../utils/store' ? store : require('../utils/moods') },
    wx: {
      hideKeyboard() {}, showToast(value) { notices.push(value.title) },
      enableAlertBeforeUnload() { guards.push(true) }, disableAlertBeforeUnload() { guards.push(false) },
      navigateBack(value) { if (navigateBackFails) value.fail(); else routes.push('back') },
      switchTab(value) { routes.push(value.url) },
      redirectTo(value) { routes.push(value.url) }
    }, Date, setTimeout(callback) { callback() }
  })
  const page = { ...definition, data: structuredClone(definition.data),
    setData(value, callback) { Object.assign(this.data, value); if (callback) callback() } }
  return { page, notices, saved, routes, guards }
}
const event = name => ({ currentTarget: { dataset: { name } } })

test('心情选择、管理和返回形成闭环，正文和关联人物保留', async () => {
  const { page, guards } = record()
  await page.refreshPeople()
  page.addMention(page.data.people[0])
  page.onTextInput({ detail: { value: '今天聊了很久' } })
  page.onTextFocus()
  page.openMoodPicker()
  assert.equal(page.data.focusField, '')
  assert.equal(page.data.moodPickerOpen, true)
  page.openMoodManager()
  assert.equal(page.data.moodPickerOpen, false)
  assert.equal(page.data.moodSheetOpen, true)
  page.closeMoodManager()
  assert.equal(page.data.moodPickerOpen, true)
  page.chooseMood(event('平静'))
  assert.equal(page.data.mood, '平静')
  assert.equal(page.data.selectedMoodColor, '#4a7a6a')
  assert.equal(page.data.moodPickerOpen, false)
  assert.equal(page.data.focusField, 'text')
  assert.equal(page.data.text, '今天聊了很久')
  assert.deepEqual([...page.data.personIds], ['a'])
  assert.equal(guards.at(-1), true)
})

test('心情可取消，改色会更新摘要，删除已选心情不会残留旧值', async () => {
  const { page } = record()
  await page.refreshPeople()
  page.openMoodPicker()
  page.chooseMood(event('开心'))
  page.onMoodsChange({ detail: { moods: [{ name: '开心', color: '#123456' }] } })
  assert.equal(page.data.selectedMoodColor, '#123456')
  page.openMoodPicker()
  page.chooseMood(event(''))
  assert.equal(page.data.mood, '')
  assert.equal(page.data.selectedMoodColor, '')
  page.openMoodPicker()
  page.chooseMood(event('开心'))
  page.onMoodsChange({ detail: { moods: [{ name: '平静', color: '#654321' }] } })
  assert.equal(page.data.mood, '')
  assert.equal(page.data.selectedMoodColor, '')
})

test('键盘高度只影响正文编辑，切换弹层后忽略迟到的键盘事件', async () => {
  const { page } = record()
  await page.refreshPeople()
  page.onTextFocus()
  page.onKeyboardHeightChange({ detail: { height: 320 } })
  assert.equal(page.data.keyboardHeight, 320)
  page.openPersonPicker()
  assert.equal(page.data.keyboardHeight, 0)
  page.onKeyboardHeightChange({ detail: { height: 320 } })
  assert.equal(page.data.keyboardHeight, 0)
  page.closePersonPicker()
  assert.equal(page.data.focusField, 'text')
  page.onKeyboardHeightChange({ detail: { height: 0 } })
  assert.equal(page.data.keyboardHeight, 0)
  page.onTextFocus({ detail: { height: 280 } })
  assert.equal(page.data.keyboardHeight, 280)
  page.blurInput()
  assert.equal(page.data.keyboardHeight, 0, '失焦时即使平台漏发高度事件，也应恢复完整页面')
})

test('加载失败或保存中不能打开或修改心情', async () => {
  const { page } = record()
  for (const status of [{ peopleLoading: true }, { peopleLoading: false, loadFailed: true }, { loadFailed: false, saving: true }]) {
    page.setData(status)
    page.openMoodPicker()
    page.chooseMood(event('平静'))
    assert.equal(page.data.moodPickerOpen, false)
    assert.equal(page.data.mood, '')
  }
})

test('空内容和未关联人物不能保存；多人及可空心情提交后返回上一页', async () => {
  const { page, saved, routes } = record()
  page.onLoad({ personId: 'a' })
  await page.refreshPeople()
  assert.deepEqual([...page.data.personIds], ['a'])
  await page.save()
  assert.equal(saved.length, 0)
  page.onTextInput({ detail: { value: '  今天一起吃饭  ' } })
  page.removeMention({ currentTarget: { dataset: { key: page.data.mentions[0].key } } })
  await page.save()
  assert.equal(saved.length, 0)
  assert.equal(page.data.pickerOpen, true)
  page.addMention(page.data.people[0]); page.addMention(page.data.people[1])
  page.closePersonPicker()
  await page.save()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].text, '今天一起吃饭')
  assert.deepEqual(saved[0].personIds, ['a', 'b'])
  assert.equal(saved[0].mood, '')
  assert.deepEqual(routes, ['back'])
  assert.equal(page.data.saving, true)
})

test('保存成功无法返回上一页时回到首页', async () => {
  const { page, saved, routes } = record({}, { navigateBackFails: true })
  await page.refreshPeople()
  page.addMention(page.data.people[0])
  page.onTextInput({ detail: { value: '从独立入口保存记录' } })
  await page.save()
  assert.equal(saved.length, 1)
  assert.deepEqual(routes, ['/pages/home/home'])
})

test('保存失败保留草稿可重试，连续点击不会重复提交', async () => {
  let rejectSave, resolveSave, writes = 0
  const { page } = record({ addEvent() { writes++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject }) } })
  await page.refreshPeople()
  page.addMention(page.data.people[0])
  page.onTextInput({ detail: { value: '需要保留的草稿' } })
  const first = page.save()
  await page.save()
  assert.equal(writes, 1)
  rejectSave(new Error('network'))
  await first
  assert.equal(page.data.saving, false)
  assert.equal(page.data.text, '需要保留的草稿')
  const retry = page.save()
  resolveSave({ id: 'saved' })
  await retry
  assert.equal(writes, 2)
})

test('心情同步失败时保留当前选择，主页面可重试后保存', async () => {
  let fail = true
  const { page, saved } = record({ async saveMoods() { if (fail) throw new Error('network') } })
  await page.refreshPeople()
  page.addMention(page.data.people[0])
  page.onTextInput({ detail: { value: '一次见面' } })
  page.openMoodPicker()
  page.chooseMood(event('平静'))
  page.onMoodsChange({ detail: { moods: [{ name: '平静', color: '#123456' }] } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.moodSyncState, 'failed')
  await page.save()
  assert.equal(saved.length, 0)
  assert.equal(page.data.mood, '平静')
  fail = false
  await page.retryMoodSync()
  await page.save()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mood, '平静')
})
