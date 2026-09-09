const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    statusText: '定位中',
    located: false,
    hasLoc: false,
    lat: null,
    lng: null,
    list: [],
    markers: []
  },

  onLoad() {
    this.initLocation();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().sync(1);
    }
    // 从设置页返回时重试
    if (this.data.located && !this.data.hasLoc) this.reload();
  },

  initLocation() {
    app.onLocationReady((loc) => {
      if (!loc) {
        this.setData({
          located: true,
          hasLoc: false,
          statusText: '未授权定位，无法查找附近车场'
        });
        return;
      }
      this.setData({
        located: true,
        hasLoc: true,
        lat: loc.lat,
        lng: loc.lng,
        statusText: '已定位到你的位置'
      });
      this.loadNearby(loc);
    });
  },

  loadNearby(loc) {
    wx.showLoading({ title: '查找中', mask: true });
    api.nearby(loc.lat, loc.lng, 3000, 20)
      .then(res => {
        const list = (res.list || []).map((x, i) => ({
          ...x,
          distance_text: formatDistance(x.distance_m)
        }));
        const markers = list.map((x, i) => ({
          id: i,
          placeId: x.id,
          latitude: x.lat,
          longitude: x.lng,
          title: x.name,
          width: 24,
          height: 24
        }));
        this.setData({ list, markers });
        wx.hideLoading();
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  reload() {
    const loc = app.globalData.location;
    if (!loc) {
      app.requestLocation();
      this.setData({ located: false, statusText: '定位中' });
      app.onLocationReady(() => this.initLocation());
      return;
    }
    this.setData({ hasLoc: true, lat: loc.lat, lng: loc.lng, statusText: '已定位到你的位置' });
    this.loadNearby(loc);
  },

  openSetting() {
    wx.openSetting({
      success: () => {
        app.requestLocation();
        this.setData({ located: false, statusText: '定位中' });
      }
    });
  },

  onMarkerTap(e) {
    const marker = this.data.markers.find(m => m.id === e.detail.markerId);
    if (marker) this.goDetailById(marker.placeId);
  },

  goDetail(e) {
    this.goDetailById(e.currentTarget.dataset.id);
  },

  goDetailById(id) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});

function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
