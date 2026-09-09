const api = require('../../utils/api.js');
const { DEFAULT_CITY } = require('../../utils/config.js');
const app = getApp();

Page({
  data: {
    cityName: DEFAULT_CITY.name,
    locText: '定位中',
    categories: ['全部'],
    category: '全部',
    list: [],
    loading: true
  },

  onLoad() {
    this.loadCategories();
    this.loadPlaces();
    this.initLocation();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().sync(0);
    }
  },

  initLocation() {
    app.onLocationReady((loc) => {
      this.setData({ locText: loc ? '已开启定位' : '未授权定位' });
      if (loc) this.loadPlaces();
    });
  },

  loadCategories() {
    api.getCategories()
      .then(list => {
        this.setData({ categories: ['全部'].concat(list.map(x => x.name)) });
      })
      .catch(() => {});
  },

  loadPlaces() {
    this.setData({ loading: true });
    const loc = app.globalData.location;
    api.getPlaces({
      cityCode: DEFAULT_CITY.code,
      category: this.data.category,
      size: 50,
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined
    })
      .then(res => {
        const list = (res.list || []).map(x => ({
          ...x,
          distance_text: x.distance_m != null ? formatDistance(x.distance_m) : ''
        }));
        this.setData({ list, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败，请检查网络', icon: 'none' });
      });
  },

  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.cat;
    if (cat === this.data.category) return;
    this.setData({ category: cat });
    this.loadPlaces();
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  onCityTap() {
    wx.showToast({ title: '当前仅收录广州，其他城市陆续开通', icon: 'none' });
  },

  onShareAppMessage() {
    return { title: '停车攻略 · 出门前先看停哪最便宜', path: '/pages/index/index' };
  }
});

function formatDistance(m) {
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
