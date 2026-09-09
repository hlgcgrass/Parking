const api = require('../../utils/api.js');
const user = require('../../utils/user.js');

Page({
  data: {
    list: [],
    loading: true,
    logged: true
  },

  onShow() {
    if (!user.isLogin()) {
      this.setData({ list: [], loading: false, logged: false });
      return;
    }
    this.setData({ logged: true });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    api.getFavorites(user.getUserId())
      .then(r => this.setData({ list: r.list || [], loading: false }))
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goExplore() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/mine/mine' });
  }
});
