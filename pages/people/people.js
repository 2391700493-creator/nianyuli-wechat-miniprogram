const store = require('../../utils/store')
const { personIds, displayText, tagsFor } = require('../../utils/events')
const moods = require('../../utils/moods')
const starmap = require('../../utils/starmap')
const moodKey = moods.moodKey || (() => '')

const TONE_CN = { pos: '向好', neu: '平淡', neg: '有点疙瘩' }

function daysAgo(dateStr) {
  if (!dateStr) return null
  const time = new Date(String(dateStr).replace(/-/g, '/')).getTime()
  if (isNaN(time)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - time) / 86400000))
}

function relativeWhen(days) {
  if (days === null) return ''
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  return days + ' 天前'
}

// 关系色调：沿用心情语义（绿=向好 红=有疙瘩 灰=平淡），取最近一条事件的心情
function toneOf(mood) {
  const key = moodKey(mood)
  if (key === 'happy' || key === 'moved') return 'pos'
  if (key === 'sad' || key === 'wronged' || key === 'angry') return 'neg'
  return 'neu'
}

// 当前判断：某人物所有事件里出现过的印象词，按支撑条数降序
function countTags(events, personId) {
  const counts = new Map()
  events.forEach(event => {
    ;(tagsFor(event, personId) || []).forEach(name => {
      counts.set(name, (counts.get(name) || 0) + 1)
    })
  })
  return [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
}

// 选中星的光丝：从「我」指向选中星，rpx 坐标系
function threadOf(center, star) {
  if (!center || !star) return null
  const dx = star.x - center.x
  const dy = star.y - center.y
  return {
    x: Math.round(center.x), y: Math.round(center.y),
    w: Math.round(Math.hypot(dx, dy)),
    a: +(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2)
  }
}
Page({
  data: { focusField: '',
    people: [], stars: [], rings: [], thread: null,
    center: { x: starmap.CENTER.x, y: starmap.CENTER.y },
    canvasW: starmap.CANVAS.w, canvasH: starmap.CANVAS.h, scale: starmap.SCALE,
    activeId: '', activePerson: null,
    mapX: 0, mapY: 0, mapZoom: 1, mapTouching: false,
    query: '', showCreate: false, name: '', note: '', creating: false, deleting: false,
    managing: false, selectedIds: [], dragId: '', dragDx: 0, dragDy: 0,
    loading: true, loadFailed: false
  },
  focusInput(field) {
    this.setData({ focusField: '' }, () => this.setData({ focusField: field }))
  },
  blurInput() { this.setData({ focusField: '' }) },
  dismissKeyboard() { this.setData({ focusField: '' }); if (wx.hideKeyboard) wx.hideKeyboard() },
  onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 2 })
    const app = getApp()
    if (app.globalData.openPersonCreate) {
      app.globalData.openPersonCreate = false
      this.setData({ showCreate: true })
      this.focusInput('name')
    }
    this.refresh()
  },
  async refresh() {
    this.setData({ loading: !this.cache, loadFailed: false })
    try {
      this.cache = await store.load()
      this.setData({ loading: false })
      this.applyFilter()
    } catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  applyFilter() {
    const data = this.cache
    if (!data) return
    const query = this.data.query.trim().toLowerCase()
    const allPeople = data.people.map(person => {
      const events = data.events.filter(event => personIds(event).includes(person.id))
        .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      const last = events[0]
      const days = last ? daysAgo(last.date) : null
      return {
        ...person,
        selected: this.data.selectedIds.includes(person.id),
        count: events.length,
        lastText: last ? displayText(last, data.people) : '',
        when: relativeWhen(days),
        tone: last ? toneOf(last.mood) : 'neu',
        toneText: TONE_CN[last ? toneOf(last.mood) : 'neu'],
        // 当前判断：该人物所有事件里出现过的印象词及其支撑条数
        tagList: countTags(events, person.id)
      }
    })

    // 先用全部人物确定位置，再搜索；筛选不会改变原有远近。
    const people = allPeople.filter(person => person.name.toLowerCase().includes(query))
    const matchingIds = new Set(people.map(person => person.id))
    const graph = starmap.build(allPeople)
    const stars = graph.stars.filter(star => matchingIds.has(star.id))

    // 默认选中事件最多的人，包含只在下方列表展示的人物。
    const activeId = this.data.activeId && matchingIds.has(this.data.activeId)
      ? this.data.activeId
      : ((people.slice().sort(starmap.comparePeople)[0] || {}).id || '')
    const activePerson = people.find(item => item.id === activeId) || null
    const activeStar = stars.find(star => star.id === activeId) || null
    const minRingR = Math.min(...graph.rings.map(ring => ring.r))

    this.setData({
      people,
      stars,
      hidden: people.length - stars.length,
      rings: graph.rings.map(ring => ({ ...ring, near: ring.r === minRingR })),
      center: graph.center,
      canvasW: graph.canvas.w,
      canvasH: graph.canvas.h,
      scale: graph.scale,
      activeId,
      activePerson,
      thread: threadOf(graph.center, activeStar)
    })
  },
  retryLoad() { this.refresh() },
  maybeManageTip() {
    if (wx.getStorageSync('guanyu-manage-tip')) return
    wx.setStorageSync('guanyu-manage-tip', true)
    wx.showToast({ title: '长按卡片可拖动排序', icon: 'none', duration: 2500 })
  },
  search(e) { this.setData({ query: e.detail.value }); this.applyFilter() },
  clearSearch() { this.setData({ query: '' }); this.applyFilter() },
  onMapScroll() {},
  onHide() { this.onMapTouchCancel() },
  onUnload() { this.onMapTouchCancel() },
  // 手势只变换整张图，不改人物的关系坐标。坐标单位为屏幕 px。
  beginMapGesture(touches, rect) {
    if (!touches.length) return
    const points = touches.slice(0, 2).map(t => ({ x: t.clientX, y: t.clientY }))
    this.mapGesture = {
      points, rect, x: this.data.mapX, y: this.data.mapY, zoom: this.data.mapZoom
    }
    if (points.length > 1) this.mapMoved = true
  },
  onMapTouchStart(e) {
    if (!e.touches.length) return
    if (!this.data.mapTouching) this.mapMoved = false
    const rect = this.mapGesture && this.mapGesture.rect
    this.beginMapGesture(e.touches, rect)
    this.setData({ mapTouching: true })
    const gesture = this.mapGesture
    // 每次触摸重新测量，页面滚动后缩放中心仍准确。
    wx.createSelectorQuery().select('.map').boundingClientRect().exec(result => {
      if (this.mapGesture === gesture && result && result[0]) {
        gesture.rect = result[0]
      }
    })
  },
  onMapTouchMove(e) {
    const base = this.mapGesture
    if (!base || !base.rect || !e.touches.length) return
    const touches = e.touches.slice(0, 2)
    if (touches.length !== base.points.length) {
      this.beginMapGesture(touches, base.rect)
      return
    }
    let zoom = base.zoom
    let x, y
    if (touches.length === 2) {
      const [a, b] = base.points
      const [c, d] = touches
      const distance = Math.hypot(b.x - a.x, b.y - a.y)
      if (distance < 1) return
      zoom = Math.max(0.8, Math.min(2, base.zoom * Math.hypot(d.clientX - c.clientX, d.clientY - c.clientY) / distance))
      const cx = base.rect.left + base.rect.width / 2
      const cy = base.rect.top + base.rect.height / 2
      x = (c.clientX + d.clientX) / 2 - cx - ((a.x + b.x) / 2 - cx - base.x) * zoom / base.zoom
      y = (c.clientY + d.clientY) / 2 - cy - ((a.y + b.y) / 2 - cy - base.y) * zoom / base.zoom
      this.mapMoved = true
    } else {
      const dx = touches[0].clientX - base.points[0].x
      const dy = touches[0].clientY - base.points[0].y
      if (!this.mapMoved && Math.hypot(dx, dy) < 6) return
      this.mapMoved = true
      x = base.x + dx
      y = base.y + dy
    }
    // 始终保留至少半幅图在窗口内，可继续拖回。
    const limitX = base.rect.width * zoom / 2
    const limitY = base.rect.height * zoom / 2
    this.setData({
      mapX: Math.max(-limitX, Math.min(limitX, x)),
      mapY: Math.max(-limitY, Math.min(limitY, y)),
      mapZoom: zoom
    })
  },
  onMapTouchEnd(e) {
    if (e.touches && e.touches.length) {
      this.beginMapGesture(e.touches, this.mapGesture && this.mapGesture.rect)
      return
    }
    this.mapGesture = null
    this.setData({ mapTouching: false })
  },
  onMapTouchCancel() {
    this.mapMoved = true
    this.mapGesture = null
    this.setData({ mapTouching: false })
  },
  resetMap() {
    this.mapGesture = null
    this.mapMoved = false
    this.setData({ mapX: 0, mapY: 0, mapZoom: 1, mapTouching: false })
  },
  // 星图点选：只切换下方档案摘要，不跳转（跳转用摘要卡上的按钮）
  selectStar(e) {
    const id = e.currentTarget.dataset.id
    if (this.drag || this.mapMoved) return
    const person = this.data.people.find(item => item.id === id)
    if (!person) return
    const star = this.data.stars.find(item => item.id === id) || null
    this.setData({ activeId: id, activePerson: person, thread: threadOf(this.data.center, star) })
  },
  openPerson(e) {
    if (this.data.deleting || this.drag) return
    const id = e.currentTarget.dataset.id
    if (!this.data.managing) { wx.navigateTo({ url: '/pages/person/person?id=' + id }); return }
    const ids = this.data.selectedIds
    const selectedIds = ids.includes(id) ? ids.filter(item => item !== id) : ids.concat(id)
    this.setData({ selectedIds, people: this.data.people.map(person => ({ ...person, selected: selectedIds.includes(person.id) })) })
  },
  goPerson(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/person/person?id=' + id })
  },
  recordFor(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/pages/record/record?personId=' + id })
  },
  /* 长按卡片：进入管理态并选中；手指移动即开始拖拽排序 */
  onCardLongPress(e) {
    if (this.data.deleting || this.sortSaving) return
    if (this.data.query.trim()) return wx.showToast({ title: '清除搜索后可排序', icon: 'none' })
    const id = e.currentTarget.dataset.id
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.pendingDrag = { id, x: touch.clientX, y: touch.clientY }
    if (this.data.managing) {
      if (!this.data.selectedIds.includes(id)) {
        const selectedIds = this.data.selectedIds.concat(id)
        this.setData({ selectedIds, people: this.data.people.map(person => ({ ...person, selected: selectedIds.includes(person.id) })) }, () => this.beginDrag())
      } else this.beginDrag()
    } else {
      this.maybeManageTip()
      this.setData({ managing: true, selectedIds: [id], people: this.data.people.map(person => ({ ...person, selected: person.id === id })) }, () => this.beginDrag())
    }
  },
  beginDrag() {
    if (!this.pendingDrag) return
    const { id, x, y } = this.pendingDrag
    const index = this.data.people.findIndex(person => person.id === id)
    if (index === -1) { this.pendingDrag = null; return }
    this.drag = { id, index, startX: x, startY: y, rects: [], moved: false }
    this.dragStartOrder = this.data.people.map(person => person.id)
    this.setData({ dragId: id }, () => this.queryRects(() => {
      if (!this.drag) return
      const rect = this.drag.rects[this.drag.index]
      if (rect) { this.drag.grabX = this.drag.startX - rect.left; this.drag.grabY = this.drag.startY - rect.top }
    }))
  },
  queryRects(done) {
    wx.createSelectorQuery().selectAll('.sortable').boundingClientRect(rects => {
      if (!this.drag) return
      this.drag.rects = rects || []
      if (done) done()
    }).exec()
  },
  onCardTouchMove(e) {
    if (!this.drag || !this.drag.rects.length || this.drag.grabX === undefined) return
    const touch = e.touches[0]
    const base = this.drag.rects[this.drag.index]
    if (!base) return
    const dx = touch.clientX - this.drag.grabX - base.left
    const dy = touch.clientY - this.drag.grabY - base.top
    if (Math.abs(dx) + Math.abs(dy) > 6) this.drag.moved = true
    this.setData({ dragDx: dx, dragDy: dy })
    const now = Date.now()
    if (now - (this.drag.lastHit || 0) < 90) return
    this.drag.lastHit = now
    const cx = touch.clientX - this.drag.grabX + base.width / 2
    const cy = touch.clientY - this.drag.grabY + base.height / 2
    const target = this.drag.rects.findIndex((rect, i) => i !== this.drag.index && cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom)
    if (target === -1) return
    const people = this.data.people.slice()
    const [moved] = people.splice(this.drag.index, 1)
    people.splice(target, 0, moved)
    this.drag.index = target
    this.setData({ people }, () => this.queryRects())
  },
  onCardTouchEnd() {
    if (!this.drag) return
    const moved = this.drag.moved
    this.drag = null
    this.pendingDrag = null
    this.setData({ dragId: '', dragDx: 0, dragDy: 0 })
    if (!moved) return
    const original = (this.dragStartOrder || []).slice()
    const order = this.data.people.map(person => person.id)
    this.sortSaving = true
    store.reorderPeople(order).then(() => {
      const index = new Map(order.map((id, i) => [id, i]))
      if (this.cache) this.cache.people.sort((a, b) => (index.get(a.id) ?? order.length) - (index.get(b.id) ?? order.length))
      this.applyFilter()
      wx.showToast({ title: '顺序已保存', icon: 'success' })
    }).catch(() => {
      const index = new Map(original.map((id, i) => [id, i]))
      const people = this.data.people.slice().sort((a, b) => (index.has(a.id) ? index.get(a.id) : 0) - (index.has(b.id) ? index.get(b.id) : 0))
      this.setData({ people })
      wx.showToast({ title: '排序保存失败，已恢复原顺序', icon: 'none' })
    }).finally(() => { this.sortSaving = false })
  },
  toggleManage() { if (!this.data.deleting) { this.setData({ managing: !this.data.managing, selectedIds: [], people: this.data.people.map(person => ({ ...person, selected: false })) }); if (this.data.managing) this.maybeManageTip() } },
  manageTags() { wx.navigateTo({ url: '/pages/tags/tags' }) },
  async deleteSelected() {
    if (this.data.deleting) return
    const ids = this.data.selectedIds
    if (!ids.length) return
    this.setData({ deleting: true })
    let impact
    try {
      const data = await store.load()
      impact = data.events.reduce((counts, event) => {
        const linked = event.personIds || [event.personId]
        if (!linked.some(id => ids.includes(id))) return counts
        if (linked.every(id => ids.includes(id))) counts.removed++
        else counts.kept++
        return counts
      }, { removed: 0, kept: 0 })
    } catch (error) { this.setData({ deleting: false }); wx.showToast({ title: '记录加载失败，请重试', icon: 'none' }); return }
    wx.showModal({ title: `删除所选 ${ids.length} 位人物？`, content: `人物档案和照片会删除。仅关联所选人物的 ${impact.removed} 条事件会删除；另有 ${impact.kept} 条多人事件会保留，并移除所选人物的关联。删除后无法恢复。`, confirmText: '确认删除', confirmColor: '#b42318', success: async result => {
      if (!result.confirm) { this.setData({ deleting: false }); return }
      wx.showLoading({ title: '删除中', mask: true })
      try {
        for (const id of ids) {
          await store.deletePerson(id)
          this.setData({ selectedIds: this.data.selectedIds.filter(item => item !== id) })
        }
        this.cache = null
        wx.hideLoading()
        this.setData({ managing: false, selectedIds: [], deleting: false })
        wx.showToast({ title: '已删除', icon: 'success' })
        this.refresh()
      } catch (error) {
        this.cache = null
        wx.hideLoading()
        this.setData({ deleting: false })
        wx.showToast({ title: '部分删除失败，请重试', icon: 'none' })
        this.refresh()
      }
    }, fail: () => this.setData({ deleting: false }) })
  },
  showCreate() { this.setData({ showCreate: true }); this.focusInput('name') },
  hideCreate() {
    if (this.data.creating) return
    if (this.data.name.trim() || this.data.note.trim()) {
      wx.showModal({ title: '放弃新建？', content: '已填写的内容不会保存。', confirmText: '放弃', confirmColor: '#b42318', success: result => {
        if (result.confirm) { this.dismissKeyboard(); this.setData({ showCreate: false, name: '', note: '' }) }
      } })
      return
    }
    this.dismissKeyboard()
    this.setData({ showCreate: false, name: '', note: '' })
  },
  noop() {},
  focusNote() { this.focusInput('note') },
  changeName(e) { if (this.data.creating) return; this.setData({ name: e.detail.value }) },
  changeNote(e) { if (this.data.creating) return; this.setData({ note: e.detail.value }) },
  async savePerson() {
    if (this.data.creating) return
    const name = this.data.name.trim()
    if (!name) { this.focusInput('name'); wx.showToast({ title: '请输入名字', icon: 'none' }); return }
    if (name.length > 30 || this.data.note.trim().length > 200) {
      this.focusInput(name.length > 30 ? 'name' : 'note')
      return wx.showToast({ title: name.length > 30 ? '名字最多 30 字' : '备注最多 200 字', icon: 'none' })
    }
    this.dismissKeyboard()
    this.setData({ creating: true })
    try {
      await store.addPerson({ id: 'p' + Date.now(), name, avatar: name.slice(0, 1), note: this.data.note.trim() })
      this.setData({ showCreate: false, name: '', note: '' })
      wx.showToast({ title: '已创建', icon: 'success' })
      this.refresh()
    } catch (error) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
    finally { this.setData({ creating: false }) }
  }
})
