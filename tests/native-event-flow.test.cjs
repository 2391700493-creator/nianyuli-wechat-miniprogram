const assert = require('node:assert/strict')
const test = require('node:test')
const { personIds, tagsFor, allTags } = require('../utils/events')
const memory = {}
require.cache[require.resolve('../config/cloud')] = { exports: { envId: '' } }
global.wx = { getStorageSync: key => memory[key], setStorageSync: (key, value) => { memory[key] = structuredClone(value) } }
const store = require('../utils/store')
test('事件按人物保存印象，编辑和删除同步到本地记录', async () => {
  const created = await store.addEvent({ id: 'multi-test', personId: 'wang', personIds: ['wang', 'zhang'], date: '2026-09-29', text: '一起完成项目', mood: '开心', tagsByPerson: {} })
  assert.equal(created.id, 'multi-test')
  await store.updateEvent(created.id, { text: '一起完成项目并庆祝', mood: '感动', tagsByPerson: { wang: ['主动'], zhang: ['仗义'] }, tags: [] })
  const event = (await store.load()).events.find(item => item.id === created.id)
  assert.deepEqual(personIds(event), ['wang', 'zhang'])
  assert.deepEqual(tagsFor(event, 'wang'), ['主动'])
  assert.deepEqual(tagsFor(event, 'zhang'), ['仗义'])
  assert.deepEqual(allTags(event), ['主动', '仗义'])
  await store.saveTag('主动', true)
  await store.renameTag('主动', '主动帮忙')
  const renamed = (await store.load()).events.find(item => item.id === created.id)
  assert.deepEqual(tagsFor(renamed, 'wang'), ['主动帮忙'])
  await store.deleteEvent(created.id)
  assert.equal((await store.load()).events.some(item => item.id === created.id), false)
})

test('本地事件更新会按最新关联人物清理旧印象', async () => {
  const created = await store.addEvent({
    id: 'relink-local-test', personId: 'wang', personIds: ['wang', 'zhang'], date: '2026-09-30',
    text: '一起聚餐', mood: '', tagsByPerson: { wang: ['主动'], zhang: ['可靠'] }
  })

  await store.updateEvent(created.id, {
    text: '一起聚餐', mood: '', personId: 'zhang', personIds: ['wang', 'li'],
    tagsByPerson: { wang: ['主动'], zhang: ['可靠'], li: ['坦诚'] }, tags: []
  })

  const event = (await store.load()).events.find(item => item.id === created.id)
  assert.deepEqual(event.personIds, ['wang', 'li'])
  assert.equal(event.personId, 'wang')
  assert.deepEqual(event.tagsByPerson, { wang: ['主动'], li: ['坦诚'] })
  await store.deleteEvent(created.id)
})

test('本地事件更新拒绝无效关联人物', async () => {
  const created = await store.addEvent({ id: 'invalid-relink-local-test', personId: 'wang', personIds: ['wang'], date: '2026-09-30', text: '一次见面', mood: '', tagsByPerson: {} })

  await assert.rejects(store.updateEvent(created.id, { personIds: [], tagsByPerson: {} }), /请选择关联人物/)
  await assert.rejects(store.updateEvent(created.id, { personIds: ['missing'], tagsByPerson: {} }), /人物不存在/)
  await assert.rejects(store.updateEvent(created.id, { personIds: Array.from({ length: 11 }, (_, index) => String(index)), tagsByPerson: {} }), /最多关联 10 人/)

  const event = (await store.load()).events.find(item => item.id === created.id)
  assert.deepEqual(event.personIds, ['wang'])
  await store.deleteEvent(created.id)
})
