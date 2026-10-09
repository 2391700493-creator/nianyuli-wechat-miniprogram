const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function createApi() {
  let owner = 'me'
  const deletedFiles = []
  const rows = {
    people: [{ _id: 'p1', owner: 'me', name: '小王' }, { _id: 'p2', owner: 'me', name: '张三' }],
    events: [], tags: []
  }
  const db = {
    async runTransaction(fn) { return fn(db) },
    async createCollection(name) {
      if (rows[name]) throw new Error('集合已存在')
      rows[name] = []
    },
    collection(name) {
    const query = { filter: {}, offset: 0, max: 100,
      where(filter) { this.filter = filter; return this },
      orderBy() { return this },
      skip(n) { this.offset = n; return this },
      limit(n) { this.max = n; return this },
      async get() { if (!rows[name]) throw new Error('集合不存在'); return { data: rows[name].filter(row => Object.entries(this.filter).every(([key, value]) => row[key] === value)).slice(this.offset, this.offset + this.max) } },
      async add({ data }) { const _id = data._id || 'id' + (rows[name].length + 1); if (rows[name].some(row => row._id === _id)) throw new Error('duplicate'); rows[name].push({ _id, ...data }); return { _id } },
      doc(id) { return {
        async get() { return { data: rows[name].find(row => row._id === id) || null } },
        async set({ data }) {
          rows[name] = rows[name].filter(item => item._id !== id)
          rows[name].push({ _id: id, ...data })
        },
        async update({ data }) { const row = rows[name].find(item => item._id === id); Object.assign(row, data) },
        async remove() { rows[name] = rows[name].filter(item => item._id !== id) }
      } }
    }
    return query
  } }
  const cloud = { DYNAMIC_CURRENT_ENV: 'test', init() {}, database() { return db }, getWXContext() { return { OPENID: owner } }, async deleteFile({ fileList }) { deletedFiles.push(...fileList) } }
  const context = { exports: {}, require(name) { if (name === 'wx-server-sdk') return cloud; if (name === 'crypto') return require('node:crypto'); throw new Error(name) }, Date, Map, Set, String, Number, Array, Object, Error }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/guanyuApi/index.js'), 'utf8'), context)
  return { api: context.exports.main, rows, deletedFiles, setOwner(value) { owner = value } }
}

test('云函数保存心情、按人物更新印象并限制所有者', async () => {
  const { api, rows } = createApi()
  const result = await api({ action: 'addEvent', personIds: ['p1', 'p2'], text: '一起完成项目', mood: '开心', date: '2026-09-29' })
  assert.equal(rows.events[0].mood, '开心')
  await api({ action: 'updateEvent', eventId: result.id, text: '一起完成项目并庆祝', mood: '感动', tagsByPerson: { p1: ['主动'], p2: ['仗义'] } })
  assert.equal(rows.events[0].tagsByPerson.p1[0], '主动')
  rows.events[0].owner = 'other'
  await assert.rejects(api({ action: 'deleteEvent', eventId: result.id }), /事件不存在/)
})

test('云函数更新事件关联人物并清理已取消人物的印象', async () => {
  const { api, rows } = createApi()
  rows.people.push({ _id: 'p3', owner: 'me', name: '李四' })
  const result = await api({ action: 'addEvent', personIds: ['p1', 'p2'], text: '一起完成项目', mood: '', date: '2026-09-30' })

  await api({
    action: 'updateEvent', eventId: result.id, personIds: ['p2', 'p3'], text: '一起完成项目', mood: '',
    tagsByPerson: { p1: ['旧印象'], p2: ['可靠'], p3: ['主动'] }
  })

  assert.deepEqual([...rows.events[0].personIds], ['p2', 'p3'])
  assert.equal(rows.events[0].personId, 'p2')
  assert.deepEqual(JSON.parse(JSON.stringify(rows.events[0].tagsByPerson)), { p2: ['可靠'], p3: ['主动'] })
})

test('云函数更新事件拒绝无效关联人物', async () => {
  const { api, rows } = createApi()
  rows.people.push({ _id: 'other-person', owner: 'other', name: '其他人的人物' })
  const result = await api({ action: 'addEvent', personIds: ['p1'], text: '一次见面', mood: '', date: '2026-09-30' })

  await assert.rejects(api({ action: 'updateEvent', eventId: result.id, personIds: [], text: '一次见面', mood: '', tagsByPerson: {} }), /请选择关联人物/)
  await assert.rejects(api({ action: 'updateEvent', eventId: result.id, personIds: ['other-person'], text: '一次见面', mood: '', tagsByPerson: {} }), /人物不存在/)

  for (let i = 3; i <= 11; i++) rows.people.push({ _id: `p${i}`, owner: 'me', name: `人物${i}` })
  await assert.rejects(api({ action: 'updateEvent', eventId: result.id, personIds: rows.people.filter(person => person.owner === 'me').map(person => person._id), text: '一次见面', mood: '', tagsByPerson: {} }), /最多关联 10 人/)
  assert.deepEqual([...rows.events[0].personIds], ['p1'])
})

test('更换头像后删除旧云文件', async () => {
  const { api, rows, deletedFiles } = createApi()
  rows.people[0].avatarUrl = 'cloud://old-avatar'
  await api({ action: 'setPersonAvatar', personId: 'p1', avatarUrl: 'cloud://new-avatar' })
  assert.equal(rows.people[0].avatarUrl, 'cloud://new-avatar')
  assert.deepEqual(deletedFiles, ['cloud://old-avatar'])
})

test('云函数拒绝超过十人的记录而不截断关联', async () => {
  const { api, rows } = createApi()
  for (let i = 3; i <= 11; i++) rows.people.push({ _id: `p${i}`, owner: 'me', name: `人物${i}` })
  await assert.rejects(api({ action: 'addEvent', personIds: rows.people.map(person => person._id), text: '一次聚会', mood: '', date: '2026-09-30' }), /最多关联 10 人/)
  assert.equal(rows.events.length, 0)
})

test('心情配置能保存、替换、重新读取，且按用户隔离', async () => {
  const { api, rows, setOwner } = createApi()
  assert.deepEqual(JSON.parse(JSON.stringify((await api({ action: 'list' })).moods)), [])
  await api({ action: 'saveMoods', moods: [{ name: ' 放松 ', color: '#123456' }, { name: '放松', color: '#654321' }, { name: '无效', color: 'red' }] })
  assert.deepEqual(JSON.parse(JSON.stringify((await api({ action: 'list' })).moods)), [{ name: '放松', color: '#123456' }])
  await api({ action: 'saveMoods', moods: [{ name: '放松', color: '#ABCDEF' }] })
  assert.equal((await api({ action: 'list' })).moods[0].color, '#ABCDEF')
  await assert.rejects(api({ action: 'saveMoods', moods: [] }), /至少保留一个心情/)
  setOwner('other')
  assert.equal((await api({ action: 'list' })).moods.length, 0)
  await api({ action: 'saveMoods', moods: [{ name: '期待', color: '#654321' }] })
  setOwner('me')
  assert.equal((await api({ action: 'list' })).moods[0].name, '放松')
  assert.equal(rows.events.length, 0)
})

test('自定义心情可用于新建和编辑事件，删除选项后历史记录仍可编辑', async () => {
  const { api, rows } = createApi()
  await api({ action: 'saveMoods', moods: [{ name: '放松', color: '#123456' }] })
  const event = await api({ action: 'addEvent', personIds: ['p1'], text: '散步', mood: '放松', date: '2026-10-03' })
  await api({ action: 'updateEvent', eventId: event.id, text: '一起散步', mood: '放松' })
  await api({ action: 'saveMoods', moods: [{ name: '期待', color: '#654321' }] })
  await api({ action: 'updateEvent', eventId: event.id, text: '公园散步', mood: '放松' })
  assert.equal(rows.events[0].mood, '放松')
  await assert.rejects(api({ action: 'addEvent', personIds: ['p1'], text: '散步', mood: '放松', date: '2026-10-03' }), /心情选项无效/)
  await assert.rejects(api({ action: 'updateEvent', eventId: event.id, text: '散步', mood: '伪造心情' }), /心情选项无效/)
  await api({ action: 'updateEvent', eventId: event.id, text: '下次散步', mood: '期待' })
  assert.equal(rows.events[0].mood, '期待')
})


test('同一新建请求并发重试只创建一份，用户之间隔离', async () => {
  const { api, rows, setOwner } = createApi()
  for (const action of ['addPerson', 'addEvent']) {
    const request = { action, requestId: 'retry-123', name: '乙', text: '见面', date: '2026-10-03', personIds: ['p1'] }
    const [a, b] = await Promise.all([api(request), api(request)])
    assert.equal(a.id, b.id)
    const collection = action === 'addPerson' ? rows.people : rows.events
    assert.equal(collection.filter(row => row._id === a.id).length, 1)
  }
  setOwner('other')
  const other = await api({ action: 'addPerson', requestId: 'retry-123', name: '乙' })
  assert.equal(rows.people.find(row => row._id === other.id).owner, 'other')
})

test('晚到的旧心情请求不能覆盖新颜色', async () => {
  const { api } = createApi()
  await api({ action: 'saveMoods', revision: 200, moods: [{ name: '开心', color: '#222222' }] })
  await api({ action: 'saveMoods', revision: 100, moods: [{ name: '开心', color: '#111111' }] })
  assert.equal((await api({ action: 'list' })).moods[0].color, '#222222')
})

test('删除重试幂等，其他用户的记录仍不可删除', async () => {
  const { api, rows } = createApi()
  rows.events.push({ _id: 'owned', owner: 'me' }, { _id: 'foreign', owner: 'other' })
  await api({ action: 'deleteEvent', eventId: 'owned' })
  assert.equal((await api({ action: 'deleteEvent', eventId: 'owned' })).ok, true)
  await assert.rejects(api({ action: 'deleteEvent', eventId: 'foreign' }), /事件不存在/)
  await api({ action: 'deletePerson', personId: 'p1' })
  assert.equal((await api({ action: 'deletePerson', personId: 'p1' })).ok, true)
  await assert.rejects(api({ action: 'deleteEvent', eventId: '' }), /编号/)
})

test('接口拒绝错误日期、性别及超长词语，不写入非法字段', async () => {
  const { api, rows } = createApi()
  for (const date of ['', '2026-02-30', '2026-13-01', '2026/10/03']) {
    await assert.rejects(api({ action: 'addEvent', personIds: ['p1'], text: '见面', date }), /日期/)
  }
  assert.equal(rows.events.length, 0)
  await assert.rejects(api({ action: 'updatePerson', personId: 'p1', name: '甲', birthday: '2026-02-30' }), /日期/)
  await assert.rejects(api({ action: 'updatePerson', personId: 'p1', name: '甲', gender: '无效' }), /性别/)
  await assert.rejects(api({ action: 'saveTag', name: '一二三四五六七八九' }), /8/)
  assert.equal(rows.people[0].name, '小王')
  await api({ action: 'updatePerson', personId: 'p1', name: '甲', birthday: '2024-02-29', metDate: '', gender: '其他' })
  assert.equal(rows.people[0].birthday, '2024-02-29')
})

test('新建记录保存按人物归属的印象，仅保留关联人物并限制词数', async () => {
  const { api, rows } = createApi()
  await api({ action: 'addEvent', personIds: ['p1', 'p2'], text: '一起完成项目', mood: '', date: '2026-10-06', tagsByPerson: { p1: [' 主动 ', '主动'], p2: Array.from({ length: 12 }, (_, i) => '印象' + i), other: ['不应保存'] } })
  assert.deepEqual(JSON.parse(JSON.stringify(rows.events[0].tagsByPerson.p1)), ['主动'])
  assert.equal(rows.events[0].tagsByPerson.p2.length, 10)
  assert.equal(rows.events[0].tagsByPerson.other, undefined)
})
