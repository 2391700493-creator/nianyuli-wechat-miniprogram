const store = require('../../utils/store')
const { userMoods, moodColor } = require('../../utils/moods')

Page({
  data: { focusField: '',
    text: '', people: [], mentions: [], personIds: [], pickerPeople: [], pickerOpen: false,
    personQuery: '', mood: '', selectedMoodColor: '', moodPickerOpen: false, moodSheetOpen: false,
    keyboardHeight: 0, moodSyncState: '', moodList: [], saving: false, peopleLoading: true, loadFailed: false,
    tagList: [], tagsByPerson: {}, tagSummary: '', tagPickerOpen: false, tagManagerOpen: false, tagPersonId: '', tagPersonName: '', tagOptions: [], tagName: '', tagRenaming: '', tagBusy: false,
    dateLabel: '', personCreateOpen: false, newPersonName: '', personCreating: false
  },
  formatDateLabel(date) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return `${date.getMonth() + 1}月${date.getDate()}日 周${weekdays[date.getDay()]}`
  },
  focusInput(field) {
    this.setData({ focusField: '' }, () => this.setData({ focusField: field }))
  },
  blurInput() { this.setData({ focusField: '', keyboardHeight: 0 }) },
  dismissKeyboard() { this.setData({ focusField: '', keyboardHeight: 0 }); if (wx.hideKeyboard) wx.hideKeyboard() },
  onKeyboardHeightChange(e) {
    // 只缩放正文区域；人物搜索和心情管理的键盘由各自弹层处理。
    const editing = this.data.focusField === 'text' && !this.data.pickerOpen && !this.data.moodPickerOpen && !this.data.moodSheetOpen && !this.data.tagPickerOpen && !this.data.tagManagerOpen
    const keyboardHeight = editing ? Math.max(0, Number(e.detail.height) || 0) : 0
    if (keyboardHeight !== this.data.keyboardHeight) this.setData({ keyboardHeight })
  },
  onHide() { this.dismissKeyboard() },
  onLoad(options) {
    this.preselectedId = options.personId || ''
    this.setUnloadGuard(false)
  },
  onShow() { this.setData({ dateLabel: this.formatDateLabel(new Date()) }); this.refreshPeople() },
  setUnloadGuard(on) {
    if (!wx.enableAlertBeforeUnload) return
    try {
      if (on) wx.enableAlertBeforeUnload({ message: '内容还没保存，确定离开吗？' })
      else wx.disableAlertBeforeUnload()
    } catch (error) {}
  },
  syncUnloadGuard() {
    this.setUnloadGuard(Boolean(this.data.text.trim() || this.data.mentions.length || this.data.mood))
  },
  async refreshPeople() {
    if (this.peopleRequest) return this.peopleRequest
    this.setData({ peopleLoading: true, loadFailed: false })
    this.peopleRequest = this.loadPeople()
    try { await this.peopleRequest } finally { this.peopleRequest = null }
  },
  async loadPeople() {
    try {
      const data = await store.load()
      this.moodSource = data
      this.setData({ loadFailed: false, moodList: this.data.moodSyncState === 'syncing' ? this.data.moodList : userMoods(data), moodSyncState: this.data.moodSyncState === 'syncing' ? 'syncing' : data.moodsPending ? 'failed' : '' })
      this.syncMoodDisplay()
      this.setData({ tagList: (data.tags || []).filter(tag => !tag.deleted) })
      const people = data.people
      const mentions = this.data.mentions.filter(mention => people.some(person => person.id === mention.id))
      this.setData({ people, mentions, pickerPeople: people.map(person => this.decoratePerson(person, false)) })
      this.syncPersonIds(mentions)
      this.syncUnloadGuard()
      if (this.preselectedId && !this.preselectedInserted) {
        const person = people.find(item => item.id === this.preselectedId)
        if (person) { this.preselectedInserted = true; this.addMention(person) }
      }
    } catch (error) { this.setData({ loadFailed: true }) }
    finally { this.setData({ peopleLoading: false }) }
  },
  retryLoad() { this.refreshPeople() },
  decoratePerson(person, linked) {
    return { ...person, linked, initial: (person.name || '').trim().charAt(0) || '人' }
  },
  syncPersonIds(mentions) {
    const personIds = [...new Set(mentions.map(mention => mention.id))]
    const pickerPeople = this.data.people.filter(person => person.name.includes(this.data.personQuery.trim())).map(person => this.decoratePerson(person, personIds.includes(person.id)))
    const tagsByPerson = {}
    personIds.forEach(id => { if (this.data.tagsByPerson[id]) tagsByPerson[id] = this.data.tagsByPerson[id] })
    this.setData({ personIds, pickerPeople, tagsByPerson })
    this.renderImpressions()
  },
  onTextFocus(e) {
    this.setData({ focusField: 'text' })
    if (e && e.detail && typeof e.detail.height === 'number') this.onKeyboardHeightChange(e)
  },
  onTextInput(e) { if (this.data.saving) return; this.setData({ text: e.detail.value }); this.syncUnloadGuard() },
  openPersonPicker() { if (this.data.saving) return;
    this.returnToText = this.data.focusField === 'text'
    this.dismissKeyboard()
    this.setData({ pickerOpen: true, personQuery: '', pickerPeople: this.data.people.map(person => this.decoratePerson(person, this.data.personIds.includes(person.id))) })
  },
  closePersonPicker() { if (this.data.personCreating) return; this.setData({ pickerOpen: false, personQuery: '', personCreateOpen: false }); this.dismissKeyboard(); if (this.returnToText) this.focusInput('text'); this.returnToText = false },
  openPersonCreate() {
    if (this.data.saving || this.data.peopleLoading || this.data.loadFailed || this.data.personCreating) return
    this.dismissKeyboard()
    this.setData({ personCreateOpen: true, newPersonName: '' })
    this.newPersonDraft = null
    this.focusInput('newPersonName')
  },
  cancelPersonCreate() {
    if (this.data.personCreating) return
    this.dismissKeyboard()
    this.setData({ personCreateOpen: false })
  },
  changePersonName(e) {
    if (this.data.personCreating) return
    this.setData({ newPersonName: e.detail.value })
  },
  async saveNewPerson() {
    if (this.data.personCreating || this.data.saving) return
    const name = this.data.newPersonName.trim()
    if (!name) return wx.showToast({ title: '请输入人物名字', icon: 'none' })
    // 重试复用人物 ID，防止请求已成功但网络响应丢失时重复创建。
    const person = { id: (this.newPersonDraft || {}).id || 'p' + Date.now(), name, avatar: name.slice(0, 1), note: '' }
    this.newPersonDraft = person
    this.dismissKeyboard()
    this.setData({ personCreating: true })
    try {
      const result = await store.addPerson(person)
      const createdPerson = { ...person, id: result && result.id ? result.id : person.id }
      const people = this.data.people.filter(item => item.id !== createdPerson.id).concat(createdPerson)
      this.setData({ people, personQuery: '', personCreateOpen: false, newPersonName: '' })
      this.syncPersonIds(this.data.mentions)
      this.newPersonDraft = null
      wx.showToast({ title: '人物已创建，点击选择', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: '创建失败，请重试', icon: 'none' })
    } finally { this.setData({ personCreating: false }) }
  },
  noop() {},
  searchPerson(e) {
    const personQuery = e.detail.value.trim()
    this.setData({ personQuery, pickerPeople: this.data.people.filter(person => person.name.includes(personQuery)).map(person => this.decoratePerson(person, this.data.personIds.includes(person.id))) })
  },
  pickPerson(e) { if (this.data.saving) return;
    const person = this.data.people.find(item => item.id === e.currentTarget.dataset.id)
    if (!person) return
    if (this.data.personIds.includes(person.id)) {
      const mentions = this.data.mentions.filter(mention => mention.id !== person.id)
      this.setData({ mentions })
      this.syncPersonIds(mentions)
      this.syncUnloadGuard()
      return
    }
    this.addMention(person)
  },
  addMention(person) { if (this.data.saving) return;
    if (this.data.personIds.includes(person.id)) return
    if (this.data.personIds.length >= 10) return wx.showToast({ title: '已关联 10 人，请先移除一人', icon: 'none' })
    const mentions = this.data.mentions.concat({ key: `${Date.now()}-${this.mentionSequence = (this.mentionSequence || 0) + 1}`, id: person.id, name: person.name })
    this.setData({ mentions })
    this.syncPersonIds(mentions)
    this.syncUnloadGuard()
  },
  removeMention(e) { if (this.data.saving) return;
    const mentions = this.data.mentions.filter(mention => mention.key !== e.currentTarget.dataset.key)
    this.setData({ mentions })
    this.syncPersonIds(mentions)
    this.syncUnloadGuard()
  },
  renderImpressions() {
    const tagPersonId = this.data.personIds.includes(this.data.tagPersonId) ? this.data.tagPersonId : (this.data.personIds[0] || '')
    const selected = this.data.tagsByPerson[tagPersonId] || []
    const available = this.data.tagList.filter(tag => tag.active !== false && !tag.deleted).map(tag => tag.name)
    const tagOptions = [...new Set(selected.concat(available))].map(name => ({ name, selected: selected.includes(name) }))
    const tagSummary = this.data.mentions.map(person => {
      const tags = this.data.tagsByPerson[person.id] || []
      return tags.length ? (this.data.mentions.length > 1 ? person.name + '：' : '') + tags.join('、') : ''
    }).filter(Boolean).join('；')
    const person = this.data.people.find(item => item.id === tagPersonId)
    this.setData({ tagPersonId, tagPersonName: person ? person.name : '', tagOptions, tagSummary })
  },
  openTagPicker() {
    if (this.data.saving || this.data.peopleLoading || this.data.loadFailed) return
    if (!this.data.personIds.length) {
      this.openPersonPicker()
      return wx.showToast({ title: '先关联人物，再选择印象', icon: 'none' })
    }
    this.returnToTextFromTags = this.data.focusField === 'text'
    this.dismissKeyboard()
    this.renderImpressions()
    this.setData({ tagPickerOpen: true })
  },
  closeTagPicker() {
    this.dismissKeyboard()
    this.setData({ tagPickerOpen: false })
    if (this.returnToTextFromTags) this.focusInput('text')
    this.returnToTextFromTags = false
  },
  selectTagPerson(e) {
    if (!this.data.personIds.includes(e.currentTarget.dataset.id)) return
    this.setData({ tagPersonId: e.currentTarget.dataset.id })
    this.renderImpressions()
  },
  toggleImpression(e) {
    if (this.data.saving || this.data.tagBusy || !this.data.tagPersonId) return
    const name = e.currentTarget.dataset.name
    if (!this.data.tagOptions.some(tag => tag.name === name)) return
    const id = this.data.tagPersonId
    const selected = this.data.tagsByPerson[id] || []
    if (!selected.includes(name) && selected.length >= 10) return wx.showToast({ title: '每人最多选择10个印象', icon: 'none' })
    this.setData({ tagsByPerson: { ...this.data.tagsByPerson, [id]: selected.includes(name) ? selected.filter(tag => tag !== name) : selected.concat(name) } })
    this.renderImpressions()
    this.syncUnloadGuard()
  },
  clearImpressions() {
    if (this.data.saving || this.data.tagBusy) return
    this.setData({ tagsByPerson: { ...this.data.tagsByPerson, [this.data.tagPersonId]: [] } })
    this.renderImpressions()
  },
  openTagManager() {
    this.dismissKeyboard()
    this.setData({ tagPickerOpen: false, tagManagerOpen: true, tagName: '', tagRenaming: '' })
  },
  closeTagManager() {
    if (this.data.tagBusy) return
    this.dismissKeyboard()
    this.renderImpressions()
    this.setData({ tagManagerOpen: false, tagPickerOpen: true, tagName: '', tagRenaming: '' })
  },
  changeTagName(e) { if (!this.data.tagBusy) this.setData({ tagName: e.detail.value }) },
  startTagRename(e) {
    if (this.data.tagBusy) return
    const name = e.currentTarget.dataset.name
    this.setData({ tagRenaming: name, tagName: name })
    this.focusInput('tagName')
  },
  cancelTagRename() {
    if (this.data.tagBusy) return
    this.dismissKeyboard()
    this.setData({ tagRenaming: '', tagName: '' })
  },
  async saveTagName() {
    if (this.data.tagBusy) return
    const name = this.data.tagName.trim()
    if (!name || name.length > 8) return wx.showToast({ title: name ? '印象词最多8字' : '请输入印象词', icon: 'none' })
    const oldName = this.data.tagRenaming
    this.setData({ tagBusy: true })
    try {
      if (oldName) await store.renameTag(oldName, name)
      else await store.saveTag(name, true)
      const tags = this.data.tagList.filter(tag => tag.name !== name && tag.name !== oldName).concat({ name, active: true })
      const tagsByPerson = {}
      Object.keys(this.data.tagsByPerson).forEach(id => {
        tagsByPerson[id] = [...new Set(this.data.tagsByPerson[id].map(tag => oldName && tag === oldName ? name : tag))]
      })
      this.setData({ tagList: tags, tagsByPerson, tagName: '', tagRenaming: '' })
      this.dismissKeyboard()
      this.renderImpressions()
      wx.showToast({ title: oldName ? '已改名' : '已添加', icon: 'success' })
    } catch (error) { wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
    finally { this.setData({ tagBusy: false }) }
  },
  async toggleManagedTag(e) {
    if (this.data.tagBusy) return
    const tag = this.data.tagList.find(item => item.name === e.currentTarget.dataset.name)
    if (!tag) return
    this.setData({ tagBusy: true })
    try {
      await store.saveTag(tag.name, !tag.active)
      this.setData({ tagList: this.data.tagList.map(item => item.name === tag.name ? { ...item, active: !tag.active } : item) })
      this.renderImpressions()
    } catch (error) { wx.showToast({ title: '操作失败，请重试', icon: 'none' }) }
    finally { this.setData({ tagBusy: false }) }
  },
  deleteManagedTag(e) {
    if (this.data.tagBusy) return
    const name = e.currentTarget.dataset.name
    this.setData({ tagBusy: true })
    wx.showModal({ title: '删除印象词？', content: '从词库删除“' + name + '”，已选和已有记录中的印象会保留。', confirmText: '删除', confirmColor: '#b42318', success: async result => {
      try {
        if (!result.confirm) return
        await store.deleteTag(name)
        this.setData({ tagList: this.data.tagList.filter(tag => tag.name !== name) })
        if (this.data.tagRenaming === name) this.setData({ tagRenaming: '', tagName: '' })
        this.renderImpressions()
      } catch (error) { wx.showToast({ title: '删除失败，请重试', icon: 'none' }) }
      finally { this.setData({ tagBusy: false }) }
    }, fail: () => this.setData({ tagBusy: false }) })
  },
  syncMoodDisplay() {
    this.setData({ selectedMoodColor: moodColor(this.data.mood, this.data.moodList) })
  },
  openMoodPicker() {
    if (this.data.saving || this.data.peopleLoading || this.data.loadFailed) return
    this.returnToTextFromMood = this.data.focusField === 'text'
    this.dismissKeyboard()
    this.setData({ moodPickerOpen: true })
  },
  closeMoodPicker() {
    this.setData({ moodPickerOpen: false })
    if (this.returnToTextFromMood) this.focusInput('text')
    this.returnToTextFromMood = false
  },
  chooseMood(e) {
    if (this.data.saving || this.data.peopleLoading || this.data.loadFailed) return
    const name = e.currentTarget.dataset.name || ''
    if (name && !this.data.moodList.some(item => item.name === name)) return
    this.onSpectrumChange({ detail: { mood: name } })
    this.closeMoodPicker()
  },
  // 保留统一的心情变更入口，选择和取消都会更新离开提醒。
  onSpectrumChange(e) { if (this.data.saving) return;
    this.setData({ mood: e.detail.mood })
    this.syncMoodDisplay()
    this.syncUnloadGuard()
  },
  // ===== 心情管理（组件弹层，即时生效） =====
  openMoodManager() {
    if (this.data.saving || this.data.peopleLoading || this.data.loadFailed) return
    this.returnToMoodPicker = this.data.moodPickerOpen
    this.dismissKeyboard()
    this.setData({ moodPickerOpen: false, moodSheetOpen: true })
  },
  closeMoodManager() {
    this.dismissKeyboard()
    this.setData({ moodSheetOpen: false, moodPickerOpen: Boolean(this.returnToMoodPicker) })
    this.returnToMoodPicker = false
  },
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
  onMoodsChange(e) { if (this.data.saving) return;
    const list = e.detail.moods
    if (!list.length) return
    this.moodSource = { moods: list }
    this.setData({ moodList: list })
    if (this.data.mood && !list.some(item => item.name === this.data.mood)) {
      this.setData({ mood: '' })
      this.syncUnloadGuard()
    }
    this.syncMoodDisplay()
    this.syncMoods(list)
  },
  async save() {
    if (this.data.moodSyncState === 'syncing' || this.data.moodSyncState === 'failed') {
      return wx.showToast({ title: this.data.moodSyncState === 'syncing' ? '心情同步中，请稍候' : '请先重试同步心情设置', icon: 'none' })
    }
    if (this.data.saving || this.data.tagBusy) return
    const description = this.data.text.trim()
    if (!description) { this.focusInput('text'); return wx.showToast({ title: '写下发生的事', icon: 'none' }) }
    const personIds = this.data.personIds
    if (this.data.peopleLoading || this.data.loadFailed) return wx.showToast({ title: this.data.peopleLoading ? '人物加载中，请稍候' : '请先重试加载人物', icon: 'none' })
    if (!personIds.length) { this.openPersonPicker(); return wx.showToast({ title: '关联至少一人', icon: 'none' }) }
    const now = new Date()
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    this.dismissKeyboard()
    this.setData({ saving: true, pickerOpen: false, moodPickerOpen: false, moodSheetOpen: false, tagPickerOpen: false, tagManagerOpen: false })
    try {
      const result = await store.addEvent({ id: 'e' + Date.now(), personId: personIds[0], personIds, date, text: description, mood: this.data.mood, tagsByPerson: this.data.tagsByPerson })
      this.setUnloadGuard(false)
      wx.showToast({ title: '记录成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
      }, 600)
    } catch (error) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  }
})
