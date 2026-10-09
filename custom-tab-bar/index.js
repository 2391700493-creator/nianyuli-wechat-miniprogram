Component({
  data: {
    selected: 1,
    hidden: false,
    tabs: [
      { pagePath: '/pages/all-records/all-records', text: '记录', icon: '/assets/tab/records.png', activeIcon: '/assets/tab/records-active.png' },
      { pagePath: '/pages/home/home', text: '首页', icon: '/assets/tab/home.png', activeIcon: '/assets/tab/home-active.png' },
      { pagePath: '/pages/people/people', text: '人物', icon: '/assets/tab/people.png', activeIcon: '/assets/tab/people-active.png' }
    ]
  },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (index === this.data.selected) return
      if (index === 0) getApp().globalData.recordsPersonId = null
      wx.switchTab({ url: this.data.tabs[index].pagePath })
    }
  }
})
