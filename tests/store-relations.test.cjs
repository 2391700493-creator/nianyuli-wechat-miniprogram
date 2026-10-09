const assert = require('node:assert/strict')
const test = require('node:test')
const memory = {}
require.cache[require.resolve('../config/cloud')] = { exports: { envId: '' } }
global.wx = {
  getStorageSync: key => memory[key],
  setStorageSync: (key, value) => { memory[key] = structuredClone(value) }
}
const store = require('../utils/store')
test('删除人物只解除多人事件中的该人物关联', async () => {
  await store.addEvent({ id: 'shared', personId: 'wang', personIds: ['wang', 'zhang'], date: '2026-09-29', text: '一起完成一件事', tags: [] })
  await store.addEvent({ id: 'solo', personId: 'wang', personIds: ['wang'], date: '2026-09-29', text: '单人事件', tags: [] })
  await store.deletePerson('wang')
  const data = await store.load()
  assert.equal(data.people.some(person => person.id === 'wang'), false)
  assert.deepEqual(data.events.find(event => event.id === 'shared').personIds, ['zhang'])
  assert.equal(data.events.some(event => event.id === 'solo'), false)
})
