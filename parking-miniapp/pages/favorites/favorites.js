const api = require('../../utils/api.js');
const user = require('../../utils/user.js');
const detailEntry = require('../../utils/detail-entry.js');
const { displayPrice } = require('../../utils/fee.js');

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
      .then(r => {
        const list = (r.list || []).map(item => {
          const price = displayPrice(item.fee_rules, item.min_price_hour);
          return {
            ...item,
            _hasPrice: !!price,
            _priceValue: price ? price.value : '',
            _priceUnit: price ? price.unit : ''
          };
        });
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    detailEntry.open(id);
  },

  goExplore() {
    const app = getApp();
    app.globalData.tabBar.current = 0;
    wx.switchTab({ url: '/pages/index/index' });
  },

  goLogin() {
    const app = getApp();
    app.globalData.tabBar.current = 2;
    wx.switchTab({ url: '/pages/index/index' });
  }
});
