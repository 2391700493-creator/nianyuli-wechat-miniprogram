const test = require('node:test')
const assert = require('node:assert/strict')
const sm = require('../utils/starmap')

/**
 * 造 n 个人，事件数逐渐减少。
 * 用 0.6 衰减贴近真实分布：产品只服务 2-8 个重要人物（需求 §3），
 * 真实数据里绝大多数人是「有一两条记录」的疏远关系，少数很近。
 */
function makePeople(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + i,
    name: '人' + i,
    avatar: String(i),
    tone: 'neu',
    count: Math.max(2, Math.round(100 * Math.pow(0.6, i)))
  }))
}

/** 按目标圈层数造数据：事件数决定远近 */
function makeByRing(counts) {
  const out = []
  for (let ri = 0; ri < 3; ri++) {
    for (let i = 0; i < counts[ri]; i++) {
      out.push({
        id: `r${ri}_${i}`,
        name: '人' + (i + 1),
        avatar: String(i),
        tone: 'neu',
        count: ri === 0 ? 100 + i * 3 : ri === 1 ? 30 + i * 2 : 5 + i
      })
    }
  }
  return out
}

/** 无出界、无重叠、坐标不重复、且真的落在各自圈周上 */
function assertClean(stars, label) {
  for (const s of stars) {
    assert.ok(sm.inCanvas(s), `${label} ${s.name} 出界`)
  }
  for (let i = 0; i < stars.length; i++) {
    assert.ok(sm.onItsRing(stars[i]),
      `${label} ${stars[i].name} 不在 ring${stars[i].ring} 圆周上`)
    for (let j = i + 1; j < stars.length; j++) {
      assert.ok(!sm.collides(stars[i], stars[j]),
        `${label} ${stars[i].name}↔${stars[j].name} 相撞`)
    }
  }
  const keys = new Set(stars.map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)}`))
  assert.equal(keys.size, stars.length, `${label} 有人占同一坐标`)
}

/** 人数守恒：画出 + 隐藏 = 输入总数，一个都不能丢 */
function assertNoLoss(result, total, label) {
  assert.equal(result.stars.length + result.hidden, total, `${label} 人数丢失`)
}

test('空数据不崩', () => {
  const r = sm.build([])
  assert.deepEqual(r.stars, [])
  assert.equal(r.hidden, 0)
  assert.ok(r.center.x > 0)
  assert.equal(sm.build(null).stars.length, 0)
  assert.equal(sm.build(undefined).stars.length, 0)
})

test('非对象元素被过滤（防御误传分组后的二维数组）', () => {
  const r = sm.build([[{ id: 'a', count: 100 }], [], [], null, undefined, 'x'])
  assert.equal(r.stars.length, 0, '二维数组里的元素不是人物，应被过滤掉')
})

test('单人：不出界，在圆周上', () => {
  const r = sm.build(makePeople(1))
  assert.equal(r.stars.length, 1)
  assert.equal(r.hidden, 0)
  assertClean(r.stars, '单人')
})

test('2 人：目标区间下限，圈层不塌', () => {
  const r = sm.build(makePeople(2))
  assert.equal(r.hidden, 0)
  assert.equal(r.stars.length, 2)
  assertClean(r.stars, '2人')
})

test('3 人：现状算法会分出 1/2/0 让外圈空掉，本实现不会出现「比例造成的空圈」', () => {
  const r = sm.build(makeByRing([1, 1, 1]))
  // 旧算法：inner=ceil(3*0.25)=1，mid=1+ceil(3*0.4)=1+2=3 → 1/2/0，外圈空
  const counts = r.rings.map(x => x.count)
  assert.notDeepEqual(counts, [1, 2, 0], '不应退化成比例算法的 1/2/0')
  assert.equal(counts.reduce((a, b) => a + b, 0), r.stars.length, '各圈人数之和 = 画出总数')
  assertClean(r.stars, '3人')
})

test('2-9 人：产品目标区间，全部画出、无重叠', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const r = sm.build(makePeople(n))
    assert.equal(r.hidden, 0, `${n} 人不该有人被隐藏`)
    assertNoLoss(r, n, `${n}人`)
    assertClean(r.stars, `${n}人`)
  }
})

test('10 人：主用例，用满三圈，超出容量的隐藏而非重叠', () => {
  const r = sm.build(makePeople(10))
  assertNoLoss(r, 10, '10人')
  const used = r.rings.filter(x => x.count > 0).length
  assert.equal(used, 3, '10 人应能用满三圈')
  // 每圈最多四人，超出总容量的人可在下方列表查看
  r.rings.forEach((ring, i) => {
    assert.ok(ring.count <= sm.CAP[i], `${ring.name} 摆了 ${ring.count} 人，超出容量 ${sm.CAP[i]}`)
  })
  assertClean(r.stars, '10人')
})

test('12+ 人：超出容量时隐藏而非重叠，人数守恒', () => {
  for (const n of [12, 15, 20, 30]) {
    const r = sm.build(makePeople(n))
    assertNoLoss(r, n, `${n}人`)
    assertClean(r.stars, `${n}人`)
  }
})

test('每圈 5 人（15 人最坏分布）：能用满三圈', () => {
  const r = sm.build(makeByRing([5, 5, 5]))
  assertNoLoss(r, 15, '5/5/5')
  assertClean(r.stars, '5/5/5')
  assert.equal(r.rings.filter(x => x.count > 0).length, 3, '5/5/5 应能用满三圈')
})

test('每圈 6 人（18 人极端分布）：几何仍合法', () => {
  const r = sm.build(makeByRing([6, 6, 6]))
  assertNoLoss(r, 18, '6/6/6')
  assertClean(r.stars, '6/6/6')
})

test('分档按事件数排名，不按绝对阈值：真实数据下内圈也该有人', () => {
  // 真实场景：产品只服务 2-8 个重要人物，绝大多数只有 0-2 条记录。
  // 旧的绝对阈值（>=40 内圈 / >=20 中圈）会把这些 score 全部判进外圈，
  // 内圈永远空着 —— 这正是「所有人都被推到外围」的根因。
  const real = [3, 2, 2, 1, 0].map((n, i) => ({ id: 'p' + i, name: '人' + i, avatar: '', tone: 'neu', count: n }))
  const groups = sm.assignRings(real)
  assert.ok(groups[0].length >= 1, '内圈至少要有一个人')
  assert.equal(groups[0][0].count, 3, '记录最多的必须在内圈')
  // 内圈最少的记录数也不能低于中圈最多的记录数。
  const minMid = Math.min(...groups[1].map(p => p.count))
  const maxMid = Math.max(...groups[1].map(p => p.count))
  const minInner = Math.min(...groups[0].map(p => p.count))
  const maxOuter = Math.max(...groups[2].map(p => p.count))
  assert.ok(minInner >= maxMid, '内圈记录数应 ≥ 中圈')
  assert.ok(minMid >= maxOuter, '中圈记录数应 ≥ 外圈')
})

test('同记录数超过内圈容量时分散到三圈，十人全部显示', () => {
  const people = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: '人物' + i, count: 2, score: 2 }))
  const result = sm.build(people)
  assert.equal(result.stars.length, 10)
  assert.equal(result.hidden, 0)
  assert.equal(result.rings.filter(r => r.count).length, 3)
  assertClean(result.stars, '同记录数')
})

test('内圈保底 1 人：只有一个人时他一定站在你身边', () => {
  const r = sm.build(makePeople(1))
  assert.equal(r.stars.length, 1)
  assert.equal(r.stars[0].ring, 0, '唯一的人应在内圈')
})

test('每人一名：5 人真实分布时内圈有人、外圈不空', () => {
  const real = [3, 2, 2, 1, 0].map((n, i) => ({ id: 'p' + i, name: '人' + i, avatar: String(i), tone: 'neu', count: n }))
  const r = sm.build(real)
  assert.ok(r.rings[0].count >= 1, '内圈不该空着')
  assert.equal(r.rings[0].count, r.stars.length ? r.rings[0].count : 0)
  assert.ok(r.stars.filter(s => s.ring === 0).length >= 1, '至少一人在内圈')
  assertClean(r.stars, '5人真实分布')
})

test('起始角：沿用原版每圈固定起始角，偶数多偏半步', () => {
  // 原版 people.js：内圈 180°、中圈 270°、外圈 10°
  const R = 200
  for (let ri = 0; ri < 3; ri++) {
    const odd = sm.startAngle(5, ri)
    const even = sm.startAngle(4, ri)
    assert.ok(Math.abs(even - odd - Math.PI / 4) < 1e-6,
      `ring${ri} 偶数应比奇数多半步（π/4）`)
  }
  // 半步偏移后位置确实不同
  const a = sm.place(sm.startAngle(4, 0), R, 0, 0)
  const b = sm.place(sm.startAngle(5, 0), R, 0, 0)
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1, '偏移后位置应不同')
})

test('碰撞判定：头像圆、名字矩形、头像 vs 对方名字都要算', () => {
  const base = { x: 600, y: 300, size: 76, ring: 0, id: 'a', name: '甲' }
  // 远离 → 不碰
  assert.equal(sm.collides(base, { ...base, id: 'b', x: 900, y: 300 }), false)
  // 头像叠一起 → 碰
  assert.equal(sm.collides(base, { ...base, id: 'b', x: 620, y: 300 }), true)
  // 头像不碰但名字压住（横向 80、纵向差大于头像和）
  const nameHit = { ...base, id: 'c', x: base.x + 70, y: base.y + 70 }
  const d = Math.hypot(nameHit.x - base.x, nameHit.y - base.y)
  assert.ok(d > (base.size + nameHit.size) / 2 + sm.MIN_GAP, '构造的前提：头像不碰')
  assert.equal(sm.collides(base, nameHit), true, '名字矩形重叠应判定为相撞')
})

test('onItsRing 守住「半径/角度失效导致全堆一点」这类 bug', () => {
  const r = sm.build(makePeople(8))
  for (const s of r.stars) {
    const radius = Math.hypot(s.x - sm.CENTER.x, s.y - sm.CENTER.y)
    assert.ok(Math.abs(radius - sm.RING_R[s.ring]) < 1,
      `${s.name} 半径 ${radius.toFixed(1)}，应为 ${sm.RING_R[s.ring]}`)
  }
})

test('恢复原版固定形态：画布即视口，不缩放', () => {
  assert.equal(sm.CANVAS.w, sm.VIEW.w, '画布应与视口同宽（原版无横向拖动）')
  assert.equal(sm.CANVAS.h, 720, '画布高度与 wxss .map 的 720rpx 一致')
  assert.equal(sm.SCALE, 1, '不做缩放，恢复原版观感')
  assert.equal(sm.CENTER.x, 335, '圆心 x 与原版一致')
  assert.equal(sm.CENTER.y, 350, '圆心 y 与原版一致')
})

test('不同圈层的头像按由内到外的次序排列', () => {
  const result = sm.build(makePeople(9))
  const radii = result.stars.map(s => Math.hypot(s.x - sm.CENTER.x, s.y - sm.CENTER.y))
  for (let i = 1; i < radii.length; i++) assert.ok(radii[i] >= radii[i - 1] - 0.01)
})

test('三圈头像统一尺寸（圈层靠圆线区分，不靠大小）', () => {
  const r = sm.build(makePeople(8))
  const sizes = new Set(r.stars.map(s => s.size))
  assert.equal(sizes.size, 1, `头像尺寸应统一，实际有 ${[...sizes].join('/')} 三种`)
  assert.equal([...sizes][0], r.size)
})

test('初始 scrollLeft 把画布居中，负值归零', () => {
  assert.equal(sm.initialScrollLeft(1200, 670), 265)
  assert.equal(sm.initialScrollLeft(670, 1200), 0, '画布比视口窄时不产生负 scroll')
  assert.equal(sm.initialScrollLeft(1200, 1200), 0)
  assert.ok(Number.isInteger(sm.initialScrollLeft(1201, 670)), '应返回整数，避免半像素抖动')
})

test('超长名字按 NAME_MAX_W 夹住，不撑破画布', () => {
  const long = [
    { id: 'a', name: '陈嘉宜的妹妹', avatar: '陈', tone: 'neu', count: 100 },
    { id: 'b', name: '欧阳', avatar: '欧', tone: 'neu', count: 60 },
    { id: 'c', name: '张三', avatar: '张', tone: 'neu', count: 30 }
  ]
  const r = sm.build(long)
  assertClean(r.stars, '长名字')
  for (const s of r.stars) {
    const halfName = sm.extentOf(s).right - s.x
    assert.ok(halfName <= sm.NAME_MAX_W / 2 + 0.5,
      `${s.name} 名字超出 NAME_MAX_W(${sm.NAME_MAX_W})，实际半宽 ${halfName.toFixed(1)}`)
  }
})

test('性能：单次布局在 1ms 量级（页面 onShow 同步调用，不能卡）', () => {
  for (const n of [2, 8, 10, 20, 30]) {
    const t = Date.now()
    for (let i = 0; i < 20; i++) sm.build(makePeople(n))
    const per = (Date.now() - t) / 20
    assert.ok(per < 10, `${n} 人布局耗时 ${per.toFixed(1)}ms，超出 10ms 预算`)
  }
})

/* ===== 人物页集成 ===== */

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

/** SelectorQuery 桩：rects 为 null 时模拟节点尚未渲染 */
function createSelectorQueryStub(rects) {
  const chain = {
    select() { return chain },
    selectAll() { return chain },
    boundingClientRect() { return chain },
    exec(cb) { if (cb) cb(rects || [null, null]) }
  }
  return () => chain
}

function loadPeoplePage(store, wxExtra = {}) {
  let definition
  const context = {
    Page(value) { definition = value },
    require(id) {
      if (id === '../../utils/store') return store
      if (id === '../../utils/events') return require('../utils/events')
      if (id === '../../utils/moods') return require('../utils/moods')
      if (id === '../../utils/starmap') return require('../utils/starmap')
      throw new Error('未 mock 的模块: ' + id)
    },
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {},
      createSelectorQuery: createSelectorQueryStub(),
      getStorageSync() { return true },
      setStorageSync() {},
      ...wxExtra
    },
    getApp: () => ({ globalData: {} }),
    Date, Map, Set, Math, JSON
  }
  const file = path.join(__dirname, '../pages/people/people.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context)
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values, cb) { Object.assign(this.data, values); if (cb) cb() },
    getTabBar() { return null }
  }
  page.data.loading = false
  return page
}

const SAMPLE = {
  people: [
    { id: 'a', name: '刘', avatar: '刘' },
    { id: 'b', name: '王王王', avatar: '王' },
    { id: 'c', name: '张伟', avatar: '张' }
  ],
  events: [
    { id: 'e1', personId: 'a', date: '2026-10-02', text: '刘说想去成都', tags: ['主动', '真诚'] },
    { id: 'e2', personId: 'a', date: '2026-09-01', text: '刘又爽约了', tags: ['有时爽约', '主动'] },
    { id: 'e3', personId: 'b', date: '2026-10-01', text: '一起吃火锅', tags: ['靠谱'] }
  ]
}

test('页面：星图生成，默认选中记录最多的人', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()

  assert.equal(page.data.stars.length, 3)
  assert.equal(page.data.hidden, 0)
  assert.equal(page.data.center.x, page.data.canvasW / 2, '中心黑点在画布正中')
  assert.equal(page.data.activeId, 'a', '刘记录最多，应默认选中')
  assert.equal(page.data.activePerson.name, '刘')
  // 原版固定形态：画布与视口同宽，不缩放
  assert.equal(page.data.canvasW, sm.CANVAS.w, '画布宽度应与 starmap 配置一致')
  assert.equal(page.data.scale, 1, '不做缩放')
})

test('页面：档案摘要带印象词及支撑条数', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()

  const liu = page.data.people.find(p => p.id === 'a')
  const byName = Object.fromEntries(liu.tagList.map(t => [t.name, t.n]))
  assert.equal(byName['主动'], 2, '「主动」2 条支撑')
  assert.equal(byName['真诚'], 1)
  assert.equal(liu.tagList[0].name, '主动', '支撑最多的排最前')
  assert.ok(liu.tagList.length <= 4, '最多 4 个')
})

test('页面：点星图只切摘要不跳档案，卡片才跳', () => {
  const navigated = []
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store, { navigateTo(v) { navigated.push(v.url) } })
  page.cache = SAMPLE
  page.applyFilter()

  page.selectStar({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.activeId, 'b')
  assert.equal(navigated.length, 0, '点星图不跳转')

  page.goPerson({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(navigated.length, 1)
  assert.match(navigated[0], /person\?id=b/)
})

test('页面：搜索后星图与选中态同步收敛', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()

  page.setData({ query: '王' })
  page.applyFilter()
  assert.equal(page.data.stars.length, 1, '星图只留匹配的人')
  assert.equal(page.data.activeId, 'b')
})

test('页面：搜索无结果时星图为空且不报错', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()

  page.setData({ query: '不存在' })
  page.applyFilter()
  assert.equal(page.data.stars.length, 0)
  assert.equal(page.data.activeId, '')
  assert.equal(page.data.activePerson, null)
})

test('页面：恢复固定形态后不再做 scroll-left 换算', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()

  // 画布与视口同宽 → 没有横向拖动空间，也就不需要实测像素换算
  assert.equal(page.data.canvasW, sm.CANVAS.w)
  assert.equal(page.data.canvasW, sm.VIEW.w, '画布应与视口同宽')
  assert.equal(page.data.scrollLeft, undefined, '不再下发 scrollLeft')
  assert.equal(typeof page.syncScrollLeft, 'undefined', 'syncScrollLeft 已移除')
})

test('页面：管理态可切换（星图横向滚动随之关闭）', () => {
  const store = { async load() { return SAMPLE } }
  const page = loadPeoplePage(store)
  page.cache = SAMPLE
  page.applyFilter()
  assert.equal(page.data.managing, false)
  page.toggleManage()
  assert.equal(page.data.managing, true)
  page.toggleManage()
  assert.equal(page.data.managing, false)
})

test('页面：圈名标签已从界面移除（用户不该看到分圈规则）', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxss'), 'utf8')
  assert.ok(!wxml.includes('ring-label'), 'wxml 不该再渲染走得近/常来往/渐远了')
  assert.ok(!wxss.includes('.ring-label'), 'wxss 里的 .ring-label 死样式应一并清掉')
})

test('样式：＋按钮固定贴右，不被文字长短挤走', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxss'), 'utf8')
  const addRule = wxss.split('\n').find(l => l.trim().startsWith('.ar-add {'))
  assert.ok(addRule, '.ar-add 规则应存在')
  assert.match(addRule, /margin-left:\s*auto/, '＋按钮需要 margin-left:auto 才能始终贴右')
  assert.match(addRule, /flex:\s*none/, '＋按钮自身不能被压缩')
})

test('距离只取决于事件总数，忽略过时的衰减分数', () => {
  const result = sm.build([
    { id: 'few', name: '少', count: 1, score: 100 },
    { id: 'many', name: '多', count: 20, score: 0.01 },
    { id: 'none', name: '无', count: 0, score: 200 }
  ])
  const radius = id => { const s = result.stars.find(s => s.id === id); return Math.hypot(s.x - 335, s.y - 350) }
  assert.ok(radius('many') < radius('few'))
  assert.ok(radius('few') < radius('none'))
})

test('同记录数的星图位置不随档案手工排序改变', () => {
  const people = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: '人' + i, count: 2 }))
  const positions = list => sm.build(list).stars.map(s => [s.id, s.x, s.y]).sort()
  assert.deepEqual(positions(people), positions(people.slice().reverse()))
})

test('真实尺寸下头像名字完整可见，并且避开中心的我', () => {
  for (const n of [1, 3, 5, 10, 15, 20]) {
    const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: '这是一个非常长的人物姓名' + i, count: n - i }))
    const result = sm.build(people)
    assert.ok(result.stars.length >= Math.min(n, 10), `${n} 人至少显示前十位`)
    for (const s of result.stars) {
      assert.equal(s.size, 76, '不能靠假缩小来通过碰撞检测')
      const halfW = 72
      assert.ok(s.x - halfW >= 0 && s.x + halfW <= 670, `${s.name} 名字横向被裁切`)
      assert.ok(s.y - 38 >= 0 && s.y + 68 <= 720, `${s.name} 纵向被裁切`)
      assert.ok(Math.hypot(s.x - 335, s.y - 350) >= 102, '头像遮挡我')
      const nearX = Math.max(s.x - halfW, Math.min(335, s.x + halfW))
      const nearY = Math.max(s.y + 44, Math.min(350, s.y + 68))
      assert.ok(Math.hypot(nearX - 335, nearY - 350) >= 58, '名字遮挡我')
    }
    assertClean(result.stars, '真实尺寸')
  }
})

test('页面：较早的多条记录仍比今天的一条记录近', () => {
  const page = loadPeoplePage({})
  page.cache = {
    people: [{ id: 'many', name: '多' }, { id: 'few', name: '少' }],
    events: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: 'old' + i, personId: 'many', date: '2020-01-01' })),
      { id: 'new', personId: 'few', date: '2099-01-01' }
    ]
  }
  page.applyFilter()
  assert.equal(page.data.activeId, 'many')
  assert.ok(page.data.stars.find(s => s.id === 'many').ring < page.data.stars.find(s => s.id === 'few').ring)
})

test('页面：搜索不改变人物原来的远近和位置', () => {
  const page = loadPeoplePage({})
  page.cache = SAMPLE
  page.applyFilter()
  const before = page.data.stars.find(s => s.id === 'b')
  page.search({ detail: { value: '王' } })
  const after = page.data.stars.find(s => s.id === 'b')
  assert.deepEqual([after.x, after.y, after.ring], [before.x, before.y, before.ring])
})

test('一至十二人全部可见，超出时只保留记录最多的十二人', () => {
  for (let n = 1; n <= 30; n++) {
    const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: '人物' + i, count: n - i }))
    const result = sm.build(people.slice().reverse())
    assert.equal(result.stars.length, Math.min(n, 12))
    assert.equal(result.hidden, Math.max(0, n - 12))
    assert.deepEqual(result.stars.map(s => s.id), people.slice(0, 12).map(p => p.id))
    assertClean(result.stars, n + ' 人')
  }
})

test('页面：多人事件每人计一次，删除事件后更新远近', () => {
  const page = loadPeoplePage({})
  page.cache = {
    people: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }, { id: 'c', name: '丙' }],
    events: [
      { id: 'shared', personIds: ['a', 'a', 'b'], date: '2026-10-01' },
      { id: 'old', personId: 'b', date: '2020-01-01' }
    ]
  }
  page.applyFilter()
  assert.equal(page.data.people.find(p => p.id === 'a').count, 1)
  assert.equal(page.data.people.find(p => p.id === 'b').count, 2)
  assert.equal(page.data.stars[0].id, 'b')
  page.cache.events.pop()
  page.applyFilter()
  assert.equal(page.data.people.find(p => p.id === 'b').count, 1)
  assert.equal(page.data.stars[0].id, 'a')
})

test('页面：搜索到未画出的人仍可查看摘要和记录事件', () => {
  const page = loadPeoplePage({})
  page.cache = {
    people: Array.from({ length: 15 }, (_, i) => ({ id: 'p' + String(i).padStart(2, '0'), name: '人物' + i })),
    events: []
  }
  page.applyFilter()
  page.search({ detail: { value: '人物14' } })
  assert.equal(page.data.stars.length, 0)
  assert.equal(page.data.hidden, 1)
  assert.equal(page.data.activeId, 'p14')
  assert.equal(page.data.activePerson.name, '人物14')
  page.clearSearch()
  assert.equal(page.data.hidden, 3)
  assert.equal(page.data.activeId, 'p14')
})

test('星图：单指拖动阻止误点，下一次轻点可正常选人', () => {
  const page = loadPeoplePage({}, { createSelectorQuery: createSelectorQueryStub([{ left: 0, top: 0, width: 335, height: 360 }]) })
  page.cache = SAMPLE
  page.applyFilter()
  page.onMapTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
  page.onMapTouchMove({ touches: [{ clientX: 140, clientY: 130 }] })
  assert.equal(page.data.mapX, 40)
  assert.equal(page.data.mapY, 30)
  page.onMapTouchEnd({ touches: [] })
  assert.equal(page.data.mapTouching, false)
  page.selectStar({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.activeId, 'a')
  page.onMapTouchStart({ touches: [{ clientX: 140, clientY: 130 }] })
  page.onMapTouchEnd({ touches: [] })
  page.selectStar({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.activeId, 'b')
})

test('星图：双指围绕手势中心缩放，限制范围，切回单指不跳动', () => {
  const page = loadPeoplePage({}, { createSelectorQuery: createSelectorQueryStub([{ left: 0, top: 0, width: 300, height: 300 }]) })
  const touches = (a, b) => [{ clientX: a, clientY: 150 }, { clientX: b, clientY: 150 }]
  page.onMapTouchStart({ touches: touches(150, 250) })
  page.onMapTouchMove({ touches: touches(100, 300) })
  assert.equal(page.data.mapZoom, 2)
  assert.equal(page.data.mapX, -50)
  page.onMapTouchMove({ touches: touches(0, 400) })
  assert.equal(page.data.mapZoom, 2)
  page.onMapTouchEnd({ touches: [{ clientX: 100, clientY: 150 }] })
  page.onMapTouchMove({ touches: [{ clientX: 110, clientY: 160 }] })
  assert.equal(page.data.mapX, -40)
  assert.equal(page.data.mapY, 10)
  page.onMapTouchEnd({ touches: [] })
  page.onMapTouchStart({ touches: touches(0, 300) })
  page.onMapTouchMove({ touches: touches(140, 160) })
  assert.equal(page.data.mapZoom, 0.8)
  page.resetMap()
  assert.equal(page.data.mapZoom, 1)
  assert.equal(page.data.mapX, 0)
  assert.equal(page.data.mapY, 0)
  assert.equal(page.data.mapTouching, false)
})

test('星图：移动有边界，触摸取消或页面隐藏后恢复页面滚动', () => {
  const page = loadPeoplePage({}, { createSelectorQuery: createSelectorQueryStub([{ left: 0, top: 0, width: 300, height: 300 }]) })
  page.onMapTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
  page.onMapTouchMove({ touches: [{ clientX: 5000, clientY: -5000 }] })
  assert.ok(page.data.mapX < 300)
  assert.ok(page.data.mapY > -300)
  page.onMapTouchCancel()
  assert.equal(page.data.mapTouching, false)
  page.onMapTouchStart({ touches: [{ clientX: 100, clientY: 100 }] })
  page.onHide()
  assert.equal(page.data.mapTouching, false)
})

test('人物标签列表按人物归属统计，多人事件和无标签人物互不串词', () => {
  const page = loadPeoplePage({})
  page.cache = {
    people: [{ id: 'a', name: '林夏' }, { id: 'b', name: '陈默' }, { id: 'c', name: '周宁' }],
    events: [
      { id: 'e1', date: '2026-10-03', personIds: ['a', 'b'], tagsByPerson: { a: ['细心', '真诚'], b: ['有耐心'] } },
      { id: 'e2', date: '2026-10-02', personId: 'a', tags: ['细心'] }
    ]
  }
  page.applyFilter()
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.people.map(p => p.tagList))), [
    [{ name: '细心', n: 2 }, { name: '真诚', n: 1 }], [{ name: '有耐心', n: 1 }], []
  ])
  page.selectStar({ currentTarget: { dataset: { id: 'b' } } })
  assert.equal(page.data.activePerson.tagList[0].name, '有耐心')
  page.search({ detail: { value: '周' } })
  assert.equal(page.data.people[0].tagList.length, 0)
  page.clearSearch()
  assert.equal(page.data.people.length, 3)
})

test('人物新版摘要和列表的入口保留，模板绑定的处理函数均存在', () => {
  const calls = []
  const page = loadPeoplePage({}, { navigateTo: value => calls.push(value.url) })
  const e = { currentTarget: { dataset: { id: 'a' } } }
  page.openPerson(e); page.goPerson(e); page.recordFor(e); page.manageTags()
  assert.deepEqual(calls, ['/pages/person/person?id=a', '/pages/person/person?id=a', '/pages/record/record?personId=a', '/pages/tags/tags'])
  page.data.people = [{ id: 'a', selected: false }]
  page.toggleManage(); page.openPerson(e)
  assert.equal(page.data.selectedIds[0], 'a')
  assert.equal(calls.length, 4)
  page.toggleManage()
  assert.equal(page.data.selectedIds.length, 0)
  const markup = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxml'), 'utf8')
  for (const match of markup.matchAll(/(?:bind|catch)(?:tap|input|confirm|blur|longpress|touchstart|touchmove|touchend|touchcancel)="(\w+)"/g)) {
    assert.equal(typeof page[match[1]], 'function', match[1])
  }
  assert.ok(markup.includes('wx:for-item="tag"'))
  assert.ok(markup.includes('{{tag.name}}'))
  assert.ok(!markup.includes('file-last'))
})

test('星图关闭原生矩形点击高亮，底部留白为浅色且人物使用双列', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../pages/people/people.wxss'), 'utf8')
  const starButton = markup.match(/<button\b[^>]*wx:for="\{\{stars\}\}"[^>]*>/)[0]
  assert.match(starButton, /hover-class="none"/)
  assert.match(styles, /\.star:focus\s*\{\s*outline:\s*none/)
  const pageRule = styles.match(/\.people-page\s*\{[^}]*\}/)[0]
  assert.match(pageRule, /background:\s*#fdfcf9/)
  assert.match(pageRule, /104rpx \+ env\(safe-area-inset-bottom\)/)
  assert.match(styles, /\.file-card\s*\{[^}]*width:\s*calc\(50% - 8rpx\)/)
  assert.ok(markup.indexOf('class="create-person"') < markup.indexOf('class="search-row"'))
  assert.match(markup, /class="create-person" bindtap="showCreate"/)
  assert.ok(!markup.includes('new-card'))
})
