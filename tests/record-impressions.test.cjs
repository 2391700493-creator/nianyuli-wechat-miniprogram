const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function setup(overrides = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/record/record.js'), 'utf8'), {
    Page(value) { definition = value },
    require(id) { return id.endsWith('/store') ? { saveTag: async () => {}, renameTag: async () => {}, deleteTag: async () => {}, ...overrides } : require('../utils/moods') },
    wx: { hideKeyboard() {}, showToast() {} }, Date, setTimeout() {}
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(value, cb) { Object.assign(this.data, value); if (cb) cb() } }
  Object.assign(page.data, { peopleLoading: false, text: '尚未保存的正文', mood: '平静' })
  page.openPersonPicker()
  return page
}
test('多人印象分别保存，移除人物只清理该人物印象', () => {
  const page = setup()
  page.setData({ people: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }], tagList: [{ name: '体贴', active: true }, { name: '可靠', active: true }] })
  page.addMention(page.data.people[0]); page.addMention(page.data.people[1])
  page.openTagPicker()
  page.toggleImpression({ currentTarget: { dataset: { name: '体贴' } } })
  page.selectTagPerson({ currentTarget: { dataset: { id: 'b' } } })
  page.toggleImpression({ currentTarget: { dataset: { name: '可靠' } } })
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.tagsByPerson)), { a: ['体贴'], b: ['可靠'] })
  page.removeMention({ currentTarget: { dataset: { key: page.data.mentions[0].key } } })
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.tagsByPerson)), { b: ['可靠'] })
  assert.equal(page.data.text, '尚未保存的正文')
})
test('管理改名同步草稿，失败保留选择，返回继续选择', async () => {
  let fail = true
  const page = setup({ renameTag: async () => { if (fail) throw Error('offline') } })
  page.setData({ people: [{ id: 'a', name: '甲' }], tagList: [{ name: '体贴', active: true }] })
  page.addMention(page.data.people[0]); page.openTagPicker()
  page.toggleImpression({ currentTarget: { dataset: { name: '体贴' } } })
  page.openTagManager()
  page.startTagRename({ currentTarget: { dataset: { name: '体贴' } } })
  page.changeTagName({ detail: { value: '细心' } })
  await page.saveTagName()
  assert.equal(page.data.tagsByPerson.a[0], '体贴')
  fail = false; await page.saveTagName()
  assert.equal(page.data.tagsByPerson.a[0], '细心')
  page.closeTagManager()
  assert.equal(page.data.tagPickerOpen, true)
  assert.equal(page.data.text, '尚未保存的正文')
  assert.equal(page.data.mood, '平静')
})
test('没有关联人物时先选人，选印象不能绕过归属', () => {
  const page = setup()
  page.openTagPicker()
  assert.equal(page.data.pickerOpen, true)
  assert.equal(page.data.tagPickerOpen, false)
})
test('每人最多10个印象，重复点击可取消，清空只影响当前人物', () => {
  const page = setup()
  page.setData({ people: [{ id: 'a', name: '甲' }], tagList: Array.from({ length: 11 }, (_, i) => ({ name: '印象' + i, active: true })) })
  page.addMention(page.data.people[0]); page.openTagPicker()
  for (let i = 0; i < 11; i++) page.toggleImpression({ currentTarget: { dataset: { name: '印象' + i } } })
  assert.equal(page.data.tagsByPerson.a.length, 10)
  page.toggleImpression({ currentTarget: { dataset: { name: '印象0' } } })
  assert.equal(page.data.tagsByPerson.a.length, 9)
  page.clearImpressions()
  assert.equal(page.data.tagsByPerson.a.length, 0)
})
test('停用保留已选印象，新词保存成功后返回选择，草稿不变', async () => {
  const page = setup()
  page.setData({ people: [{ id: 'a', name: '甲' }], tagList: [{ name: '体贴', active: true }] })
  page.addMention(page.data.people[0]); page.openTagPicker()
  page.toggleImpression({ currentTarget: { dataset: { name: '体贴' } } })
  page.openTagManager()
  await page.toggleManagedTag({ currentTarget: { dataset: { name: '体贴' } } })
  assert.equal(page.data.tagsByPerson.a[0], '体贴')
  page.changeTagName({ detail: { value: '可靠' } }); await page.saveTagName()
  page.closeTagManager()
  assert.equal(page.data.tagOptions.some(tag => tag.name === '可靠'), true)
  assert.equal(page.data.tagOptions.find(tag => tag.name === '体贴').selected, true)
  assert.equal(page.data.text, '尚未保存的正文')
})

test('保存记录提交正文、情绪和各人物印象，不选择印象也可保存', async () => {
  const saved = []
  for (const choose of [true, false]) {
    const page = setup({ addEvent: async event => { saved.push(event); return { id: event.id } } })
    page.setData({ people: [{ id: 'a', name: '甲' }], tagList: [{ name: '体贴', active: true }] })
    page.addMention(page.data.people[0])
    if (choose) {
      page.openTagPicker()
      page.toggleImpression({ currentTarget: { dataset: { name: '体贴' } } })
      page.closeTagPicker()
    }
    await page.save()
  }
  assert.equal(saved.length, 2)
  assert.equal(saved[0].text, '尚未保存的正文')
  assert.equal(saved[0].mood, '平静')
  assert.equal(saved[0].tagsByPerson.a[0], '体贴')
  assert.equal(Object.keys(saved[1].tagsByPerson).length, 0)
})
