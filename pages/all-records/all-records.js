const store = require('../../utils/store')
const { personIds, allTags, displayText } = require('../../utils/events')
const { moodColor } = require('../../utils/moods')
const PAGE_SIZE = 20

function toISO(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') }
function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

Page({
  data: { events: [], people: [], totalEvents: 0, selectedPeople: [], keyword: '', startDate: '', endDate: '', hasMore: false, loading: true, loadFailed: false, filteredCount: 0, days: [], weekdays: ['一', '二', '三', '四', '五', '六', '日'], monthTitle: '', anchor: '', dateLabel: '全部时间', showCalendar: false, scrollTop: 0, showPanel: false, hasFilters: false, activeChips: [] },
  onShow() {
    this.closeCalendar()
    if (this.getTabBar()) this.getTabBar().setData({ selected: 0 })
    const pending = getApp().globalData.recordsPersonId
    if (pending !== '' && pending !== undefined) {
      getApp().globalData.recordsPersonId = ''
      this.setData({ selectedPeople: pending ? [pending] : [], keyword: '', startDate: '', endDate: '', showPanel: false, showCalendar: false })
    }
    this.refresh()
  },
  onHide() { this.closeCalendar() },
  onUnload() { this.closeCalendar() },
  async refresh() {
    this.setData({ loading: !this.allEvents, loadFailed: false })
    try {
      const data = await store.load()
      this.allEvents = data.events.map(event => ({
        ...event,
        text: displayText(event, data.people),
        person: personIds(event).map(id => (data.people.find(person => person.id === id) || {}).name).filter(Boolean).join('、'),
        tagsText: allTags(event).join(' · '),
        moodColor: moodColor(event.mood, data.moods)
      }))
      this.allPeople = data.people
      this.setData({ totalEvents: data.events.length, loading: false })
      this.syncPeople()
      this.applyFilter()
    } catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  retryLoad() { this.refresh() },
  syncPeople() {
    const selected = this.data.selectedPeople.filter(id => (this.allPeople || []).some(person => person.id === id))
    this.setData({ selectedPeople: selected, people: (this.allPeople || []).map(person => ({ ...person, on: selected.includes(person.id) })) })
  },
  applyFilter() {
    const { selectedPeople, keyword, startDate, endDate } = this.data
    const q = keyword.trim().toLowerCase()
    const matching = (this.allEvents || []).filter(event => {
      const ids = personIds(event)
      return (!selectedPeople.length || ids.some(id => selectedPeople.includes(id))) && (!q || [event.text, event.person, event.tagsText].join(' ').toLowerCase().includes(q))
    })
    this.dayCounts = {}
    matching.forEach(event => { this.dayCounts[event.date] = (this.dayCounts[event.date] || 0) + 1 })
    const sorted = matching.filter(event => (!startDate || event.date >= startDate) && (!endDate || event.date <= endDate)).sort((a, b) => b.date.localeCompare(a.date))
    // 从完整筛选结果判断组尾，避免分页截断把同一天误分开。
    // 跨周、月、年必然同时跨日，因此共用一条分界线。
    this.filtered = sorted.map((event, index) => ({ ...event, showDate: index === 0 || event.date !== sorted[index - 1].date, showDivider: index < sorted.length - 1 && event.date !== sorted[index + 1].date, dateText: this.fmtMD(event.date) }))
    const count = this.filtered.length
    const chips = []
    if (q) chips.push({ type: 'kw', label: '「' + q + '」' })
    selectedPeople.forEach(id => {
      const person = (this.allPeople || []).find(item => item.id === id)
      if (person) chips.push({ type: 'person', id, label: person.name })
    })
    this.setData({ events: this.filtered.slice(0, PAGE_SIZE), hasMore: count > PAGE_SIZE, filteredCount: count, dateLabel: startDate ? this.fmtMD(startDate) : '全部时间', activeChips: chips, hasFilters: Boolean(startDate || endDate || chips.length) })
    this.setData({ scrollTop: 1 }, () => this.setData({ scrollTop: 0 }))
    this.buildMonth()
  },
  buildMonth() {
    const base = parseISO(this.data.anchor || this.data.startDate || toISO(new Date()))
    const year = base.getFullYear(), month = base.getMonth()
    const first = new Date(year, month, 1)
    const days = []
    const offset = (first.getDay() + 6) % 7
    for (let i = 0; i < offset; i++) days.push({ key: 'blank-' + i, iso: '' })
    const today = toISO(new Date())
    for (let num = 1; num <= new Date(year, month + 1, 0).getDate(); num++) {
      const iso = toISO(new Date(year, month, num))
      days.push({ key: iso, iso, num, has: (this.dayCounts || {})[iso] > 0, isToday: iso === today, selected: this.data.startDate === iso })
    }
    this.setData({ anchor: toISO(first), days, monthTitle: year + '年' + (month + 1) + '月' })
  },
  toggleCalendar() {
    const showCalendar = !this.data.showCalendar
    this.setCalendarVisible(showCalendar)
    this.setData({ showPanel: false, anchor: this.data.startDate || toISO(new Date()) })
    this.buildMonth()
  },
  setCalendarVisible(visible) {
    // 自定义 tabBar 独立于页面层级，弹层打开时显式隐藏。
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ hidden: visible })
    this.setData({ showCalendar: visible })
  },
  closeCalendar() { this.setCalendarVisible(false) },
  stopTouch() {},
  changeMonth(offset) {
    const base = parseISO(this.data.anchor)
    this.setData({ anchor: toISO(new Date(base.getFullYear(), base.getMonth() + offset, 1)) })
    this.buildMonth()
  },
  prevMonth() { this.changeMonth(-1) },
  nextMonth() { this.changeMonth(1) },
  jumpMonth(e) { this.setData({ anchor: e.detail.value + '-01' }); this.buildMonth() },
  selectToday() { this.selectDate(toISO(new Date())) },
  selectDate(iso) {
    if (!iso) return
    this.closeCalendar()
    this.setData({ startDate: iso, endDate: iso, anchor: iso, showCalendar: false })
    this.applyFilter()
  },
  tapDay(e) { this.selectDate(e.currentTarget.dataset.iso) },
  clearDates() {
    this.closeCalendar()
    this.setData({ startDate: '', endDate: '', showCalendar: false })
    this.applyFilter()
  },
  clearFilters() {
    this.closeCalendar()
    this.setData({ startDate: '', endDate: '', keyword: '', selectedPeople: [], showCalendar: false })
    this.syncPeople()
    this.applyFilter()
  },
  togglePanel() { this.closeCalendar(); this.setData({ showPanel: !this.data.showPanel, showCalendar: false }) },
  removeChip(e) {
    const chip = this.data.activeChips[Number(e.currentTarget.dataset.index)]
    if (!chip) return
    if (chip.type === 'kw') this.setData({ keyword: '' })
    else if (chip.type === 'person') {
      this.setData({ selectedPeople: this.data.selectedPeople.filter(id => id !== chip.id) })
      this.syncPeople()
    }
    this.applyFilter()
  },
  loadMore() {
    if (!this.data.hasMore) return
    const count = this.data.events.length + PAGE_SIZE
    this.setData({ events: this.filtered.slice(0, count), hasMore: this.filtered.length > count })
  },
  onReachBottom() { if (this.data.hasMore) this.loadMore() },
  search(e) { this.setData({ keyword: e.detail.value }); this.applyFilter() },
  clearSearch() { this.setData({ keyword: '' }); this.applyFilter() },
  togglePerson(e) {
    const id = e.currentTarget.dataset.id
    const selected = this.data.selectedPeople.slice()
    const index = selected.indexOf(id)
    if (index > -1) selected.splice(index, 1)
    else selected.push(id)
    this.setData({ selectedPeople: selected })
    this.syncPeople()
    this.applyFilter()
  },
  clearPeople() {
    this.setData({ selectedPeople: [] })
    this.syncPeople()
    this.applyFilter()
  },
  fmtMD(iso) {
    const [y, m, d] = iso.split('-')
    return (Number(y) === new Date().getFullYear() ? '' : y + '年') + Number(m) + '月' + Number(d) + '日'
  },
  openEvent(e) { wx.navigateTo({ url: '/pages/event/event?id=' + e.currentTarget.dataset.id }) },
  record() { wx.navigateTo({ url: '/pages/record/record' }) }
})
