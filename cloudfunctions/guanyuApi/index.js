const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database({ throwOnNotFound: false })
const { createHash } = require('crypto')
const defaultTags = []
const defaultMoods = ['难过', '委屈', '生气', '平静', '开心', '感动']

// 云函数独立部署，输入约束与客户端 normalizeMoods 保持一致。
function normalizeMoods(list) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(list) ? list : []) {
    const name = String((item && item.name) || '').trim().slice(0, 4)
    const color = String((item && item.color) || '')
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(color) || seen.has(name)) continue
    seen.add(name)
    result.push({ name, color })
    if (result.length >= 12) break
  }
  return result
}

function validDate(value, optional = false) {
  if (optional && !value) return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期格式无效')
  const date = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('日期无效')
  return value
}
function tagName(value) {
  const name = String(value || '').trim()
  if (!name || name.length > 8) throw new Error('印象词需为 1 至 8 字')
  return name
}
async function absentOwned(collection, id, owner) {
  if (!id) throw new Error('缺少记录编号')
  const found = await db.collection(collection).where({ _id: id }).limit(1).get()
  if (found.data.length && found.data[0].owner !== owner) throw new Error(collection === 'people' ? '人物不存在' : '事件不存在')
  return { ok: true }
}

async function readMoodSettings(owner) {
  const read = () => db.collection('user_settings').where({ owner }).limit(1).get()
  let result
  try {
    result = await read()
  } catch (error) {
    // 兼容旧环境：首次使用时建集合。并发创建可能报告已存在，仍重新读取；
    // 权限或网络故障会继续抛出，不能伪装成空配置。
    try { await db.createCollection('user_settings') } catch (createError) {}
    result = await read()
  }
  return result.data[0] || {}
}

async function readMoods(owner) { return normalizeMoods((await readMoodSettings(owner)).moods) }

async function addOnce(collection, data, id) {
  try {
    const result = await db.collection(collection).add({ data: id ? { ...data, _id: id } : data })
    return { id: result._id }
  } catch (error) {
    if (id) {
      const found = await db.collection(collection).where({ _id: id, owner: data.owner }).limit(1).get()
      if (found.data.length) return { id }
    }
    throw error
  }
}

async function validateMood(mood, owner, previousMood) {
  if (!mood || (previousMood !== undefined && mood === previousMood)) return
  const saved = await readMoods(owner)
  const names = saved.length ? saved.map(item => item.name) : defaultMoods
  if (!names.includes(mood)) throw new Error('心情选项无效')
}
async function listAll(collection, owner, order) {
  const items = []
  while (true) {
    let query = db.collection(collection).where({ owner })
    if (order) query = query.orderBy(order, 'desc')
    const result = await query.skip(items.length).limit(100).get()
    items.push(...result.data)
    if (result.data.length < 100) return items
  }
}
async function validatePersonIds(values, owner) {
  const ids = [...new Set(values.map(id => String(id || '')).filter(Boolean))]
  if (!ids.length) throw new Error('请选择关联人物')
  if (ids.length > 10) throw new Error('最多关联 10 人')
  for (const id of ids) {
    const person = await db.collection('people').where({ _id: id, owner }).limit(1).get()
    if (!person.data.length) throw new Error('人物不存在')
  }
  return ids
}

exports.main = async (request) => {
  const owner = cloud.getWXContext().OPENID
  if (!owner) throw new Error('无法确认当前用户')
  const action = request.action
  let createId
  if ((action === 'addPerson' || action === 'addEvent') && request.requestId) {
    if (typeof request.requestId !== 'string' || request.requestId.length > 128) throw new Error('请求编号无效')
    createId = createHash('sha256').update(JSON.stringify([owner, action, request.requestId])).digest('hex').slice(0, 32)
    const collection = action === 'addPerson' ? 'people' : 'events'
    const found = await db.collection(collection).where({ _id: createId, owner }).limit(1).get()
    if (found.data.length) return { id: createId }
  }

  if (action === 'list') {
    const [people, events, tags, settings] = await Promise.all([
      listAll('people', owner), listAll('events', owner, 'createdAt'), listAll('tags', owner), readMoodSettings(owner)
    ])
    people.sort((a, b) => {
      const orderA = a.sortOrder === undefined ? Number.MAX_SAFE_INTEGER : a.sortOrder
      const orderB = b.sortOrder === undefined ? Number.MAX_SAFE_INTEGER : b.sortOrder
      return orderA - orderB || (a.createdAt || 0) - (b.createdAt || 0)
    })
    const byName = new Map(defaultTags.map(name => [name, { name, active: true }]))
    tags.forEach(tag => byName.set(tag.name, { name: tag.name, active: tag.active, deleted: !!tag.deleted }))
    return { people, events, moods: normalizeMoods(settings.moods), moodRevision: settings.revision || 0, tags: [...byName.values()].filter(tag => !tag.deleted) }
  }

  if (action === 'saveMoods') {
    const moods = normalizeMoods(request.moods)
    if (!moods.length) throw new Error('至少保留一个心情')
    await readMoods(owner)
    // 固定文档 ID，避免首次同时保存时产生多份配置；owner 只取微信上下文。
    const revision = request.revision === undefined ? Date.now() : request.revision
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('心情版本无效')
    return db.runTransaction(async transaction => {
      const doc = transaction.collection('user_settings').doc(owner)
      const { data } = await doc.get()
      if (data && data.revision > revision) return { ok: false, stale: true, revision: data.revision }
      await doc.set({ data: { owner, moods, revision } })
      return { ok: true }
    })
  }

  if (action === 'saveTag' || action === 'deleteTag') {
    const name = tagName(request.name)
    if (!name) throw new Error('词不能为空')
    const found = await db.collection('tags').where({ owner, name }).limit(1).get()
    const data = { active: action === 'saveTag' ? request.active !== false : false, deleted: action === 'deleteTag' }
    if (found.data.length) await db.collection('tags').doc(found.data[0]._id).update({ data })
    else await db.collection('tags').add({ data: { owner, name, ...data } })
    return { ok: true }
  }

  if (action === 'renameTag') {
    const oldName = tagName(request.oldName)
    const newName = tagName(request.newName)
    if (!oldName || !newName) throw new Error('词语不能为空')
    const old = await db.collection('tags').where({ owner, name: oldName }).limit(1).get()
    if (!old.data.length || old.data[0].deleted) throw new Error('印象词不存在')
    if (oldName === newName) return { ok: true }
    const events = await listAll('events', owner)
    const rename = list => [...new Set((list || []).map(tag => tag === oldName ? newName : tag))]
    for (const event of events) {
      const tags = rename(event.tags)
      const tagsByPerson = { ...(event.tagsByPerson || {}) }
      Object.keys(tagsByPerson).forEach(id => { tagsByPerson[id] = rename(tagsByPerson[id]) })
      if ((event.tags || []).includes(oldName) || Object.values(event.tagsByPerson || {}).some(list => Array.isArray(list) && list.includes(oldName))) {
        await db.collection('events').doc(event._id).update({ data: { tags, tagsByPerson } })
      }
    }
    const target = await db.collection('tags').where({ owner, name: newName }).limit(1).get()
    if (target.data.length) {
      await db.collection('tags').doc(target.data[0]._id).update({ data: { active: true, deleted: false } })
      await db.collection('tags').doc(old.data[0]._id).update({ data: { deleted: true, active: false } })
    } else await db.collection('tags').doc(old.data[0]._id).update({ data: { name: newName } })
    return { ok: true }
  }

  if (action === 'deletePerson') {
    const personId = String(request.personId || '')
    const person = await db.collection('people').where({ _id: personId, owner }).limit(1).get()
    if (!person.data.length) return absentOwned('people', personId, owner)
    const events = await listAll('events', owner)
    for (const event of events.filter(item => (item.personIds || [item.personId]).includes(personId))) {
      const remaining = (event.personIds || [event.personId]).filter(id => id !== personId)
      if (!remaining.length) await db.collection('events').doc(event._id).remove()
      else {
        const tagsByPerson = { ...(event.tagsByPerson || {}) }
        delete tagsByPerson[personId]
        await db.collection('events').doc(event._id).update({ data: { personIds: remaining, personId: remaining[0], tagsByPerson } })
      }
    }
    await db.collection('people').doc(personId).remove()
    if (person.data[0].avatarUrl) await cloud.deleteFile({ fileList: [person.data[0].avatarUrl] }).catch(() => {})
    return { ok: true }
  }

  if (action === 'addPerson') {
    const name = String(request.name || '').trim()
    if (name.length > 30) throw new Error('名字最多 30 字')
    const note = String(request.note || '').trim()
    if (note.length > 200) throw new Error('备注最多 200 字')
    if (!name) throw new Error('请输入名字')
    return addOnce('people', { owner, name, avatar: name.slice(0, 1), note, createdAt: Date.now() }, createId)
  }

  if (action === 'updatePerson') {
    const personId = String(request.personId || '')
    const found = await db.collection('people').where({ _id: personId, owner }).limit(1).get()
    if (!found.data.length) throw new Error('人物不存在')
    const name = String(request.name || '').trim()
    if (name.length > 30) throw new Error('名字最多 30 字')
    if (!name) throw new Error('请输入名字')
    const fields = ['note', 'gender', 'relation', 'work', 'city', 'birthday', 'metDate']
    const data = { name, avatar: name.slice(0, 1) }
    fields.forEach(field => {
      data[field] = String(request[field] || '').trim()
      if (data[field].length > (field === 'note' ? 200 : 40)) throw new Error('资料字段过长')
    })
    data.birthday = validDate(request.birthday, true)
    data.metDate = validDate(request.metDate, true)
    if (!['', '女', '男', '其他'].includes(data.gender)) throw new Error('性别选项无效')
    await db.collection('people').doc(personId).update({ data })
    return { ok: true }
  }

  if (action === 'setPersonAvatar') {
    const personId = String(request.personId || '')
    const avatarUrl = String(request.avatarUrl || '')
    if (!/^cloud:\/\//.test(avatarUrl)) throw new Error('图片地址无效')
    const person = await db.collection('people').where({ _id: personId, owner }).limit(1).get()
    if (!person.data.length) throw new Error('人物不存在')
    const previousAvatarUrl = person.data[0].avatarUrl
    await db.collection('people').doc(personId).update({ data: { avatarUrl } })
    if (previousAvatarUrl && previousAvatarUrl !== avatarUrl && /^cloud:\/\//.test(previousAvatarUrl)) {
      await cloud.deleteFile({ fileList: [previousAvatarUrl] }).catch(() => {})
    }
    return { ok: true }
  }

  if (action === 'addEvent') {
    const personIds = await validatePersonIds(Array.isArray(request.personIds) ? request.personIds : [request.personId], owner)
    const text = String(request.text || '').trim()
    if (text.length > 1000) throw new Error('事件最多 1000 字')
    if (!text) throw new Error('请写下发生的事')
    const mood = String(request.mood || '')
    await validateMood(mood, owner)
    const tagsByPerson = {}
    const inputTags = request.tagsByPerson || {}
    personIds.forEach(id => {
      tagsByPerson[id] = Array.isArray(inputTags[id]) ? [...new Set(inputTags[id].slice(0, 10).map(tag => String(tag).trim().slice(0, 8)).filter(Boolean))] : []
    })
    return addOnce('events', {
      owner, personId: personIds[0], personIds, text, mood, tagsByPerson,
      date: validDate(request.date), createdAt: Date.now()
    }, createId)
  }

  if (action === 'updateEvent' || action === 'deleteEvent') {
    const eventId = String(request.eventId || '')
    const found = await db.collection('events').where({ _id: eventId, owner }).limit(1).get()
    if (!found.data.length) {
      if (action === 'deleteEvent') return absentOwned('events', eventId, owner)
      throw new Error('事件不存在')
    }
    if (action === 'deleteEvent') {
      await db.collection('events').doc(eventId).remove()
      return { ok: true }
    }
    const text = String(request.text || '').trim()
    if (text.length > 1000) throw new Error('事件最多 1000 字')
    const mood = String(request.mood || '')
    if (!text) throw new Error('请写下发生的事')
    await validateMood(mood, owner, found.data[0].mood)
    const ids = await validatePersonIds(Array.isArray(request.personIds) ? request.personIds : found.data[0].personIds || [found.data[0].personId], owner)
    const input = request.tagsByPerson || {}
    const tagsByPerson = {}
    ids.forEach(id => {
      tagsByPerson[id] = Array.isArray(input[id]) ? [...new Set(input[id].slice(0, 10).map(tag => String(tag).trim().slice(0, 8)).filter(Boolean))] : []
    })
    await db.collection('events').doc(eventId).update({ data: { text, mood, personId: ids[0], personIds: ids, tagsByPerson, tags: [] } })
    return { ok: true }
  }

  if (action === 'reorderPeople') {
    const ids = Array.isArray(request.orderedIds) ? request.orderedIds.map(id => String(id)) : []
    if (!ids.length) throw new Error('排序列表为空')
    const people = await listAll('people', owner)
    const index = new Map(ids.map((id, i) => [id, i]))
    for (const person of people) {
      const order = index.get(person._id)
      if (order === undefined || person.sortOrder === order) continue
      await db.collection('people').doc(person._id).update({ data: { sortOrder: order } })
    }
    return { ok: true }
  }

  throw new Error('不支持的操作')
}
