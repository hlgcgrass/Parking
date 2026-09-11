const api = require('../../utils/api.js');
const detailEntry = require('../../utils/detail-entry.js');
const app = getApp();
const DEFAULT_MAP_CENTER = { lat: 23.1291, lng: 113.2644 };

Page({
  data: {
    statusText: '定位中',
    located: false,
    hasLoc: false,
    hasDeviceLoc: false,
    selected: false,
    selectedLocationName: '',
    lat: DEFAULT_MAP_CENTER.lat,
    lng: DEFAULT_MAP_CENTER.lng,
    list: [],
    markers: [],
    nearbyLoading: false
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
      // 用户已经手动选点时，异步定位结果不能把选点结果覆盖掉。
      if (this.data.selected) return;
      if (!loc) {
        this.setData({
          located: true,
          hasLoc: false,
          hasDeviceLoc: false,
          lat: DEFAULT_MAP_CENTER.lat,
          lng: DEFAULT_MAP_CENTER.lng,
          statusText: '未授权定位，无法查找附近车场'
        });
        return;
      }
      this.setData({
        located: true,
        hasLoc: true,
        hasDeviceLoc: true,
        selected: false,
        selectedLocationName: '',
        lat: loc.lat,
        lng: loc.lng,
        statusText: '已定位到你的位置'
      });
      this.loadNearby(loc);
    });
  },

  loadNearby(loc) {
    const requestId = (this._nearbyRequestId || 0) + 1;
    this._nearbyRequestId = requestId;
    this.setData({ nearbyLoading: true });
    wx.showLoading({ title: '查找中', mask: true });
    api.nearby(loc.lat, loc.lng, 3000, 20)
      .then(res => {
        if (requestId !== this._nearbyRequestId) return;
        const list = (res.list || []).map((x, i) => ({
          ...x,
          distance_text: formatDistance(x.distance_m)
        }));
        this.setData({ list, markers: this.buildMarkers(list), nearbyLoading: false });
        wx.hideLoading();
      })
      .catch(() => {
        if (requestId !== this._nearbyRequestId) return;
        this.setData({ nearbyLoading: false });
        wx.hideLoading();
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  reload() {
    const loc = app.globalData.location;
    if (!loc) {
      this._nearbyRequestId = (this._nearbyRequestId || 0) + 1;
      app.requestLocation();
      this.setData({
        located: false,
        hasLoc: false,
        hasDeviceLoc: false,
        selected: false,
        selectedLocationName: '',
        list: [],
        markers: [],
        nearbyLoading: false,
        lat: DEFAULT_MAP_CENTER.lat,
        lng: DEFAULT_MAP_CENTER.lng,
        statusText: '定位中'
      });
      return;
    }
    this.setData({
      located: true,
      hasLoc: true,
      hasDeviceLoc: true,
      selected: false,
      selectedLocationName: '',
      lat: loc.lat,
      lng: loc.lng,
      statusText: '已定位到你的位置'
    });
    this.loadNearby(loc);
  },

  chooseLocation() {
    const options = {};
    if (this.data.lat != null && this.data.lng != null) {
      options.latitude = Number(this.data.lat);
      options.longitude = Number(this.data.lng);
    }

    wx.chooseLocation({
      ...options,
      success: (res) => {
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          wx.showToast({ title: '无法读取所选位置', icon: 'none' });
          return;
        }

        const name = String(res.name || res.address || '已选择位置');
        const loc = { lat, lng };
        this.setData({
          located: true,
          hasLoc: true,
          selected: true,
          selectedLocationName: name,
          lat,
          lng,
          statusText: `已选择：${name}`,
          list: [],
          markers: this.buildMarkers([], loc, name)
        });
        this.loadNearby(loc);
      },
      fail: (err) => {
        if (!/cancel/i.test((err && err.errMsg) || '')) {
          wx.showToast({ title: '打开地图失败，请稍后再试', icon: 'none' });
        }
      }
    });
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
    if (marker && marker.placeId != null) this.goDetailById(marker.placeId);
  },

  goDetail(e) {
    this.goDetailById(e.currentTarget.dataset.id);
  },

  goDetailById(id) {
    detailEntry.open(id);
  },

  buildMarkers(list, selectedLoc, selectedName) {
    const markers = (list || []).map((x, i) => ({
      id: i,
      placeId: x.id,
      latitude: x.lat,
      longitude: x.lng,
      title: x.name,
      width: 24,
      height: 24
    }));
    const loc = selectedLoc || (this.data.selected ? {
      lat: this.data.lat,
      lng: this.data.lng
    } : null);
    if (loc && loc.lat != null && loc.lng != null) {
      markers.unshift({
        id: 99999,
        latitude: loc.lat,
        longitude: loc.lng,
        title: selectedName || this.data.selectedLocationName || '已选择位置',
        width: 28,
        height: 28
      });
    }
    return markers;
  }
});

function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
