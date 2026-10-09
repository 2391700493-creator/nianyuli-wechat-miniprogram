const { normalizeMoods, MOOD_PALETTE, MOOD_NAME_LIMIT, MOOD_MAX, hexToHsv, hsvToHex, clampValue, barStyles } = require('../../utils/moods')

Component({
  properties: {
    show: { type: Boolean, value: false },
    syncState: { type: String, value: '' },
    moods: { type: Array, value: [] }
  },
  data: {
    manage: [], paletteIndex: -2, palette: MOOD_PALETTE,
    newMoodName: '', newMoodColor: MOOD_PALETTE[0], nameFocused: false,
    hsv: { h: 24, s: 44, v: 65 }, bars: barStyles({ h: 24, s: 44, v: 65 })
  },
  observers: {
    show(visible) { if (visible) this.reset() }
  },
  methods: {
    reset() {
      this.setData({
        manage: normalizeMoods(this.data.moods).map(item => ({ ...item })),
        paletteIndex: -2
      })
    },
    noop() {},
    retry() { this.triggerEvent('retry') },
    close() { this.setData({ nameFocused: false }); if (wx.hideKeyboard) wx.hideKeyboard(); this.triggerEvent('close') },
    emit(list) { this.triggerEvent('change', { moods: normalizeMoods(list) }) },
    toast(title) { wx.showToast({ title, icon: 'none' }) },

    // ===== 调色板：色板点选 + 三条滑块微调 =====
    togglePalette(e) {
      const idx = e.currentTarget.dataset.idx
      if (this.data.paletteIndex === idx) return this.setData({ paletteIndex: -2 })
      const base = idx === 'new' ? this.data.newMoodColor : (this.data.manage[idx] || {}).color
      const hsv = hexToHsv(base)
      this.setData({ paletteIndex: idx, hsv, bars: barStyles(hsv) })
    },
    pickColor(e) { this.applyColor(e.currentTarget.dataset.color) },
    applyColor(color) {
      const idx = this.data.paletteIndex
      if (idx === -2) return
      const hsv = hexToHsv(color)
      this.setData({ hsv, bars: barStyles(hsv) })
      this.commit(hsvToHex(hsv.h, hsv.s, hsv.v))
    },
    onSlide(e) {
      const kind = e.currentTarget.dataset.kind
      const raw = Number(e.detail.value)
      if (isNaN(raw)) return
      const hsv = { ...this.data.hsv }
      if (kind === 'hue') hsv.h = raw
      else if (kind === 'sat') hsv.s = raw
      else hsv.v = clampValue(raw)
      this.setData({ hsv, bars: barStyles(hsv) })
      this.commit(hsvToHex(hsv.h, hsv.s, hsv.v), e.type !== 'changing')
    },
    commit(color, persist = true) {
      const idx = this.data.paletteIndex
      if (idx === 'new') return this.setData({ newMoodColor: color })
      const list = this.data.manage.map((item, i) => i === idx ? { ...item, color } : item)
      this.setData({ manage: list })
      if (persist) this.emit(list)
    },

    onDelete(e) {
      if (this.data.manage.length <= 1) return this.toast('至少保留一个心情')
      const list = this.data.manage.filter((_, i) => i !== e.currentTarget.dataset.idx)
      this.setData({ manage: list, paletteIndex: -2 })
      this.emit(list)
    },
    changeNewMood(e) { this.setData({ newMoodName: e.detail.value }) },
    focusName() { this.setData({ nameFocused: false }, () => this.setData({ nameFocused: true })) },
    blurName() { this.setData({ nameFocused: false }) },
    addMood() {
      const name = (this.data.newMoodName || '').trim().slice(0, MOOD_NAME_LIMIT)
      if (!name) { this.focusName(); return this.toast('请输入心情名') }
      if (this.data.manage.some(item => item.name === name)) return this.toast('已有这个心情')
      if (this.data.manage.length >= MOOD_MAX) return this.toast(`最多 ${MOOD_MAX} 个心情`)
      const list = this.data.manage.concat({ name, color: this.data.newMoodColor })
      this.setData({ manage: list, newMoodName: '', newMoodColor: MOOD_PALETTE[0], paletteIndex: -2 })
      this.emit(list)
    }
  }
})
