const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
function home(load) {
  let page
  const calls = []
  const app = { globalData: { recordsPersonId: 'old-filter' } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/home/home.js'), 'utf8'), {
    require: name => name.endsWith('/store') ? { load } : require(path.join(root, 'pages/home', name)),
    Page: value => { page = value },
    wx: { navigateTo: value => calls.push(['navigateTo', value.url]), switchTab: value => calls.push(['switchTab', value.url]) },
    getApp: () => app
  })
  page.setData = patch => Object.assign(page.data, patch)
  page.getTabBar = () => ({ setData: value => calls.push(['tab', value.selected]) })
  return { page, calls, app }
}
const data = { people: [{ id:'a', name:'小A' }, { id:'b', name:'小B' }], events: [{ id:'e', date:'2026-10-04', text:'一起讨论', personIds:['a','b'], tagsByPerson:{a:['愿意沟通','坦诚'],b:['细心']}, mood:'平静' }], moods: [] }
test('首页按人物展示各自印象，空印象与旧数据兼容', async () => {
  const { page } = home(async () => data)
  await page.refresh()
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.groups[0].events[0].impressions)), [{id:'a',name:'小A',text:'愿意沟通 · 坦诚'},{id:'b',name:'小B',text:'细心'}])
  const legacy = home(async () => ({people:data.people,events:[{id:'old',date:'2026-10-03',personId:'a',text:'旧记录',tags:['靠谱']}]})).page
  await legacy.refresh()
  assert.equal(legacy.data.groups[0].events[0].impressions[0].text, '靠谱')
  const empty = home(async () => ({people:data.people,events:[{id:'none',date:'2026-10-03',personIds:['a','b'],text:'未填印象',tagsByPerson:{a:['主动']}}]})).page
  await empty.refresh()
  assert.equal(empty.data.groups[0].events[0].impressions[1].text, '尚未补充')
})
test('首页所有业务入口使用正确路由类型并保留跨页状态', () => {
  const { page, calls, app } = home(async () => data)
  page.record(); page.allPeople(); page.addPerson(); page.allRecords()
  page.openEvent({currentTarget:{dataset:{id:'e'}}}); page.openPerson({currentTarget:{dataset:{id:'a'}}})
  assert.deepEqual(calls, [['navigateTo','/pages/record/record'],['switchTab','/pages/people/people'],['switchTab','/pages/people/people'],['switchTab','/pages/all-records/all-records'],['navigateTo','/pages/event/event?id=e'],['navigateTo','/pages/person/person?id=a']])
  assert.equal(app.globalData.openPersonCreate, true)
  assert.equal(app.globalData.recordsPersonId, null)
  const config = JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
  for (const [type,url] of calls) {
    const route = url.split('?')[0].slice(1)
    assert.ok(config.pages.includes(route), route)
    assert.equal(config.tabBar.list.some(item => item.pagePath === route), type === 'switchTab')
    for (const ext of ['js','wxml','wxss','json']) assert.ok(fs.existsSync(path.join(root, `${route}.${ext}`)))
  }
  const markup=fs.readFileSync(path.join(root,'pages/home/home.wxml'),'utf8')
  for (const handler of ['record','allPeople','addPerson','allRecords','openEvent','openPerson','retryLoad']) assert.ok(markup.includes(`bindtap="${handler}"`),handler)
})
test('首页返回刷新、失败恢复和零数据状态保留', async () => {
  let fail=true
  const {page,calls}=home(async()=>{if(fail)throw new Error('offline');return data})
  await page.onShow(); assert.equal(page.data.loadFailed,true); assert.equal(page.data.loading,false)
  fail=false; await page.onShow(); assert.equal(page.data.loadFailed,false); assert.equal(page.data.eventCount,1); assert.equal(page.data.peopleCount,2)
  assert.equal(calls[0][1],1)
  const blank=home(async()=>({people:[],events:[]})).page
  await blank.refresh(); assert.equal(blank.data.loading,false); assert.equal(blank.data.groups.length,0)
})
