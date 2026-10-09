const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadComponent(name) {
  let definition
  const notices = []
  const context = {
    Component(value) { definition = value },
    require(id) {
      if (id === '../../utils/moods') return require('../utils/moods')
      throw new Error(id)
    },
    wx: { showToast(value) { notices.push(value.title) } }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../components/${name}/${name}.js`), 'utf8'), context)
  const component = {
    ...definition,
    ...definition.methods,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    events: {},
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback() },
    triggerEvent(name, detail) { (this.events[name] = this.events[name] || []).push(detail) }
  }
  return { component, notices }
}

function loadPage(name, store, extra = {}) {
  let definition
  const notices = []
  const context = {
    Page(value) { definition = value },
    require(id) {
      if (id === '../../utils/store') return store
      if (id === '../../utils/events') return require('../utils/events')
      if (id === '../../utils/moods') return require('../utils/moods')
      if (id === '../../utils/starmap') return require('../utils/starmap')
      throw new Error(id)
    },
    wx: { showToast(value) { notices.push(value.title) }, showLoading() {}, hideLoading() {}, ...extra.wx },
    getApp: () => extra.app || { globalData: { recordsPersonId: '' } },
    Date, Map, Set, Math, JSON
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../pages/${name}/${name}.js`), 'utf8'), context)
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback() },
    getTabBar() { return null }
  }
  return { page, notices }
}

test('批量删除中途失败后仅保留未删除人物供重试', async () => {
  const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]
  const removed = []
  let failOnce = true
  const store = {
    async load() { return { people: people.filter(item => !removed.includes(item.id)), events: [] } },
    async deletePerson(id) {
      if (id === 'b' && failOnce) { failOnce = false; throw new Error('network') }
      removed.push(id)
    }
  }
  let confirm
  const { page } = loadPage('people', store, { wx: { showModal(value) { confirm = value.success } } })
  page.setData({ selectedIds: ['a', 'b'], managing: true })
  await page.deleteSelected()
  await confirm({ confirm: true })
  assert.deepEqual([...page.data.selectedIds], ['b'])
  await page.deleteSelected()
  await confirm({ confirm: true })
  assert.deepEqual(removed, ['a', 'b'])
})

test('全部记录可清除人物范围，普通入口会清除上次范围', async () => {
  const app = { globalData: { recordsPersonId: null } }
  const { page } = loadPage('all-records', { async load() { return { people: [{ id: 'a', name: '甲' }], events: [{ id: 'e1', personId: 'a', text: '甲', date: '2026-09-30' }, { id: 'e2', personId: 'b', text: '乙', date: '2026-09-30' }] } } }, { app })
  page.setData({ selectedPeople: ['a'] })
  page.onShow()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.events.length, 2)
  page.setData({ selectedPeople: ['a'] })
  page.applyFilter()
  assert.equal(page.data.events.length, 1)
  page.setData({ selectedPeople: ['a', 'b'] })
  page.applyFilter()
  assert.equal(page.data.events.length, 2)
  page.togglePerson({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.events.length, 1)
  page.clearPeople()
  assert.equal(page.data.events.length, 2)
})

test('心情管理组件：增删改色即时生效并派发 change', () => {
  const { component, notices } = loadComponent('mood-manager')
  const { DEFAULT_MOODS } = require('../utils/moods')
  component.data.moods = DEFAULT_MOODS.map(item => ({ ...item }))
  component.reset()
  assert.equal(component.data.manage.length, 6)

  component.setData({ newMoodName: '破防' })
  component.addMood()
  assert.equal(component.data.manage.length, 7)
  assert.deepEqual(component.events.change[0].moods.slice(-1), [{ name: '破防', color: '#a66e2e' }])

  component.addMood()
  assert.ok(notices.includes('请输入心情名'))
  component.setData({ newMoodName: '破防' })
  component.addMood()
  assert.ok(notices.includes('已有这个心情'))

  // 点色板：选色即时生效
  component.togglePalette({ currentTarget: { dataset: { idx: 6 } } })
  assert.equal(component.data.paletteIndex, 6)
  component.pickColor({ currentTarget: { dataset: { color: '#7a6b99' } } })
  assert.equal(component.data.manage[6].color, '#7A6B99')
  assert.deepEqual(component.events.change[1].moods[6], { name: '破防', color: '#7A6B99' })

  // 拖滑块微调：三条分别改色相/深浅/明暗，实时派发
  component.togglePalette({ currentTarget: { dataset: { idx: 0 } } })
  const hueChangeBefore = component.events.change.length
  component.onSlide({ currentTarget: { dataset: { kind: 'hue' } }, detail: { value: 200 } })
  assert.equal(component.data.hsv.h, 200)
  assert.equal(component.data.manage[0].color, component.data.bars.preview)
  assert.equal(component.events.change.length, hueChangeBefore + 1)

  component.onSlide({ currentTarget: { dataset: { kind: 'sat' } }, detail: { value: 80 } })
  assert.equal(component.data.hsv.s, 80)
  assert.equal(component.data.manage[0].color, component.data.bars.preview)

  // 明暗滑块有下限，避免拖到纯黑在白底上看不见
  component.onSlide({ currentTarget: { dataset: { kind: 'val' } }, detail: { value: 0 } })
  assert.equal(component.data.hsv.v, 15)
  assert.equal(component.data.manage[0].color, component.data.bars.preview)
  component.onSlide({ currentTarget: { dataset: { kind: 'val' } }, detail: { value: 90 } })
  assert.equal(component.data.hsv.v, 90)

  const changeCountBeforeDelete = component.events.change.length
  const angryIdx = component.data.manage.findIndex(item => item.name === '生气')
  component.onDelete({ currentTarget: { dataset: { idx: angryIdx } } })
  assert.equal(component.data.manage.length, 6)
  assert.equal(component.data.paletteIndex, -2, '删除后应收起调色板')
  assert.equal(component.events.change[changeCountBeforeDelete].moods.length, 6)

  component.setData({ manage: [{ name: '平静', color: '#4a7a6a' }] })
  component.onDelete({ currentTarget: { dataset: { idx: 0 } } })
  assert.ok(notices.includes('至少保留一个心情'))
})

test('事件页接入心情管理组件：删掉选中心情会清空选择并持久化', async () => {
  const savedMoods = []
  const store = { async saveMoods(list) { savedMoods.push(JSON.parse(JSON.stringify(list))) } }
  const { page } = loadPage('event', store)
  const { DEFAULT_MOODS } = require('../utils/moods')
  page.setData({ event: { id: 'e1', personIds: ['a'], text: '一次见面', tagsByPerson: {} }, mood: '生气', moodList: DEFAULT_MOODS.map(item => ({ ...item })) })
  page.edit()
  assert.equal(page.data.moodList.length, 6)

  page.openMoodManager()
  assert.equal(page.data.moodSheetOpen, true)
  const list = page.data.moodList.filter(item => item.name !== '生气')
  page.onMoodsChange({ detail: { moods: list } })
  assert.equal(page.data.mood, '')
  assert.equal(page.data.moodList.length, 5)
  assert.deepEqual(savedMoods[0].length, 5)
})

test('取消事件编辑不会保存新印象词', () => {
  let saves = 0
  let confirm
  const { page } = loadPage('event', { saveTag() { saves++ } }, { wx: { showModal(value) { confirm = value.success } } })
  page.setData({ event: { id: 'e1', personIds: ['a'], text: '一件事' }, activePersonId: 'a', customTag: '可靠' })
  page.edit()
  page.setData({ customTag: '可靠' })
  page.addCustom()
  assert.deepEqual([...page.pendingTags], ['可靠'])
  page.cancelEdit()
  assert.equal(page.data.editing, true)
  confirm({ confirm: true })
  assert.equal(saves, 0)
  assert.equal(page.data.editing, false)
  page.cancelEdit()
  assert.equal(page.data.editing, false)
})

test('修改事件可增减关联人物，重新关联时恢复未保存的印象', () => {
  const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }]
  const { page } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = ['可靠']
  page.setData({
    event: { id: 'e1', personIds: ['a', 'b'], text: '一起完成项目', tagsByPerson: { a: [], b: ['可靠'] } },
    people: people.slice(0, 2)
  })

  page.edit()
  page.togglePersonLink({ currentTarget: { dataset: { id: 'b' } } })
  assert.deepEqual(page.data.people.map(person => person.id), ['a'])
  assert.equal(page.data.activePersonId, 'a')

  page.togglePersonLink({ currentTarget: { dataset: { id: 'c' } } })
  assert.deepEqual(page.data.people.map(person => person.id), ['a', 'c'])
  assert.equal(page.data.activePersonId, 'c')

  page.togglePersonLink({ currentTarget: { dataset: { id: 'b' } } })
  const rowB = page.data.peopleRows.find(row => row.id === 'b')
  assert.equal(rowB.impsText, '可靠')
})

test('保存事件时只提交当前关联人物及其印象', async () => {
  const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }]
  let saved
  const store = {
    async updateEvent(id, updates) { saved = { id, ...structuredClone(updates) } },
    async load() { return { people, events: [{ id: 'e1', ...saved }], tags: [] } }
  }
  const { page } = loadPage('event', store)
  page.eventId = 'e1'
  page.allPeople = people
  page.availableTags = ['可靠', '主动']
  page.setData({
    event: { id: 'e1', personIds: ['a', 'b'], text: '一起完成项目', mood: '', tagsByPerson: { a: [], b: ['可靠'] } },
    people: people.slice(0, 2)
  })

  page.edit()
  page.togglePersonLink({ currentTarget: { dataset: { id: 'b' } } })
  page.togglePersonLink({ currentTarget: { dataset: { id: 'c' } } })
  page.draftTags.c = ['主动']
  await page.save()

  assert.deepEqual(saved.personIds, ['a', 'c'])
  assert.equal(saved.personId, 'a')
  assert.deepEqual(saved.tagsByPerson, { a: [], c: ['主动'] })
})

test('事件人物选择弹层可搜索并显示关联状态', () => {
  const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }]
  const { page } = loadPage('event', {})
  page.allPeople = people
  page.draftPersonIds = ['a', 'c']
  page.setData({ people: [people[0], people[2]] })

  page.openPersonPicker()
  assert.equal(page.data.pickerOpen, true)
  assert.deepEqual(page.data.pickerPeople.map(person => [person.id, person.linked]), [['a', true], ['b', false], ['c', true]])

  page.searchPerson({ detail: { value: '乙' } })
  assert.deepEqual(page.data.pickerPeople.map(person => person.id), ['b'])
  page.closePersonPicker()
  assert.equal(page.data.pickerOpen, false)
})

test('更多印象弹层展示当前人物的全部可选印象', () => {
  const people = [{ id: 'a', name: '甲' }]
  const { page } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = ['主动', '可靠', '坦诚']
  page.setData({ event: { id: 'e1', personIds: ['a'], text: '一次见面', tagsByPerson: { a: ['可靠'] } }, people })
  page.edit()

  page.openTagPickerFor({ currentTarget: { dataset: { id: 'a' } } })
  assert.equal(page.data.tagPickerOpen, true)
  assert.equal(page.data.tagPickerSelectedCount, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.tagPickerOptions.map(tag => [tag.name, tag.selected]))), [['可靠', true], ['主动', false], ['坦诚', false]])

  page.searchTag({ detail: { value: '坦' } })
  assert.deepEqual([...page.data.tagPickerOptions.map(tag => tag.name)], ['坦诚'])
  page.closeTagPicker()
  assert.equal(page.data.tagPickerOpen, false)
})

test('更多印象弹层只修改当前人物的选择', () => {
  const people = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]
  const { page } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = ['主动', '可靠', '坦诚']
  page.setData({ event: { id: 'e1', personIds: ['a', 'b'], text: '一次见面', tagsByPerson: { a: ['可靠'], b: ['主动'] } }, people })
  page.edit()
  page.openTagPickerFor({ currentTarget: { dataset: { id: 'a' } } })

  page.togglePickerTag({ currentTarget: { dataset: { tag: '坦诚' } } })
  assert.deepEqual([...page.draftTags.a], ['可靠', '坦诚'])
  assert.deepEqual([...page.draftTags.b], ['主动'])
  assert.equal(page.data.tagPickerSelectedCount, 2)

  page.togglePickerTag({ currentTarget: { dataset: { tag: '可靠' } } })
  assert.deepEqual([...page.draftTags.a], ['坦诚'])
  assert.equal(page.data.tagPickerSelectedCount, 1)
})

test('更多印象弹层限制每人最多选择十个', () => {
  const people = [{ id: 'a', name: '甲' }]
  const tags = Array.from({ length: 11 }, (_, index) => `印象${index}`)
  const { page, notices } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = tags
  page.setData({ event: { id: 'e1', personIds: ['a'], text: '一次见面', tagsByPerson: { a: tags.slice(0, 10) } }, people })
  page.edit()
  page.openTagPickerFor({ currentTarget: { dataset: { id: 'a' } } })

  page.togglePickerTag({ currentTarget: { dataset: { tag: '印象10' } } })
  assert.equal(page.draftTags.a.length, 10)
  assert.ok(notices.includes('每人最多选择 10 个印象'))
})

test('新增印象词也遵守每人十个上限', () => {
  const people = [{ id: 'a', name: '甲' }]
  const tags = Array.from({ length: 10 }, (_, index) => `印象${index}`)
  const { page, notices } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = tags.slice()
  page.setData({ event: { id: 'e1', personIds: ['a'], text: '一次见面', tagsByPerson: { a: tags } }, people })
  page.edit()
  page.setData({ customTag: '新印象' })

  page.addCustom()
  assert.equal(page.draftTags.a.length, 10)
  assert.deepEqual([...page.pendingTags], [])
  assert.ok(notices.includes('每人最多选择 10 个印象'))
})

test('修改事件限制关联人数在一至十人', () => {
  const people = Array.from({ length: 11 }, (_, index) => ({ id: String(index), name: `人物${index}` }))
  const { page, notices } = loadPage('event', {})
  page.allPeople = people
  page.availableTags = []
  page.setData({ event: { id: 'e1', personIds: ['0'], text: '一次聚会', tagsByPerson: {} }, people: [people[0]] })
  page.edit()

  page.togglePersonLink({ currentTarget: { dataset: { id: '0' } } })
  assert.deepEqual(page.draftPersonIds, ['0'])
  assert.ok(notices.includes('至少关联一人'))

  for (const person of people.slice(1, 10)) page.togglePersonLink({ currentTarget: { dataset: { id: person.id } } })
  page.togglePersonLink({ currentTarget: { dataset: { id: '10' } } })
  assert.equal(page.draftPersonIds.length, 10)
  assert.ok(notices.includes('最多关联 10 人'))
})

test('快速记录最多关联十人且重复选择不增加数量', () => {
  const { page, notices } = loadPage('record', {})
  for (let i = 0; i < 10; i++) page.addMention({ id: String(i), name: String(i) })
  page.addMention({ id: '0', name: '0' })
  page.addMention({ id: '10', name: '10' })
  assert.equal(page.data.personIds.length, 10)
  assert.ok(notices.includes('已关联 10 人，请先移除一人'))
})

test('人物选择弹层可取消已选人物并腾出名额', () => {
  const people = Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `人物${i}` }))
  const { page } = loadPage('record', {})
  page.setData({ people })
  for (const person of people.slice(0, 10)) page.addMention(person)
  page.pickPerson({ currentTarget: { dataset: { id: '0' } } })
  assert.equal(page.data.personIds.length, 9)
  assert.equal(page.data.personIds.includes('0'), false)
  page.pickPerson({ currentTarget: { dataset: { id: '10' } } })
  assert.equal(page.data.personIds.length, 10)
  assert.equal(page.data.personIds.includes('10'), true)
})

test('新建人物保存中不会重复提交或关闭弹层', async () => {
  let finish
  let calls = 0
  const { page } = loadPage('people', {
    addPerson() { calls++; return new Promise(resolve => { finish = resolve }) },
    async load() { return { people: [], events: [] } }
  })
  page.setData({ showCreate: true, name: '小王' })
  const saving = page.savePerson()
  page.savePerson()
  page.hideCreate()
  assert.equal(calls, 1)
  assert.equal(page.data.showCreate, true)
  finish()
  await saving
  assert.equal(page.data.showCreate, false)
  assert.equal(page.data.creating, false)
})

test('批量删除请求进行中不会重复打开确认框或退出管理模式', async () => {
  let confirm
  let modalCount = 0
  let finishDelete
  const { page } = loadPage('people', {
    async load() { return { people: [{ id: 'a', name: '甲' }], events: [] } },
    deletePerson() { return new Promise(resolve => { finishDelete = resolve }) }
  }, { wx: { showModal(value) { modalCount++; confirm = value.success } } })
  page.setData({ managing: true, selectedIds: ['a'] })
  await page.deleteSelected()
  await page.deleteSelected()
  page.toggleManage()
  assert.equal(modalCount, 1)
  assert.equal(page.data.managing, true)
  const deleting = confirm({ confirm: true })
  await Promise.resolve()
  await page.deleteSelected()
  assert.equal(modalCount, 1)
  finishDelete()
  await deleting
  assert.equal(page.data.managing, false)
})

test('事件删除进行中不会重复提交，失败后允许重试', async () => {
  let confirm
  let modalCount = 0
  let finishDelete
  let failOnce = true
  const { page, notices } = loadPage('event', {
    deleteEvent() { return new Promise((resolve, reject) => { finishDelete = failOnce ? () => { failOnce = false; reject(new Error('network')) } : resolve }) }
  }, { wx: { showModal(value) { modalCount++; confirm = value.success }, navigateBack() {} } })
  page.eventId = 'e1'
  page.remove()
  page.remove()
  assert.equal(modalCount, 1)
  const first = confirm({ confirm: true })
  page.remove()
  assert.equal(modalCount, 1)
  finishDelete()
  await first
  assert.equal(page.data.deleting, false)
  assert.ok(notices.includes('删除失败，请重试'))
  page.remove()
  assert.equal(modalCount, 2)
  const second = confirm({ confirm: true })
  finishDelete()
  await second
})

test('事件编辑切后台回来后仍能保存原有草稿', async () => {
  const writes = []
  const { page } = loadPage('event', {
    async load() { return { people: [{ id: 'a', name: '甲' }], events: [{ id: 'e1', personId: 'a', text: '原文', date: '2026-10-03' }], tags: [] } },
    async updateEvent(id, data) { writes.push(data) }
  })
  page.eventId = 'e1'
  await page.refresh()
  page.edit()
  page.changeText({ detail: { value: '修改后的内容' } })
  await page.refresh()
  assert.equal(page.isDirty(), true)
  await page.save()
  assert.equal(writes[0].text, '修改后的内容')
})

test('两个编辑入口心情同步失败可重试，旧请求不能覆盖新请求状态', async () => {
  for (const name of ['record', 'event']) {
    const pending = []
    const { page } = loadPage(name, { saveMoods() { return new Promise((resolve, reject) => pending.push({ resolve, reject })) } })
    page.onMoodsChange({ detail: { moods: [{ name: '开心', color: '#111111' }] } })
    page.onMoodsChange({ detail: { moods: [{ name: '开心', color: '#222222' }] } })
    pending[0].reject(new Error('网络异常'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(page.data.moodSyncState, 'syncing')
    pending[1].reject(new Error('网络异常'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(page.data.moodSyncState, 'failed')
    const retry = page.retryMoodSync()
    pending[2].resolve({ ok: true })
    await retry
    assert.equal(page.data.moodSyncState, 'saved')
    assert.equal(page.data.moodList[0].color, '#222222')
  }
})

test('心情滑块拖动时只预览，松手才同步最终颜色', () => {
  const { component } = loadComponent('mood-manager')
  component.data.moods = [{ name: '开心', color: '#123456' }]
  component.reset()
  component.togglePalette({ currentTarget: { dataset: { idx: 0 } } })
  const event = value => ({ type: 'changing', currentTarget: { dataset: { kind: 'hue' } }, detail: { value } })
  component.onSlide(event(100))
  component.onSlide(event(120))
  assert.equal(component.events.change, undefined)
  component.onSlide({ ...event(130), type: 'change' })
  assert.equal(component.events.change.length, 1)
  assert.equal(component.events.change[0].moods[0].color, component.data.manage[0].color)
})

test('快速记录加载人物时区分加载、失败、重试和空数据', async () => {
  let finish, fail
  const { page } = loadPage('record', { load: () => new Promise((resolve, reject) => { finish = resolve; fail = reject }) })
  const first = page.refreshPeople()
  assert.equal(page.data.peopleLoading, true)
  fail(new Error('断网'))
  await first
  assert.equal(page.data.peopleLoading, false)
  assert.equal(page.data.loadFailed, true)
  const retry = page.refreshPeople()
  assert.equal(page.data.peopleLoading, true)
  assert.equal(page.data.loadFailed, false)
  finish({ people: [], events: [] })
  await retry
  assert.equal(page.data.peopleLoading, false)
  assert.equal(page.data.people.length, 0)
})

test('保存期间拒绝修改事件、快速记录和人物表单', () => {
  for (const name of ['event', 'record']) {
    const { page } = loadPage(name, {})
    page.setData({ saving: true, text: '已提交', mood: '开心' })
    page[name === 'event' ? 'changeText' : 'onTextInput']({ detail: { value: '迟到输入' } })
    page.onSpectrumChange({ detail: { mood: '难过' } })
    page.openPersonPicker()
    page.openMoodManager()
    assert.equal(page.data.text, '已提交')
    assert.equal(page.data.mood, '开心')
    assert.equal(page.data.pickerOpen, false)
    assert.equal(page.data.moodSheetOpen, false)
  }
  const { page } = loadPage('person-edit', {})
  page.setData({ saving: true, name: '甲', birthday: '2000-01-01' })
  page.change({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '乙' } })
  page.change({ currentTarget: { dataset: { field: 'birthday' } }, detail: { value: '2001-02-03' } })
  assert.equal(page.data.name, '甲')
  assert.equal(page.data.birthday, '2000-01-01')
})

test('人物日期可选择更新，非法长度不会静默保存', async () => {
  let writes = 0
  const { page } = loadPage('person-edit', { async updatePerson() { writes++ } })
  page.setData({ birthday: '2000-01-01', name: '甲', city: '长'.repeat(41) })
  assert.equal(page.clearDate, undefined)
  page.change({ currentTarget: { dataset: { field: 'birthday' } }, detail: { value: '2001-02-03' } })
  assert.equal(page.data.birthday, '2001-02-03')
  await page.save()
  assert.equal(writes, 0)
  assert.equal(page.data.focusField, 'city')
})

test('印象词保存成功立即更新列表和反馈，失败保留输入', async () => {
  const { page, notices } = loadPage('tags', { async saveTag() {}, async getTags() { throw new Error('不应依赖刷新') } })
  page.setData({ tags: [{ name: '可靠', active: true }] })
  await page.toggle({ currentTarget: { dataset: { name: '可靠' } } })
  assert.equal(page.data.tags[0].active, false)
  assert.ok(notices.includes('已停用'))
  const failed = loadPage('tags', { async saveTag() { throw new Error('断网') } })
  failed.page.setData({ name: '主动' })
  await failed.page.add()
  assert.equal(failed.page.data.name, '主动')
  assert.equal(failed.page.data.busy, false)
})

test('关闭心情弹层后保留未添加的名称和颜色', () => {
  const { component } = loadComponent('mood-manager')
  component.data.moods = [{ name: '开心', color: '#123456' }]
  component.reset()
  component.setData({ newMoodName: '期待', newMoodColor: '#654321' })
  component.close()
  component.reset()
  assert.equal(component.data.newMoodName, '期待')
  assert.equal(component.data.newMoodColor, '#654321')
})

test('印象弹窗按人物保留未添加输入，校验失败聚焦对应字段', async () => {
  const { page } = loadPage('event', {})
  page.setData({ event: { id: 'e1', personIds: ['a', 'b'], text: '原文' } })
  page.edit()
  page.openTagPickerFor({ currentTarget: { dataset: { id: 'a' } } })
  page.changeCustom({ detail: { value: '可靠' } })
  page.closeTagPicker()
  page.openTagPickerFor({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.customTag, '')
  page.closeTagPicker()
  page.openTagPickerFor({ currentTarget: { dataset: { id: 'a' } } })
  assert.equal(page.data.customTag, '可靠')
  const record = loadPage('record', {})
  await record.page.save()
  assert.equal(record.page.data.focusField, 'text')
})

test('心情按钮可选择和取消，保存时不会派发修改', () => {
  const { component } = loadComponent('mood-spectrum')
  component.setData({ value: '', disabled: false })
  const click = { currentTarget: { dataset: { name: '开心' } } }
  component.chooseMood(click)
  assert.equal(component.events.change[0].mood, '开心')
  component.setData({ value: '开心' })
  component.chooseMood(click)
  assert.equal(component.events.change[1].mood, '')
  component.setData({ disabled: true })
  component.chooseMood(click)
  assert.equal(component.events.change.length, 2)
})

test('印象改名合并已有词后列表一致，删除确认期间禁止再次操作', async () => {
  let confirm, count = 0
  const { page } = loadPage('tags', { async renameTag() {}, async deleteTag() {} }, { wx: { showModal(options) { count++; confirm = options.success } } })
  page.setData({ tags: [{ name: '可靠', active: true }, { name: '靠谱', active: false }], renaming: '可靠', newName: '靠谱' })
  await page.saveRename()
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.tags)), [{ name: '靠谱', active: true }])
  const event = { currentTarget: { dataset: { name: '靠谱' } } }
  page.remove(event)
  page.remove(event)
  assert.equal(count, 1)
  await confirm({ confirm: false })
  assert.equal(page.data.busy, false)
  page.remove(event)
  await confirm({ confirm: true })
  assert.equal(page.data.tags.length, 0)
})
