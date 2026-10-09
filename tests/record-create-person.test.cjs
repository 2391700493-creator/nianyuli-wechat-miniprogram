const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function setup(addPerson) {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/record/record.js'), 'utf8'), {
    Page(value) { definition = value },
    require(id) { return id.endsWith('/store') ? { addPerson } : require('../utils/moods') },
    wx: { hideKeyboard() {}, showToast() {} }, Date
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(value, cb) { Object.assign(this.data, value); if (cb) cb() } }
  Object.assign(page.data, { peopleLoading: false, text: '尚未保存的正文', mood: '平静' })
  page.openPersonPicker()
  return page
}
test('创建人物成功后可直接选择，正文和情绪保留', async () => {
  const added = []
  const page = setup(async person => added.push(person))
  page.openPersonCreate()
  page.changePersonName({ detail: { value: ' 小林 ' } })
  await page.saveNewPerson()
  assert.equal(added[0].name, '小林')
  assert.equal(page.data.text, '尚未保存的正文')
  assert.equal(page.data.mood, '平静')
  assert.equal(page.data.pickerOpen, true)
  assert.equal(page.data.personCreateOpen, false)
  assert.equal(page.data.pickerPeople[0].id, added[0].id)
  page.pickPerson({ currentTarget: { dataset: { id: added[0].id } } })
  assert.equal(page.data.personIds[0], added[0].id)
})
test('取消和保存失败均保留记录草稿，失败可重试', async () => {
  let calls = 0
  const page = setup(async () => { if (++calls === 1) throw new Error('offline') })
  page.openPersonCreate()
  page.cancelPersonCreate()
  assert.equal(page.data.pickerOpen, true)
  assert.equal(page.data.text, '尚未保存的正文')
  page.openPersonCreate()
  page.changePersonName({ detail: { value: '小林' } })
  await page.saveNewPerson()
  assert.equal(page.data.personCreateOpen, true)
  assert.equal(page.data.newPersonName, '小林')
  assert.equal(page.data.text, '尚未保存的正文')
  assert.equal(page.data.mood, '平静')
  await page.saveNewPerson()
  assert.equal(page.data.people.length, 1)
})
test('创建中禁止重复提交和关闭，空名称不能创建', async () => {
  let finish, calls = 0
  const page = setup(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  page.openPersonCreate()
  await page.saveNewPerson()
  assert.equal(calls, 0)
  page.changePersonName({ detail: { value: '小林' } })
  const saving = page.saveNewPerson()
  await page.saveNewPerson()
  page.closePersonPicker()
  page.cancelPersonCreate()
  assert.equal(calls, 1)
  assert.equal(page.data.pickerOpen, true)
  assert.equal(page.data.personCreateOpen, true)
  finish()
  await saving
  assert.equal(page.data.text, '尚未保存的正文')
})
test('云端创建返回正式 ID，选择和关联使用云端人物 ID', async () => {
  const page = setup(async () => ({ id: 'cloud-person-id' }))
  page.openPersonCreate()
  page.changePersonName({ detail: { value: '小林' } })
  await page.saveNewPerson()
  assert.equal(page.data.pickerPeople[0].id, 'cloud-person-id')
  page.pickPerson({ currentTarget: { dataset: { id: 'cloud-person-id' } } })
  assert.equal(page.data.personIds[0], 'cloud-person-id')
  assert.equal(page.data.text, '尚未保存的正文')
})
