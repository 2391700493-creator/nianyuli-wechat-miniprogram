const store = require('../../utils/store')
Page({
  data: { focusField: '', tags: [], name: '', renaming: '', newName: '', busy: false, loading: true, loadFailed: false },
  focusInput(field) {
    this.setData({ focusField: '' }, () => this.setData({ focusField: field }))
  },
  blurInput() { this.setData({ focusField: '' }) },
  dismissKeyboard() { this.setData({ focusField: '' }); if (wx.hideKeyboard) wx.hideKeyboard() },
  onShow() { this.refresh() },
  async refresh() {
    this.setData({ loading: !this.data.tags.length, loadFailed: false })
    try { this.setData({ tags: await store.getTags(), loading: false }) }
    catch (error) { this.setData({ loading: false, loadFailed: true }) }
  },
  retryLoad() { this.refresh() },
  changeName(e) { if (this.data.busy) return; this.setData({ name: e.detail.value }) },
  startRename(e) {
    if (this.data.busy) return
    const name = e.currentTarget.dataset.name
    this.setData({ renaming: name, newName: name }); this.focusInput('newName')
  },
  cancelRename() {
    if (this.data.busy) return
    if (this.data.newName.trim() && this.data.newName.trim() !== this.data.renaming) {
      wx.showModal({ title: '放弃改名？', content: '已输入的新名字不会保存。', confirmText: '放弃', confirmColor: '#b42318', success: result => {
        if (result.confirm) { this.dismissKeyboard(); this.setData({ renaming: '', newName: '' }) }
      } })
      return
    }
    this.dismissKeyboard()
    this.setData({ renaming: '', newName: '' })
  },
  changeNewName(e) { if (this.data.busy) return; this.setData({ newName: e.detail.value }) },
  async saveRename() {
    if (this.data.busy) return
    const name = this.data.newName.trim()
    if (name.length > 8) return wx.showToast({ title: '印象词最多 8 字', icon: 'none' })
    if (!name) { this.focusInput('newName'); return wx.showToast({ title: '请输入新名字', icon: 'none' }) }
    this.setData({ busy: true })
    try {
      const oldName = this.data.renaming
      await store.renameTag(oldName, name)
      const target = name !== oldName && this.data.tags.some(tag => tag.name === name)
      const tags = target ? this.data.tags.filter(tag => tag.name !== oldName).map(tag => tag.name === name ? { ...tag, active: true } : tag) : this.data.tags.map(tag => tag.name === oldName ? { ...tag, name } : tag)
      this.setData({ tags, renaming: '', newName: '' })
      this.dismissKeyboard()
      wx.showToast({ title: '已改名', icon: 'success' })
    }
    catch (error) { wx.showToast({ title: '改名失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async add() {
    if (this.data.busy) return
    const name = this.data.name.trim()
    if (name.length > 8) return wx.showToast({ title: '印象词最多 8 字', icon: 'none' })
    if (!name) { this.focusInput('name'); return wx.showToast({ title: '请输入词语', icon: 'none' }) }
    this.setData({ busy: true })
    try {
      await store.saveTag(name, true)
      const exists = this.data.tags.some(tag => tag.name === name)
      const tags = exists ? this.data.tags.map(tag => tag.name === name ? { ...tag, active: true } : tag) : this.data.tags.concat({ name, active: true })
      this.setData({ tags, name: '' })
      this.dismissKeyboard()
      wx.showToast({ title: exists ? '已启用' : '已添加', icon: 'success' })
    }
    catch (error) { wx.showToast({ title: '保存失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async toggle(e) {
    if (this.data.busy) return
    const name = e.currentTarget.dataset.name
    const tag = this.data.tags.find(item => item.name === name)
    if (!tag) return
    this.setData({ busy: true })
    try { await store.saveTag(name, !tag.active); this.setData({ tags: this.data.tags.map(item => item.name === name ? { ...item, active: !tag.active } : item) }); wx.showToast({ title: tag.active ? '已停用' : '已启用', icon: 'success' }) }
    catch (error) { wx.showToast({ title: '操作失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  remove(e) {
    if (this.data.busy) return
    const name = e.currentTarget.dataset.name
    this.setData({ busy: true })
    wx.showModal({ title: '删除词语', content: `从词库删除“${name}”？已有记录中的词仍会保留。`, confirmText: '删除', confirmColor: '#b42318', success: async result => {
      if (!result.confirm) { this.setData({ busy: false }); return }
      try { await store.deleteTag(name); this.setData({ tags: this.data.tags.filter(tag => tag.name !== name) }); wx.showToast({ title: '已删除', icon: 'success' }) }
      catch (error) { wx.showToast({ title: '删除失败', icon: 'none' }) }
      finally { this.setData({ busy: false }) }
    }, fail: () => this.setData({ busy: false }) })
  }
})
