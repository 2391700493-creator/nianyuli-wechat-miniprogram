const store = require('../../utils/store')
const { personIds, tagsFor, displayText } = require('../../utils/events')
const { moodColor, userMoods } = require('../../utils/moods')

const SUGGESTION_COUNT = 3
const COUNT_WARN_LENGTH = 900

function dateLabel(dateStr) {
  const parts = (dateStr || '').split('-').map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return dateStr || ''
  const now = new Date()
  const monthDay = `${parts[1]}月${parts[2]}日`
  return parts[0] === now.getFullYear() ? monthDay : `${parts[0]}年${monthDay}`
}

Page({
  data: { focusField: '',
    statusBarHeight: 20, navBarHeight: 44,
    event: {}, people: [], impressions: [], viewContext: '', viewMoodColor: '',
    editing: false, editContext: '', text: '', inputFocused: false,
    mood: '', doneEnabled: false, peopleRows: [],
    moodPickerOpen: false, selectedMoodColor: '', moodSheetOpen: false, moodSyncState: '', moodList: [],
    activePersonId: '', activePersonName: '',
    pickerOpen: false, pickerPeople: [], personQuery: '',
    tagPickerOpen: false, tagPickerOptions: [], tagQuery: '', tagPickerSelectedCount: 0, customTag: '', tagAddOpen: false, tagSearchVisible: false,
    tagSyncFailed: false, tagSyncing: false, saving: false, deleting: false, loading: true, loadFailed: false
  },
  focusInput(field) {
    this.setData({ focusField: '' }, () => this.setData({ focusField: field }))
  },
  blurInput() { this.setData({ focusField: '' }) },
  dismissKeyboard() { this.setData({ focusField: '' }); if (wx.hideKeyboard) wx.hideKeyboard() },
  onLoad(options) {
    this.eventId = options.id
    this.setUnloadGuard(false)
    let statusBarHeight = 20, navBarHeight = 44
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      statusBarHeight = win.statusBarHeight || 20
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
      if (menu && menu.height) navBarHeight = menu.height + (menu.top - statusBarHeight) * 2
    } catch (error) {}
    this.setData({ statusBarHeight, navBarHeight })
  },
  onShow() { this.refresh() },
  setUnloadGuard(on) {
    if (!wx.enableAlertBeforeUnload) return
    try {
      if (on) wx.enableAlertBeforeUnload({ message: '内容还没保存，确定离开吗？' })
      else wx.disableAlertBeforeUnload()
    } catch (error) {}
  },
  snapshotDraft() {
    const ids = this.draftPersonIds || []
    const tags = {}
    ids.forEach(id => { tags[id] = (this.draftTags[id] || []).slice() })
    return JSON.stringify({ text: this.data.text, mood: this.data.mood, ids, tags })
  },
  isDirty() {
    if (!this.data.editing) return false
    return this.snapshotDraft() !== this.baselineSnapshot
  },
  syncDone() { const dirty = this.isDirty(); this.setData({ doneEnabled: dirty }); this.setUnloadGuard(dirty) },
  async refresh() {
    if (this.data.editing) return
    this.setData({ loading: !this.data.event.id, loadFailed: false })
    try {
      const data = await store.load()
      if (this.data.editing) return
      const event = data.events.find(item => item.id === this.eventId)
      if (!event) { wx.showToast({ title: '记录不存在', icon: 'none' }); wx.navigateBack(); return }
      this.allPeople = data.people || []
      this.availableTags = (data.tags || []).filter(tag => tag.active).map(tag => tag.name)
      this.tagUsage = {}
      ;(data.events || []).forEach(item => {
        personIds(item).forEach(id => {
          tagsFor(item, id).forEach(name => { this.tagUsage[name] = (this.tagUsage[name] || 0) + 1 })
        })
      })
      this.userMoodList = userMoods(data)
      this.pendingTags = this.pendingTags || []
      const people = personIds(event).map(id => data.people.find(person => person.id === id)).filter(Boolean)
      const impressions = people.map(person => ({ id: person.id, name: person.name, avatarUrl: person.avatarUrl || '', avatar: person.avatar || (person.name || '').charAt(0), tagsText: tagsFor(event, person.id).join(' · ') || '尚未补充' }))
      const names = people.map(person => person.name)
      const viewContext = [dateLabel(event.date), names.length ? `关联 ${names.length} 人 · ${names.join('、')}` : ''].filter(Boolean).join(' · ')
      this.setData({
        event: { ...event, text: displayText(event, data.people) },
        people, impressions, viewContext,
        viewMoodColor: moodColor(event.mood, data),
        moodList: this.data.moodSyncState === 'syncing' ? this.data.moodList : this.userMoodList,
        moodSyncState: this.data.moodSyncState === 'syncing' ? 'syncing' : data.moodsPending ? 'failed' : '',
        loading: false
      })
    } catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  retryLoad() { this.refresh() },
  goBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack()
    wx.switchTab({ url: '/pages/home/home' })
  },

  edit() {
    const event = this.data.event
    this.customTagDrafts = {}
    this.draftTags = {}
    this.pendingTags = []
    this.draftPersonIds = personIds(event).slice()
    this.draftPersonIds.forEach(id => { this.draftTags[id] = tagsFor(event, id).slice() })
    const mood = event.mood || ''
    this.setData({
      editing: true,
      text: displayText(event, this.allPeople),
      mood, selectedMoodColor: moodColor(mood, this.data.moodList),
      activePersonId: this.draftPersonIds[0] || '',
      pickerOpen: false, personQuery: '',
      tagPickerOpen: false, tagQuery: '', customTag: '', tagAddOpen: false, tagSearchVisible: false,
      moodSheetOpen: false, moodPickerOpen: false
    })
    this.syncDraftPeople()
    this.renderPeopleRows()
    this.baselineSnapshot = this.snapshotDraft()
    this.syncDone()
    this.setUnloadGuard(false)
  },
  cancelEdit() {
    if (this.data.saving || this.data.deleting) return
    if (this.isDirty()) {
      wx.showModal({ title: '放弃修改？', content: '改动还没保存，放弃后无法恢复。', confirmText: '放弃修改', confirmColor: '#b42318', success: result => {
        if (!result.confirm) return
        this.setUnloadGuard(false)
        this.setData({ editing: false, doneEnabled: false })
      } })
      return
    }
    this.setUnloadGuard(false)
    this.setData({ editing: false, doneEnabled: false })
  },

  changeText(e) { if (this.data.saving || this.data.deleting) return; this.setData({ text: e.detail.value }); this.syncDone() },
  onTextFocus() { this.setData({ inputFocused: true }) },
  onTextBlur() { this.setData({ inputFocused: false, focusField: '' }) },

  // ===== 心情草稿：选中词与摘要颜色同步 =====
  onSpectrumChange(e) { if (this.data.saving || this.data.deleting) return;
    this.setData({ mood: e.detail.mood, selectedMoodColor: moodColor(e.detail.mood, this.data.moodList) })
    this.syncDone()
  },

  openMoodPicker() {
    if (this.data.saving || this.data.deleting) return
    this.dismissKeyboard()
    this.setData({ moodPickerOpen: true })
  },
  closeMoodPicker() { this.setData({ moodPickerOpen: false }) },
  chooseMood(e) {
    if (this.data.saving || this.data.deleting) return
    const mood = e.currentTarget.dataset.name || ''
    if (mood && !this.data.moodList.some(item => item.name === mood)) return
    this.onSpectrumChange({ detail: { mood } })
    this.closeMoodPicker()
  },

  // ===== 心情管理（组件弹层，即时生效，独立于事件保存） =====
  openMoodManager() { if (this.data.saving || this.data.deleting) return; this.dismissKeyboard(); this.setData({ moodSheetOpen: true, moodPickerOpen: false }) },
  closeMoodManager() { this.setData({ moodSheetOpen: false }); this.dismissKeyboard() },
  noop() {},
  async syncMoods(list) {
    const token = this.moodSyncToken = (this.moodSyncToken || 0) + 1
    this.setData({ moodSyncState: 'syncing' })
    try {
      await store.saveMoods(list)
      if (this.moodSyncToken === token) this.setData({ moodSyncState: 'saved' })
    } catch (error) {
      if (this.moodSyncToken === token) this.setData({ moodSyncState: 'failed' })
    }
  },
  retryMoodSync() { return this.syncMoods(this.data.moodList) },
  onMoodsChange(e) { if (this.data.saving || this.data.deleting) return;
    const list = e.detail.moods
    if (!list.length) return
    this.userMoodList = list
    this.setData({ moodList: list, selectedMoodColor: moodColor(this.data.mood, list) })
    if (this.data.mood && !list.some(item => item.name === this.data.mood)) {
      this.setData({ mood: '', selectedMoodColor: '' })
      this.syncDone()
    }
    this.syncMoods(list)
  },

  // ===== 关联人物 =====
  openPersonPicker() { if (this.data.saving || this.data.deleting) return;
    this.returnToText = this.data.inputFocused || this.data.focusField === 'text'
    this.dismissKeyboard()
    this.setData({ pickerOpen: true, personQuery: '' })
    this.syncDraftPeople()
  },
  restoreInputFocus() { this.dismissKeyboard(); if (this.returnToText) this.focusInput('text'); this.returnToText = false },
  closePersonPicker() { this.setData({ pickerOpen: false, personQuery: '' }); this.restoreInputFocus() },
  searchPerson(e) {
    this.setData({ personQuery: e.detail.value.trim() })
    this.syncDraftPeople()
  },
  togglePersonLink(e) { if (this.data.saving || this.data.deleting) return;
    const id = e.currentTarget.dataset.id
    const ids = this.draftPersonIds || []
    if (ids.includes(id)) {
      if (ids.length === 1) return wx.showToast({ title: '至少关联一人', icon: 'none' })
      this.draftPersonIds = ids.filter(personId => personId !== id)
      if (this.data.activePersonId === id) this.setData({ activePersonId: this.draftPersonIds[0] || '' })
    } else {
      if (ids.length >= 10) return wx.showToast({ title: '最多关联 10 人', icon: 'none' })
      this.draftPersonIds = ids.concat(id)
      if (!this.draftTags[id]) this.draftTags[id] = []
      this.setData({ activePersonId: id })
    }
    this.syncDraftPeople()
    this.renderPeopleRows()
  },

  // ===== 印象选择（半屏弹层） =====
  openTagPickerFor(e) { if (this.data.saving || this.data.deleting) return;
    this.returnToText = this.data.inputFocused || this.data.focusField === 'text'
    this.dismissKeyboard()
    this.setData({ activePersonId: e.currentTarget.dataset.id, tagPickerOpen: true, tagQuery: '', tagAddOpen: false, customTag: (this.customTagDrafts || {})[e.currentTarget.dataset.id] || '' })
    this.syncDraftPeople()
    this.renderTagPicker()
  },
  closeTagPicker() { this.setData({ tagPickerOpen: false, tagQuery: '', tagAddOpen: false }); this.restoreInputFocus() },
  searchTag(e) {
    this.setData({ tagQuery: e.detail.value.trim() })
    this.renderTagPicker()
  },
  togglePickerTag(e) { if (this.data.saving || this.data.deleting) return;
    const limited = !this.toggleTagSelection(this.data.activePersonId, e.currentTarget.dataset.tag)
    if (limited) return
    this.renderPeopleRows()
    this.renderTagPicker()
  },
  renderTagPicker() {
    const selected = this.draftTags[this.data.activePersonId] || []
    const available = [...new Set(selected.concat(this.availableTags || []))]
    const query = this.data.tagQuery
    const usage = this.tagUsage || {}
    const names = query ? available.filter(name => name.includes(query)) : available.slice().sort((a, b) => {
      const selectedDiff = (selected.includes(b) ? 1 : 0) - (selected.includes(a) ? 1 : 0)
      if (selectedDiff) return selectedDiff
      return (usage[b] || 0) - (usage[a] || 0)
    })
    this.setData({ tagPickerSelectedCount: selected.length, tagSearchVisible: available.length > 12, tagPickerOptions: names.map(name => ({ name, selected: selected.includes(name) })) })
  },
  toggleTagAdd() { if (this.data.saving || this.data.deleting) return;
    const open = !this.data.tagAddOpen
    this.setData({ tagAddOpen: open })
    if (open) this.focusInput('customTag')
    else {
      this.customTagDrafts = { ...this.customTagDrafts, [this.data.activePersonId]: '' }
      this.setData({ customTag: '' })
    }
  },
  changeCustom(e) { if (this.data.saving || this.data.deleting) return; this.customTagDrafts = { ...this.customTagDrafts, [this.data.activePersonId]: e.detail.value }; this.setData({ customTag: e.detail.value }) },
  addCustom() { if (this.data.saving || this.data.deleting) return;
    const name = this.data.customTag.trim()
    if (name.length > 8) return wx.showToast({ title: '印象词最多 8 字', icon: 'none' })
    if (!name) { this.focusInput('customTag'); return wx.showToast({ title: '请输入印象词', icon: 'none' }) }
    const id = this.data.activePersonId
    if (!this.toggleTagSelection(id, name)) return
    if (!(this.availableTags || []).includes(name)) {
      this.pendingTags = [...new Set((this.pendingTags || []).concat(name))]
      this.availableTags = [...new Set((this.availableTags || []).concat(name))]
    }
    this.customTagDrafts = { ...this.customTagDrafts, [id]: '' }
    this.setData({ customTag: '' })
    this.focusInput('customTag')
    this.renderPeopleRows()
    this.renderTagPicker()
  },
  toggleTagSelection(personId, name) {
    const selected = this.draftTags[personId] || []
    if (!selected.includes(name) && selected.length >= 10) {
      wx.showToast({ title: '每人最多选择 10 个印象', icon: 'none' })
      return false
    }
    this.draftTags[personId] = selected.includes(name) ? selected.filter(item => item !== name) : selected.concat(name)
    return true
  },
  renderPeopleRows() {
    const allPeople = this.allPeople || []
    const peopleRows = (this.draftPersonIds || []).map(id => {
      const person = allPeople.find(item => item.id === id) || {}
      const imps = this.draftTags[id] || []
      return {
        id,
        name: person.name || '',
        avatarUrl: person.avatarUrl || '',
        avatar: person.avatar || (person.name || '').charAt(0),
        impsText: imps.join('、') || '添加印象'
      }
    })
    this.setData({ peopleRows })
    this.syncDone()
  },
  syncDraftPeople() {
    const allPeople = this.allPeople || this.data.people
    const ids = this.draftPersonIds || []
    const people = ids.map(id => allPeople.find(person => person.id === id)).filter(Boolean)
    const query = this.data.personQuery.trim()
    const pickerPeople = allPeople.filter(person => person.name.includes(query)).map(person => ({ ...person, linked: ids.includes(person.id) }))
    const activePerson = allPeople.find(person => person.id === this.data.activePersonId)
    const dateText = dateLabel(this.data.event.date)
    const date = new Date(`${this.data.event.date}T12:00:00`)
    const weekday = Number.isNaN(date.getTime()) ? '' : `周${'日一二三四五六'[date.getDay()]}`
    const editContext = [dateText, weekday].filter(Boolean).join(' · ')
    this.setData({ people, pickerPeople, activePersonName: activePerson ? activePerson.name : '', editContext })
  },

  async retryTagSync() {
    if (this.data.tagSyncing) return
    this.setData({ tagSyncing: true })
    const failed = []
    for (const name of this.failedTags || []) {
      try { await store.saveTag(name, true) } catch (error) { failed.push(name) }
    }
    this.failedTags = failed
    this.setData({ tagSyncing: false, tagSyncFailed: failed.length > 0 })
  },
  async save() {
    if (this.data.moodSyncState === 'syncing' || this.data.moodSyncState === 'failed') {
      return wx.showToast({ title: this.data.moodSyncState === 'syncing' ? '心情同步中，请稍候' : '请先重试同步心情设置', icon: 'none' })
    }
    if (this.data.saving || this.data.deleting) return
    // 无改动时直接退出编辑态，避免点了没反应
    if (!this.isDirty()) {
      this.setUnloadGuard(false)
      this.setData({ editing: false, doneEnabled: false })
      return
    }
    const text = this.data.text.trim()
    if (!text) { this.focusInput('text'); return wx.showToast({ title: '请写下事件内容', icon: 'none' }) }
    this.dismissKeyboard()
    this.setData({ saving: true, pickerOpen: false, tagPickerOpen: false, moodSheetOpen: false, moodPickerOpen: false })
    try {
      const linkedPersonIds = (this.draftPersonIds || personIds(this.data.event)).slice()
      const tagsByPerson = {}
      linkedPersonIds.forEach(id => { tagsByPerson[id] = (this.draftTags[id] || []).slice() })
      await store.updateEvent(this.eventId, { text, mood: this.data.mood, personId: linkedPersonIds[0], personIds: linkedPersonIds, tagsByPerson, tags: [] })
      this.failedTags = [...new Set((this.failedTags || []).concat(this.pendingTags || []))]
      this.pendingTags = []
      await this.retryTagSync()
      const tagSyncFailed = this.data.tagSyncFailed
      this.setUnloadGuard(false)
      this.setData({ editing: false, saving: false, doneEnabled: false })
      this.refresh()
      wx.showToast({ title: tagSyncFailed ? '事件已保存，词库同步失败' : '已更新', icon: tagSyncFailed ? 'none' : 'success' })
    } catch (error) { this.setData({ saving: false }); wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
  },
  remove() {
    if (this.data.saving || this.data.deleting) return
    this.setData({ deleting: true })
    wx.showModal({ title: '删除这条事件？', content: '这条记录会从所有关联人物中删除，无法恢复。', confirmText: '删除', confirmColor: '#b42318', success: async result => {
      if (!result.confirm) { this.setData({ deleting: false }); return }
      wx.showLoading({ title: '删除中', mask: true })
      try {
        await store.deleteEvent(this.eventId)
        wx.hideLoading()
        this.setUnloadGuard(false)
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 600)
      } catch (error) { wx.hideLoading(); this.setData({ deleting: false }); wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
    }, fail: () => this.setData({ deleting: false }) })
  }
})
