const store = require('../../utils/store')
const { personIds, tagsFor, displayText, relativeDate } = require('../../utils/events')
const { moodColor } = require('../../utils/moods')

function dateKey(date) {
  const d = date || new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function groupLabel(dateStr) {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (dateStr === dateKey(now)) return '今天'
  if (dateStr === dateKey(yesterday)) return '昨天'
  const [year, month, day] = dateStr.split('-').map(Number)
  if (!month) return dateStr
  if (year === now.getFullYear()) return `${month}月${day}日`
  return `${year}年${month}月${day}日`
}

Page({
  data: { groups: [], peopleCards: [], peopleCount: 0, eventCount: 0, loading: true, loadFailed: false },
  async onShow() {
    if (this.getTabBar()) this.getTabBar().setData({ selected: 1 })
    await this.refresh()
  },
  async refresh() {
    this.setData({ loading: !this.data.eventCount, loadFailed: false })
    try {
      const data = await store.load()
      const people = data.people
      const events = data.events.slice(0, 3).map(event => {
        const personName = personIds(event).map(id => (people.find(person => person.id === id) || {}).name).filter(Boolean).join('、')
        return {
          ...event,
          text: displayText(event, people),
          person: personName,
          moodColor: moodColor(event.mood, data.moods),
          impressions: personIds(event).map(id => {
            const person = people.find(item => item.id === id)
            return person ? { id, name: person.name, text: tagsFor(event, id).join(' · ') || '尚未补充' } : null
          }).filter(Boolean)
        }
      })
      const groups = []
      events.forEach(event => {
        const label = groupLabel(event.date)
        let group = groups.find(item => item.label === label)
        if (!group) { group = { label, events: [] }; groups.push(group) }
        group.events.push(event)
      })
      const byPerson = new Map()
      data.events.forEach(event => {
        personIds(event).forEach(id => {
          if (!byPerson.has(id)) byPerson.set(id, [])
          byPerson.get(id).push(event)
        })
      })
      const peopleCards = people
        .map(person => {
          const list = byPerson.get(person.id) || []
          const last = list[0]
          const strip = list.slice(0, 3).map(event => moodColor(event.mood, data.moods))
          while (strip.length < 3) strip.push('')
          return {
            id: person.id,
            name: person.name,
            avatarUrl: person.avatarUrl || '',
            initial: person.avatar || (person.name || '人').charAt(0),
            count: list.length,
            lastText: last ? relativeDate(last.date).text : '',
            ring: last ? moodColor(last.mood, data.moods) : '',
            strip
          }
        })
        .sort((a, b) => {
          const da = ((byPerson.get(a.id) || [])[0] || {}).date || ''
          const db = ((byPerson.get(b.id) || [])[0] || {}).date || ''
          if (da !== db) return da < db ? 1 : -1
          return 0
        })
        .slice(0, 8)
      this.setData({
        peopleCards,
        peopleCount: people.length,
        eventCount: data.events.length,
        groups,
        loading: false
      })
    } catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  retryLoad() { this.refresh() },
  record() { wx.navigateTo({ url: '/pages/record/record' }) },
  allPeople() { wx.switchTab({ url: '/pages/people/people' }) },
  addPerson() {
    getApp().globalData.openPersonCreate = true
    wx.switchTab({ url: '/pages/people/people' })
  },
  allRecords() { getApp().globalData.recordsPersonId = null; wx.switchTab({ url: '/pages/all-records/all-records' }) },
  openEvent(e) { wx.navigateTo({ url: '/pages/event/event?id=' + e.currentTarget.dataset.id }) },
  openPerson(e) { wx.navigateTo({ url: '/pages/person/person?id=' + e.currentTarget.dataset.id }) }
})
