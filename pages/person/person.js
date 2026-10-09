const store = require('../../utils/store')
const { personIds, tagsFor, displayText } = require('../../utils/events')
const { moodColor } = require('../../utils/moods')

Page({
  data: { person: {}, basics: [], events: [], tags: [], activeTags: [], scrollTop: 0, loading: true, loadFailed: false, totalCount: 0, lastNumber: '—', lastUnit: '暂无记录', deleting: false },
  onLoad(options) {
    this.personId = options.id || 'wang'
    this.notFoundHandled = false
  },
  onShow() { this.refresh() },
  eventsForTags(activeTags) {
    const all = this.allPersonEvents || []
    const base = activeTags.length
      ? all.filter(event => tagsFor(event, this.personId).some(tag => activeTags.includes(tag)))
      : all
    return base.map(event => ({
      ...event,
      text: displayText(event, this.allPeople),
      moodColor: moodColor(event.mood, this.moodSettings),
      tagsText: tagsFor(event, this.personId).join('、'),
      dateLabel: event.date && event.date.slice(0, 4) === String(new Date().getFullYear()) ? Number(event.date.slice(5, 7)) + '月' + Number(event.date.slice(8, 10)) + '日' : event.date
    }))
  },
  async refresh() {
    this.setData({ loading: !this.data.person.id, loadFailed: false })
    let data
    try { data = await store.load() } catch (error) { this.setData({ loading: false, loadFailed: true }); return }
    const person = data.people.find(item => item.id === this.personId)
    if (!person) {
      if (this.notFoundHandled) return
      this.notFoundHandled = true
      wx.showToast({ title: '人物不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    const all = data.events.filter(event => personIds(event).includes(this.personId)).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    this.allPersonEvents = all
    this.allPeople = data.people || []
    this.moodSettings = data.moods
    const tagNames = [...new Set(all.reduce((list, event) => list.concat(tagsFor(event, this.personId)), []))]
    const tags = tagNames.map(name => ({
      name,
      count: all.filter(event => tagsFor(event, this.personId).includes(name)).length,
      selected: this.data.activeTags.includes(name)
    }))
    const activeTags = tags.filter(tag => tag.selected).map(tag => tag.name)
    const events = this.eventsForTags(activeTags)
    const basics = [['性别', person.gender], ['关系', person.relation], ['工作', person.work], ['城市', person.city], ['生日', person.birthday], ['认识于', person.metDate]].filter(item => item[1]).map(item => ({ label: item[0], value: item[1] }))
    let lastNumber = '—', lastUnit = '暂无记录'
    if (all.length) {
      const today = new Date()
      const latest = new Date(String(all[0].date).replace(/-/g, '/') + ' 00:00:00')
      today.setHours(0, 0, 0, 0)
      const days = Math.round((today - latest) / 86400000)
      if (Number.isFinite(days)) {
        lastNumber = days === 0 ? '今天' : String(Math.abs(days))
        lastUnit = days === 0 ? '' : days > 0 ? '天前' : '天后'
      }
    }
    this.setData({ person, basics, tags, events, activeTags, totalCount: all.length, lastNumber, lastUnit, loading: false })
    wx.setNavigationBarTitle({ title: person.name })
  },
  retryLoad() { this.refresh() },
  filterTag(e) {
    const name = e.currentTarget.dataset.tag
    const activeTags = this.data.activeTags.includes(name)
      ? this.data.activeTags.filter(tag => tag !== name)
      : this.data.activeTags.concat(name)
    this.showTags(activeTags)
  },
  clearTags() { this.showTags([]) },
  showTags(activeTags) {
    this.setData({
      activeTags,
      tags: this.data.tags.map(tag => ({ ...tag, selected: activeTags.includes(tag.name) })),
      events: this.eventsForTags(activeTags),
      scrollTop: 0
    })
  },
  viewAllRecords() {
    getApp().globalData.recordsPersonId = this.personId
    wx.switchTab({ url: '/pages/all-records/all-records' })
  },
  record() { wx.navigateTo({ url: '/pages/record/record?personId=' + this.personId }) },
  editPerson() { wx.navigateTo({ url: '/pages/person-edit/person-edit?id=' + this.personId }) },
  openEvent(e) { wx.navigateTo({ url: '/pages/event/event?id=' + e.currentTarget.dataset.id }) },
  deletePerson() {
    if (this.data.deleting || this.deletePromptOpen) return
    this.deletePromptOpen = true
    wx.showModal({ title: '删除人物', content: `删除“${this.data.person.name}”？仅属于此人的记录会删除，多人记录会保留其他人物的关联。删除后无法恢复。`, confirmText: '删除', confirmColor: '#b42318', success: async result => {
      this.deletePromptOpen = false
      if (!result.confirm) return
      this.setData({ deleting: true })
      wx.showLoading({ title: '删除中', mask: true })
      try {
        await store.deletePerson(this.personId)
        wx.hideLoading()
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 600)
      } catch (error) { this.setData({ deleting: false }); wx.hideLoading(); wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
    }, fail: () => { this.deletePromptOpen = false } })
  },
  async chooseAvatar() {
    if (this.avatarSaving) return
    let media
    try {
      media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
    } catch (error) {
      if (!/cancel/i.test(String(error.errMsg || ''))) wx.showToast({ title: '选择图片失败', icon: 'none' })
      return
    }
    const file = media.tempFiles && media.tempFiles[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      wx.showToast({ title: '请选择 5MB 以内的图片', icon: 'none' })
      return
    }
    this.avatarSaving = true
    wx.showLoading({ title: '保存头像中' })
    try {
      const avatarUrl = await store.updatePersonAvatar(this.personId, file.tempFilePath)
      this.setData({ 'person.avatarUrl': avatarUrl })
      wx.hideLoading()
      wx.showToast({ title: '头像已更新', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: '头像保存失败', icon: 'none' })
    } finally {
      this.avatarSaving = false
    }
  }
})
