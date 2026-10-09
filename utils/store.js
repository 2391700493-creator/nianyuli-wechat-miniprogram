const KEY = 'guanyu-data-v1'
const cloud = require('../config/cloud')
const { validDate, tagName } = require('./validation')
const { normalizeMoods } = require('./moods')
const defaultTags = []
const CREATE_PENDING_KEY = 'guanyu-pending-creates-v1'
const MOOD_PENDING_KEY = 'guanyu-pending-moods-v1'
const MOOD_REVISION_KEY = 'guanyu-mood-revision-v1'
let moodQueue = null
let moodRunning = false

// 未确认的同内容新建沿用编号；本地临时 id 每次点击可能变化，不参与匹配。
async function createOnce(action, input) {
  const { id, ...payload } = input
  const key = action + ':' + JSON.stringify(payload)
  const pending = wx.getStorageSync(CREATE_PENDING_KEY) || {}
  const requestId = pending[key] || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  pending[key] = requestId
  wx.setStorageSync(CREATE_PENDING_KEY, pending)
  const result = await call(action, { ...payload, requestId })
  if (!result || !result.id) throw new Error('创建结果未确认，请重试')
  const latest = wx.getStorageSync(CREATE_PENDING_KEY) || {}
  if (latest[key] === requestId) delete latest[key]
  wx.setStorageSync(CREATE_PENDING_KEY, latest)
  return result
}

// 同时只发送一份配置，等待期间的修改合并为最后一份。
async function flushMoodQueue() {
  if (moodRunning) return
  moodRunning = true
  try {
    while (moodQueue) {
      const job = moodQueue
      moodQueue = null
      try {
        const result = await call('saveMoods', { moods: job.moods, revision: job.revision })
        if (!result || !result.ok) {
          if (result && result.revision) wx.setStorageSync(MOOD_REVISION_KEY, result.revision)
          throw new Error('心情同步未确认，请重试')
        }
        const pending = wx.getStorageSync(MOOD_PENDING_KEY)
        if (pending && pending.revision === job.revision) wx.setStorageSync(MOOD_PENDING_KEY, null)
        job.waiters.forEach(waiter => waiter.resolve(result))
      } catch (error) {
        job.waiters.forEach(waiter => waiter.reject(error))
      }
    }
  } finally { moodRunning = false }
}

const initial = {
  people: [
    { id: 'wang', name: '小王', avatar: '王', note: '大学室友 · 现在同一家公司' },
    { id: 'zhang', name: '张三', avatar: '张', note: '前同事 · 一起做过一个项目' },
    { id: 'li', name: '李四', avatar: '李', note: '熟人 · 见面点头的交情' }
  ],
  events: [
    { id: 'e1', personId: 'wang', date: '2026-09-28', score: 4, text: '小王答应帮我，却连续两次爽约。', tags: ['有时爽约'] },
    { id: 'e2', personId: 'zhang', date: '2026-09-25', score: 5, text: '聚餐时张三替我解围。', tags: ['仗义'] },
    { id: 'e3', personId: 'li', date: '2026-09-25', score: 5, text: '聚餐时李四一直在旁边嘲讽我。', tags: ['不尊重人'] },
    { id: 'e4', personId: 'wang', date: '2026-08-25', score: 5, text: '我失业那阵子，小王主动借钱给我。', tags: ['主动', '真诚'] },
    { id: 'e5', personId: 'wang', date: '2026-07-28', score: 4, text: '我搬家那天，他提前一小时到，还自己带了工具。', tags: ['主动'] },
    { id: 'e6', personId: 'wang', date: '2026-06-20', score: 3, text: '约好周末打球，他当天临时说有事来不了。', tags: ['有时爽约'] }
  ]
}

function read() {
  const value = wx.getStorageSync(KEY)
  return value && Array.isArray(value.people) && Array.isArray(value.events) ? value : initial
}
function save(data) { wx.setStorageSync(KEY, data) }
// 云函数无响应时结束等待，让页面能够显示失败并重试。
const CALL_TIMEOUT = 8000
async function call(action, data = {}) {
  let timer
  try {
    const response = await Promise.race([
      wx.cloud.callFunction({ name: 'guanyuApi', data: { action, ...data } }),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('云函数调用超时')), CALL_TIMEOUT)
      })
    ])
    return response.result
  } finally {
    clearTimeout(timer)
  }
}
async function load() {
  if (!cloud.envId) {
    const data = read()
    return {
      ...data,
      tags: (data.tags || defaultTags.map(name => ({ name, active: true }))).filter(tag => !tag.deleted),
      moods: data.moods || []
    }
  }
  const result = await call('list')
  // 云函数异常返回时 result 可能为 null 或缺字段，这里兜住避免下游 .map 抛错
  if (!result || !Array.isArray(result.people) || !Array.isArray(result.events)) {
    throw new Error('云函数返回数据格式异常')
  }
  if (result.moodRevision) wx.setStorageSync(MOOD_REVISION_KEY, Math.max(Number(wx.getStorageSync(MOOD_REVISION_KEY)) || 0, result.moodRevision))
  const pendingMoods = wx.getStorageSync(MOOD_PENDING_KEY)
  return {
    people: result.people.map(item => ({ ...item, id: item._id })),
    events: result.events.map(item => ({ ...item, id: item._id })),
    tags: result.tags || defaultTags.map(name => ({ name, active: true })),
    moods: pendingMoods ? pendingMoods.moods : result.moods || [],
    moodsPending: Boolean(pendingMoods)
  }
}
// 整体保存用户心情表（至少 1 个，上限/去重/格式在 normalizeMoods 内约束）
async function saveMoods(list) {
  const moods = normalizeMoods(list)
  if (!moods.length) throw new Error('至少保留一个心情')
  if (cloud.envId) {
    const revision = Math.max(Date.now(), (Number(wx.getStorageSync(MOOD_REVISION_KEY)) || 0) + 1)
    wx.setStorageSync(MOOD_REVISION_KEY, revision)
    wx.setStorageSync(MOOD_PENDING_KEY, { moods, revision })
    return new Promise((resolve, reject) => {
      const waiters = moodQueue ? moodQueue.waiters : []
      waiters.push({ resolve, reject })
      moodQueue = { moods, revision, waiters }
      flushMoodQueue()
    })
  }
  const data = read()
  data.moods = moods
  save(data)
}
async function getTags() {
  const data = await load()
  return data.tags || defaultTags.map(name => ({ name, active: true }))
}
async function saveTag(name, active) {
  name = tagName(name)
  if (cloud.envId) return call('saveTag', { name, active })
  const data = read()
  const tags = data.tags || defaultTags.map(value => ({ name: value, active: true }))
  const tag = tags.find(item => item.name === name)
  if (tag) { tag.active = active; tag.deleted = false }
  else tags.push({ name, active })
  data.tags = tags
  save(data)
}
async function deleteTag(name) {
  if (cloud.envId) return call('deleteTag', { name })
  const data = read()
  const tags = data.tags || defaultTags.map(value => ({ name: value, active: true }))
  const tag = tags.find(item => item.name === name)
  if (tag) { tag.active = false; tag.deleted = true }
  data.tags = tags
  save(data)
}
async function renameTag(oldName, newName) {
  oldName = tagName(oldName); newName = tagName(newName)
  if (cloud.envId) return call('renameTag', { oldName, newName })
  const data = read()
  const tags = data.tags || defaultTags.map(name => ({ name, active: true }))
  const old = tags.find(item => item.name === oldName && !item.deleted)
  if (!old) throw new Error('印象词不存在')
  if (oldName !== newName) {
    const target = tags.find(item => item.name === newName)
    if (target) { target.active = true; target.deleted = false; old.deleted = true }
    else old.name = newName
    data.events.forEach(event => {
      const rename = list => [...new Set((list || []).map(tag => tag === oldName ? newName : tag))]
      event.tags = rename(event.tags)
      if (event.tagsByPerson) Object.keys(event.tagsByPerson).forEach(id => { event.tagsByPerson[id] = rename(event.tagsByPerson[id]) })
    })
  }
  data.tags = tags
  save(data)
}
async function deletePerson(personId) {
  if (cloud.envId) return call('deletePerson', { personId })
  const data = read()
  const person = data.people.find(item => item.id === personId)
  if (!person) return { ok: true }
  data.people = data.people.filter(item => item.id !== personId)
  data.events = data.events.filter(event => {
    const ids = event.personIds || [event.personId]
    if (!ids.includes(personId)) return true
    event.personIds = ids.filter(id => id !== personId)
    event.personId = event.personIds[0] || ''
    if (event.tagsByPerson) delete event.tagsByPerson[personId]
    return event.personIds.length > 0
  })
  save(data)
  if (person.avatarUrl && wx.removeSavedFile) {
    await new Promise(resolve => wx.removeSavedFile({ filePath: person.avatarUrl, success: resolve, fail: resolve }))
  }
}
async function addEvent(event) {
  if (cloud.envId) return createOnce('addEvent', event)
  const data = read()
  validDate(event.date)
  data.events.unshift(event)
  save(data)
  return { id: event.id }
}
async function updateEvent(eventId, updates) {
  if (cloud.envId) return call('updateEvent', { eventId, ...updates })
  const data = read()
  const event = data.events.find(item => item.id === eventId)
  if (!event) throw new Error('事件不存在')
  if (Array.isArray(updates.personIds)) {
    const ids = [...new Set(updates.personIds.map(id => String(id)).filter(Boolean))]
    if (!ids.length) throw new Error('请选择关联人物')
    if (ids.length > 10) throw new Error('最多关联 10 人')
    if (ids.some(id => !data.people.some(person => person.id === id))) throw new Error('人物不存在')
    const inputTags = updates.tagsByPerson || {}
    const tagsByPerson = {}
    ids.forEach(id => { tagsByPerson[id] = Array.isArray(inputTags[id]) ? inputTags[id].slice() : [] })
    updates = { ...updates, personId: ids[0], personIds: ids, tagsByPerson }
  }
  Object.assign(event, updates)
  save(data)
}
async function deleteEvent(eventId) {
  if (cloud.envId) return call('deleteEvent', { eventId })
  const data = read()
  if (!data.events.some(item => item.id === eventId)) return { ok: true }
  data.events = data.events.filter(item => item.id !== eventId)
  save(data)
}
async function addPerson(person) {
  if (cloud.envId) return createOnce('addPerson', person)
  const data = read()
  data.people.push(person)
  save(data)
}
async function updatePerson(personId, updates) {
  if (cloud.envId) return call('updatePerson', { personId, ...updates })
  const data = read()
  const person = data.people.find(item => item.id === personId)
  if (!person) throw new Error('人物不存在')
  for (const key of ['birthday', 'metDate']) if (key in updates) validDate(updates[key], true)
  if ('gender' in updates && !['', '女', '男', '其他'].includes(updates.gender)) throw new Error('性别选项无效')
  Object.assign(person, updates)
  person.avatar = updates.name.slice(0, 1)
  save(data)
}
async function updatePersonAvatar(personId, tempFilePath) {
  if (cloud.envId) {
    const extension = (tempFilePath.match(/\.(jpe?g|png|webp)(?:\?|$)/i) || [null, 'jpg'])[1].toLowerCase()
    const upload = await wx.cloud.uploadFile({
      cloudPath: `avatars/${personId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`,
      filePath: tempFilePath
    })
    try {
      await call('setPersonAvatar', { personId, avatarUrl: upload.fileID })
    } catch (error) {
      // 超时不代表写入失败；核对成功可恢复，无法确认时保留文件。
      try {
        const latest = await load()
        if (latest.people.some(person => person.id === personId && person.avatarUrl === upload.fileID)) return upload.fileID
      } catch (verifyError) {}
      throw error
    }
    return upload.fileID
  }

  const savedFilePath = await new Promise((resolve, reject) => {
    wx.saveFile({ tempFilePath, success: result => resolve(result.savedFilePath), fail: reject })
  })
  const data = read()
  const person = data.people.find(item => item.id === personId)
  if (!person) throw new Error('人物不存在')
  const previousAvatarUrl = person.avatarUrl
  person.avatarUrl = savedFilePath
  save(data)
  if (previousAvatarUrl && previousAvatarUrl !== savedFilePath && wx.removeSavedFile) {
    await new Promise(resolve => wx.removeSavedFile({ filePath: previousAvatarUrl, success: resolve, fail: resolve }))
  }
  return savedFilePath
}
async function reorderPeople(orderedIds) {
  if (cloud.envId) return call('reorderPeople', { orderedIds })
  const data = read()
  const index = new Map(orderedIds.map((id, i) => [id, i]))
  data.people.sort((a, b) => (index.has(a.id) ? index.get(a.id) : orderedIds.length) - (index.has(b.id) ? index.get(b.id) : orderedIds.length))
  save(data)
}
module.exports = { load, getTags, saveTag, deleteTag, renameTag, saveMoods, deletePerson, addEvent, updateEvent, deleteEvent, addPerson, updatePerson, updatePersonAvatar, reorderPeople }
