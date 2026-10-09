const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function loadStore(callFunction, envId = 'test-env') {
  const timers = new Map()
  const memory = {}
  const context = {
    module: { exports: {} },
    require: name => name === '../config/cloud' ? { envId } : require(path.resolve(__dirname, '../utils', name)),
    wx: {
      cloud: { callFunction },
      getStorageSync: key => memory[key],
      setStorageSync: (key, value) => { memory[key] = value }
    },
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/store.js'), 'utf8'), context)
  return { store: context.module.exports, timers }
}

test('云端数据从 SDK 返回的 result 中读取，首页可以显示人物和记录', async () => {
  const { store } = loadStore(async () => ({
    errMsg: 'cloud.callFunction:ok', requestID: 'test-request',
    result: {
      people: [{ _id: 'p1', name: '小王' }],
      events: [{ _id: 'e1', personId: 'p1', date: '2026-10-03', text: '一起吃饭' }],
      tags: [], moods: []
    }
  }))
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/home/home.js'), 'utf8'), {
    require: name => name === '../../utils/store' ? store : require(path.resolve(__dirname, '../pages/home', name)),
    Page: definition => { page = definition }
  })
  page.setData = patch => Object.assign(page.data, patch)
  await page.refresh()
  assert.equal(page.data.loadFailed, false)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.peopleCount, 1)
  assert.equal(page.data.eventCount, 1)
  assert.equal(page.data.groups[0].events[0].id, 'e1')
  assert.equal(page.data.groups[0].events[0].person, '小王')
})

test('云端新建记录返回真实 id，供保存后跳转详情', async () => {
  const { store } = loadStore(async () => ({ result: { id: 'cloud-event-id' } }))
  assert.equal((await store.addEvent({ text: '一起吃饭' })).id, 'cloud-event-id')
})

test('云请求成功或失败后释放超时计时器', async () => {
  for (const fail of [false, true]) {
    const { store, timers } = loadStore(async () => {
      if (fail) throw new Error('网络断开')
      return { result: { id: 'e1' } }
    })
    if (fail) await assert.rejects(store.addEvent({}), /网络断开/)
    else await store.addEvent({})
    assert.equal(timers.size, 0)
  }
})

test('云请求无响应时仍会超时报错', async () => {
  const { store, timers } = loadStore(() => new Promise(() => {}))
  const pending = store.load()
  const rejected = assert.rejects(pending, /云函数调用超时/)
  for (const callback of timers.values()) callback()
  await rejected
})

test('云端异常数据仍被拒绝', async () => {
  const { store } = loadStore(async () => ({ result: { people: null, events: [] } }))
  await assert.rejects(store.load(), /云函数返回数据格式异常/)
})

test('本地心情配置可以清洗并持久保存', async () => {
  const { store } = loadStore(null, '')
  await store.saveMoods([{ name: ' 放松 ', color: '#123456' }, { name: '', color: '#123456' }])
  const { moods } = await store.load()
  assert.equal(moods.length, 1)
  assert.equal(moods[0].name, '放松')
  assert.equal(moods[0].color, '#123456')
})

test('新建请求失败重试沿用编号，成功后相同内容可再次新建', async () => {
  for (const action of ['addEvent', 'addPerson']) {
    const requests = []
    const { store } = loadStore(async ({ data }) => {
      requests.push(data)
      if (requests.length === 1) throw new Error('请求超时')
      return { result: { id: 'saved' } }
    })
    await assert.rejects(store[action]({ id: 'local1', name: '甲', text: '见面' }))
    await store[action]({ id: 'local2', name: '甲', text: '见面' })
    await store[action]({ id: 'local3', name: '甲', text: '见面' })
    assert.ok(requests[0].requestId)
    assert.equal(requests[0].requestId, requests[1].requestId)
    assert.notEqual(requests[1].requestId, requests[2].requestId)
  }
})

test('连续心情修改串行合并，失败草稿可重载并重试', async () => {
  const pending = []
  const { store } = loadStore(({ data }) => {
    if (data.action === 'list') return Promise.resolve({ result: { people: [], events: [], moods: [] } })
    return new Promise((resolve, reject) => pending.push({ data, resolve, reject }))
  })
  const a = store.saveMoods([{ name: '开心', color: '#111111' }])
  const b = store.saveMoods([{ name: '开心', color: '#222222' }])
  const c = store.saveMoods([{ name: '开心', color: '#333333' }])
  assert.equal(pending.length, 1)
  pending[0].resolve({ result: { ok: true } })
  await a
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  assert.equal(pending[1].data.moods[0].color, '#333333')
  const rejected = Promise.allSettled([b, c])
  pending[1].reject(new Error('断网'))
  await rejected
  const data = await store.load()
  assert.equal(data.moodsPending, true)
  assert.equal(data.moods[0].color, '#333333')
  const retry = store.saveMoods(data.moods)
  pending[2].resolve({ result: { ok: true } })
  await retry
  assert.equal((await store.load()).moodsPending, false)
})

test('新建超时后原请求晚完成，重试仍携带同一编号', async () => {
  const requests = []
  let finishFirst
  const { store, timers } = loadStore(({ data }) => {
    requests.push(data)
    if (requests.length === 1) return new Promise(resolve => { finishFirst = resolve })
    return Promise.resolve({ result: { id: 'same-cloud-id' } })
  })
  const first = store.addEvent({ id: 'e1', text: '散步' })
  const rejection = assert.rejects(first, /超时/)
  for (const timer of [...timers.values()]) timer()
  await rejection
  finishFirst({ result: { id: 'same-cloud-id' } })
  const retry = await store.addEvent({ id: 'e2', text: '散步' })
  assert.equal(retry.id, 'same-cloud-id')
  assert.equal(requests[0].requestId, requests[1].requestId)
})
