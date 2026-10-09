// 心情光谱：点选 / 拖动吸附到心情站点，再点当前心情取消。
// moods = [{ name, color }]（用户词表顺序），value = 已选词或 ''
const THUMB_RPX = 48

const pctFor = (index, total) => (total > 1 ? (index / (total - 1)) * 100 : 0)

function buildSpectrum(list, mood) {
  const total = list.length
  if (!total) {
    return { spectrumGradient: '', spectrumStops: [], moodIndex: -1, spectrumThumbLeft: 0, moodColor: '#d6d3cf' }
  }
  const index = list.findIndex(item => item.name === mood)
  return {
    spectrumGradient: `linear-gradient(to right, ${list.map((item, i) => `${item.color} ${pctFor(i, total).toFixed(2)}%`).join(', ')})`,
    spectrumStops: list.map((item, i) => Number(pctFor(i, total).toFixed(2))),
    moodIndex: index,
    spectrumThumbLeft: index < 0 ? 0 : Number(pctFor(index, total).toFixed(2)),
    moodColor: index < 0 ? '#d6d3cf' : list[index].color
  }
}

Component({
  properties: {
    disabled: { type: Boolean, value: false },
    moods: { type: Array, value: [] },
    value: { type: String, value: '' }
  },
  data: {
    spectrumGradient: '', spectrumStops: [], moodIndex: -1, spectrumThumbLeft: 0, moodColor: '#d6d3cf', dragging: false
  },
  lifetimes: {
    attached() {
      try { this.windowWidth = wx.getWindowInfo().windowWidth } catch (error) { this.windowWidth = 375 }
      this.rebuild(this.data.moods, this.data.value)
      this.__ready = true
    }
  },
  observers: {
    'moods, value': function (moods, value) {
      if (!this.__ready) return
      this.rebuild(moods, value)
    }
  },
  methods: {
    chooseMood(e) { if (!this.data.disabled) this.emitMood(e.currentTarget.dataset.name === this.data.value ? '' : e.currentTarget.dataset.name) },
    rebuild(list, mood) {
      this.setData(buildSpectrum(list || [], mood || ''))
    },
    emitMood(mood) {
      if (this.data.disabled) return
      this.triggerEvent('change', { mood })
    },
    indexFromX(clientX) {
      const rect = this.trackRect
      const total = this.data.moods.length
      if (!rect || total < 2) return 0
      const half = (THUMB_RPX / 2) * this.windowWidth / 750
      const pct = Math.min(1, Math.max(0, (clientX - rect.left - half) / (rect.width - half * 2)))
      return Math.round(pct * (total - 1))
    },
    onTouchStart(e) {
      if (this.data.disabled) return
      const list = this.data.moods
      if (!list.length) return
      const touch = e.touches[0]
      this.createSelectorQuery().select('.spectrum-track').boundingClientRect(rect => {
        if (!rect || this.data.disabled) return
        this.trackRect = rect
        this.dragging = true
        this.startX = touch.clientX
        const index = this.indexFromX(touch.clientX)
        this.pendingDeselect = index === this.data.moodIndex
        if (!this.pendingDeselect) this.emitMood(list[index].name)
        this.setData({ dragging: true })
      }).exec()
    },
    onTouchMove(e) {
      if (!this.dragging) return
      const clientX = e.touches[0].clientX
      if (this.pendingDeselect) {
        // 按住当前心情横向拖动视为改选，未移动则松手时取消
        if (Math.abs(clientX - this.startX) < 8) return
        this.pendingDeselect = false
      }
      const index = this.indexFromX(clientX)
      if (index !== this.data.moodIndex) this.emitMood(this.data.moods[index].name)
    },
    onTouchEnd() {
      if (this.dragging && this.pendingDeselect) this.emitMood('')
      this.dragging = false
      this.pendingDeselect = false
      if (this.data.dragging) this.setData({ dragging: false })
    }
  }
})
