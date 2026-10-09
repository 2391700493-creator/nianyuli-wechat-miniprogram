const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function page(name, store, app = { globalData: { recordsPersonId: '' } }) {
  let instance
  const guards = []
  const notices = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../pages/${name}/${name}.js`), 'utf8'), {
    Page: value => { instance = value },
    require: id => id === '../../utils/store' ? store : require(path.resolve(__dirname, '../pages', name, id)),
    wx: { enableAlertBeforeUnload() { guards.push(true) }, disableAlertBeforeUnload() { guards.push(false) }, hideKeyboard() {}, showToast(v) { notices.push(v.title) }, setNavigationBarTitle() {} },
    getApp: () => app, setTimeout, clearTimeout
  })
  instance.setData = (patch, done) => { Object.assign(instance.data, patch); if (done) done() }
  instance.getTabBar = () => null
  return { instance, guards, notices }
}
const fixture = () => ({ people: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], events: [{ id: 'e', personId: 'a', text: '散步', date: '2026-10-03', mood: '期待' }], moods: [{ name: '期待', color: '#123456' }] })

test('人物资料与事件仅在实际改动时提醒，改回原值后解除', async () => {
  const store = { load: async () => fixture() }
  const person = page('person-edit', store)
  person.instance.personId = 'a'
  await person.instance.refresh()
  assert.equal(person.guards.at(-1), false)
  person.instance.change({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '新名字' } })
  assert.equal(person.guards.at(-1), true)
  person.instance.change({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '甲' } })
  assert.equal(person.guards.at(-1), false)
  const event = page('event', store)
  event.instance.eventId = 'e'
  await event.instance.refresh()
  event.instance.edit()
  assert.equal(event.guards.at(-1), false)
  event.instance.changeText({ detail: { value: '修改内容' } })
  assert.equal(event.guards.at(-1), true)
  event.instance.changeText({ detail: { value: '散步' } })
  assert.equal(event.guards.at(-1), false)
})

test('排序落库后再搜索和清除搜索仍保留顺序，保存中禁止二次拖拽', async () => {
  let resolve
  const { instance } = page('people', { reorderPeople: () => new Promise(r => { resolve = r }) })
  instance.cache = fixture()
  instance.applyFilter()
  instance.data.people.reverse()
  instance.drag = { moved: true }
  instance.dragStartOrder = ['a', 'b']
  instance.onCardTouchEnd()
  instance.onCardLongPress({ currentTarget: { dataset: { id: 'a' } }, touches: [{ clientX: 0, clientY: 0 }] })
  assert.equal(instance.pendingDrag, null)
  resolve()
  await new Promise(r => setImmediate(r))
  instance.search({ detail: { value: '甲' } })
  instance.clearSearch()
  assert.deepEqual(Array.from(instance.data.people, p => p.id), ['b', 'a'])
})

test('词库同步失败保留失败项，重试仅提交失败项', async () => {
  let fail = true
  const calls = []
  const { instance } = page('event', { saveTag: async name => { calls.push(name); if (name === '可靠' && fail) throw Error('断网') } })
  instance.failedTags = ['主动', '可靠']
  await instance.retryTagSync()
  assert.equal(instance.data.tagSyncFailed, true)
  assert.deepEqual(Array.from(instance.failedTags), ['可靠'])
  fail = false
  await instance.retryTagSync()
  assert.equal(instance.data.tagSyncFailed, false)
  assert.deepEqual(calls, ['主动', '可靠', '可靠'])
})

test('人物入口清除旧搜索日期，刷新移除失效人物并使用自定义情绪色', async () => {
  const app = { globalData: { recordsPersonId: 'a' } }
  const { instance } = page('all-records', { load: async () => fixture() }, app)
  instance.setData({ keyword: '不相关', startDate: '2099-01-01', endDate: '2099-02-01' })
  instance.onShow()
  await new Promise(r => setImmediate(r))
  assert.equal(instance.data.keyword, '')
  assert.equal(instance.data.startDate, '')
  assert.equal(instance.data.events.length, 1)
  assert.equal(instance.data.events[0].moodColor, '#123456')
  instance.setData({ selectedPeople: ['deleted'] })
  await instance.refresh()
  assert.equal(instance.data.selectedPeople.length, 0)
  assert.equal(instance.data.filteredCount, 1)
})

test('超长印象词不会被截短或提交', async () => {
  let calls = 0
  const { instance, notices } = page('tags', { saveTag: async () => calls++ })
  instance.setData({ name: '一二三四五六七八九' })
  await instance.add()
  assert.equal(calls, 0)
  assert.match(notices.at(-1), /8/)
})

test('头像响应超时但已保存时核对恢复，无法确认时也不删除文件', async () => {
  for (const confirmed of [true, false]) {
    const removed = []
    let result
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/store.js'), 'utf8'), {
      module: { get exports() { return result }, set exports(v) { result = v } },
      require: id => id === '../config/cloud' ? { envId: 'cloud' } : require(path.resolve(__dirname, '../utils', id)),
      setTimeout, clearTimeout,
      wx: { getStorageSync() {}, setStorageSync() {}, cloud: {
        uploadFile: async () => ({ fileID: 'cloud://new' }),
        deleteFile: async v => removed.push(...v.fileList),
        callFunction: async ({ data }) => {
          if (data.action === 'setPersonAvatar' || !confirmed) throw Error('超时')
          return { result: { people: [{ _id: 'a', avatarUrl: 'cloud://new' }], events: [] } }
        }
      } }
    })
    if (confirmed) assert.equal(await result.updatePersonAvatar('a', '/temp.jpg'), 'cloud://new')
    else await assert.rejects(result.updatePersonAvatar('a', '/temp.jpg'), /超时/)
    assert.equal(removed.length, 0)
  }
})

test('重试已保存词库不会提前提交当前事件草稿中的新词', async () => {
  const calls = []
  const { instance } = page('event', { saveTag: async name => calls.push(name) })
  instance.failedTags = ['可靠']
  instance.pendingTags = ['尚未保存']
  await instance.retryTagSync()
  assert.deepEqual(calls, ['可靠'])
  assert.deepEqual(Array.from(instance.pendingTags), ['尚未保存'])
})
