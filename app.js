const cloud = require('./config/cloud')
App({
  globalData: { recordsPersonId: '' },
  onLaunch() {
    if (cloud.envId && wx.cloud) wx.cloud.init({ env: cloud.envId, traceUser: true })
  }
})
