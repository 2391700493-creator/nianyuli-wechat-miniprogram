const store = require('../../utils/store')
const fields = ['name', 'note', 'gender', 'relation', 'work', 'city', 'birthday', 'metDate']
Page({
  data: { focusField: '', name: '', note: '', gender: '', relation: '', work: '', city: '', birthday: '', metDate: '', avatarUrl: '', genderIndex: 0, genders: ['不填写', '女', '男', '其他'], saving: false, loading: true, loadFailed: false },
  focusInput(field) {
    this.setData({ focusField: '' }, () => this.setData({ focusField: field }))
  },
  blurInput() { this.setData({ focusField: '' }) },
  dismissKeyboard() { this.setData({ focusField: '' }); if (wx.hideKeyboard) wx.hideKeyboard() },
  onLoad(options) {
    this.personId = options.id
    this.notFoundHandled = false
    this.setUnloadGuard(false)
    this.refresh()
  },
  setUnloadGuard(on) {
    if (!wx.enableAlertBeforeUnload) return
    try {
      if (on) wx.enableAlertBeforeUnload({ message: '资料还没保存，确定离开吗？' })
      else wx.disableAlertBeforeUnload()
    } catch (error) {}
  },
  snapshot() {
    return JSON.stringify(fields.map(field => this.data[field]))
  },
  syncUnloadGuard() { this.setUnloadGuard(this.snapshot() !== this.baselineSnapshot) },
  async refresh() {
    this.setData({ loading: true, loadFailed: false })
    try {
      const data = await store.load()
      const person = data.people.find(item => item.id === this.personId)
      if (!person) {
        if (this.notFoundHandled) return
        this.notFoundHandled = true
        wx.showToast({ title: '人物不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 600)
        return
      }
      const values = {}
      fields.forEach(field => { values[field] = person[field] || '' })
      values.genderIndex = Math.max(0, this.data.genders.indexOf(values.gender))
      values.nameInitial = (values.name || '').trim().charAt(0)
      values.avatarUrl = person.avatarUrl || ''
      values.loading = false
      this.setData(values)
      this.baselineSnapshot = this.snapshot()
      this.syncUnloadGuard()
    } catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  retryLoad() { this.refresh() },
  change(e) {
    if (this.data.saving) return
    const field = e.currentTarget.dataset.field
    const update = { [field]: e.detail.value }
    if (field === 'name') update.nameInitial = (e.detail.value || '').trim().charAt(0)
    this.setData(update)
    this.syncUnloadGuard()
  },
  changeGender(e) { if (this.data.saving) return; const value = this.data.genders[Number(e.detail.value)]; this.setData({ gender: value === '不填写' ? '' : value, genderIndex: Number(e.detail.value) }); this.syncUnloadGuard() },
  async save() {
    if (this.data.saving) return
    if (!this.data.name.trim()) { this.focusInput('name'); return wx.showToast({ title: '请输入名字', icon: 'none' }) }
    const limits = { name: 30, note: 200, relation: 40, work: 40, city: 40 }
    for (const field of Object.keys(limits)) {
      if (this.data[field].trim().length > limits[field]) {
        this.focusInput(field)
        return wx.showToast({ title: `最多填写 ${limits[field]} 字`, icon: 'none' })
      }
    }
    const updates = {}
    fields.forEach(field => { updates[field] = this.data[field].trim() })
    this.dismissKeyboard()
    this.setData({ saving: true })
    try {
      await store.updatePerson(this.personId, updates)
      this.setUnloadGuard(false)
      wx.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) { this.setData({ saving: false }); wx.showToast({ title: '保存失败，请重试', icon: 'none' }) }
  }
})
