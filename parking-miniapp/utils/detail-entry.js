const user = require('./user.js');

function redirectToLogin(placeId) {
  const app = getApp();
  app.globalData.pendingDetailId = placeId;
  app.globalData.tabBar.current = 0;
  wx.switchTab({ url: '/pages/index/index' });
}

function open(placeId) {
  if (placeId == null || placeId === '') return false;
  if (!user.isLogin()) {
    redirectToLogin(placeId);
    return false;
  }
  wx.navigateTo({ url: `/pages/detail/detail?id=${placeId}` });
  return true;
}

module.exports = { open, redirectToLogin };
