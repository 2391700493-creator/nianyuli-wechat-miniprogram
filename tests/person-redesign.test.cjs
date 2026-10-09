const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
function setup(events = [], remove = async () => {}) {
  let page, modal
  let prompts = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/person/person.js'), 'utf8'), {
    require: name => name.endsWith('/store') ? { load: async () => ({ people: [{id:'p', name:'林夏'}], events }), deletePerson: remove } : require(path.resolve(__dirname, '../pages/person', name)),
    Page: value => { page = value },
    wx: {setNavigationBarTitle() {}, showModal(value) {modal = value; prompts++}, showLoading() {}, hideLoading() {}, showToast() {}, navigateBack() {}},
    setTimeout() {}
  })
  page.setData = patch => Object.assign(page.data, patch)
  page.onLoad({id:'p'})
  return {page, modal: () => modal, prompts: () => prompts}
}
test('人物记录完整展示并按日期排序，筛选不影响总数', async () => {
  const events = Array.from({length:12}, (_,i) => ({id:String(i),personId:'p',date:`2020-01-${String(i+1).padStart(2,'0')}`,text:'记录',tags:i===0?['细心']:['真诚']}))
  const {page} = setup(events)
  await page.refresh()
  assert.equal(page.data.totalCount,12)
  assert.equal(page.data.events.length,12)
  assert.equal(page.data.events[0].id,'11')
  const last = page.data.lastNumber
  page.showTags(['细心'])
  assert.equal(page.data.events.length,1)
  assert.equal(page.data.totalCount,12)
  assert.equal(page.data.lastNumber,last)
  page.clearTags()
  assert.equal(page.data.events.length,12)
})
test('人物无记录与未来记录的统计可读', async () => {
  const empty=setup().page
  await empty.refresh()
  assert.equal(empty.data.lastUnit,'暂无记录')
  const future=setup([{id:'f',personId:'p',date:'2999-01-01',text:'未来'}]).page
  await future.refresh()
  assert.equal(future.data.lastUnit,'天后')
  assert.ok(Number(future.data.lastNumber)>0)
})
test('删除弹窗与提交防重复，取消不删除，失败可以重试', async () => {
  let count=0
  const state=setup([], async()=>{count++;throw new Error('offline')})
  state.page.deletePerson();state.page.deletePerson()
  assert.equal(state.prompts(),1)
  await state.modal().success({confirm:false})
  assert.equal(count,0)
  state.page.deletePerson()
  await state.modal().success({confirm:true})
  assert.equal(count,1)
  assert.equal(state.page.data.deleting,false)
  state.page.deletePerson()
  assert.equal(state.prompts(),3)
})
