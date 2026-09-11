const api = require('../../utils/api.js');
const user = require('../../utils/user.js');
const { DEFAULT_CITY } = require('../../utils/config.js');
const app = getApp();
const DEFAULT_MAP_CENTER = { lat: 23.1291, lng: 113.2644 };

Page({
  data: {
    activeTab: 0,
    cityName: DEFAULT_CITY.name,
    locText: '定位中',
    categories: ['全部'],
    category: '全部',
    guideList: [],
    guideLoading: true,
    statusText: '定位中',
    located: false,
    hasLoc: false,
    hasDeviceLoc: false,
    selected: false,
    selectedLocationName: '',
    lat: DEFAULT_MAP_CENTER.lat,
    lng: DEFAULT_MAP_CENTER.lng,
    nearbyList: [],
    markers: [],
    nearbyLoading: false,
    stats: {},
    profile: null,
    editingNick: false,
    nickDraft: '',
    busy: false,
    loginPromptVisible: false,
    pendingDetailId: null
  },

  onLoad() {
    this.loadCategories();
    this.loadPlaces();
    this.initLocation();
    this.loadStats();
    this.refreshProfile();
  },

  onShow() {
    const index = Number(app.globalData.tabBar.current) || 0;
    if (this.data.activeTab !== index) this.setData({ activeTab: index });
    this.updateNavigationTitle(index);
    this.syncTabBar(index);

    const pendingDetailId = app.globalData.pendingDetailId;
    if (pendingDetailId != null) {
      app.globalData.pendingDetailId = null;
      if (!user.isLogin()) {
        this.setData({
          activeTab: 0,
          loginPromptVisible: true,
          pendingDetailId
        });
        this.updateNavigationTitle(0);
        this.syncTabBar(0);
      } else {
        setTimeout(() => this.goDetailById(pendingDetailId), 0);
      }
    }

    if (index === 1 && this.data.located && !this.data.hasLoc) this.reload();
    if (index === 2) {
      this.loadStats();
      this.refreshProfile();
    }
  },

  onTabSelect(index) {
    const next = Number(index);
    if (next < 0 || next > 2) return;

    app.globalData.tabBar.current = next;
    if (this.data.activeTab !== next) this.setData({ activeTab: next });
    this.updateNavigationTitle(next);
    this.syncTabBar(next);

    if (next === 1 && this.data.located && !this.data.hasLoc) this.reload();
    if (next === 2) {
      this.loadStats();
      this.refreshProfile();
    }
  },

  syncTabBar(index) {
    if (typeof this.getTabBar !== 'function') return;
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.sync(index);
  },

  updateNavigationTitle(index) {
    const titles = ['停车攻略', '附近停车场', '我的'];
    wx.setNavigationBarTitle({ title: titles[index] || titles[0] });
  },

  initLocation() {
    app.onLocationReady((loc) => {
      // 用户已经手动选点时，异步定位结果不能把选点结果覆盖掉。
      if (this.data.selected) return;
      this.setData({
        locText: loc ? '已开启定位' : '未授权定位',
        located: true,
        hasLoc: !!loc,
        hasDeviceLoc: !!loc,
        selected: false,
        selectedLocationName: '',
        statusText: loc ? '已定位到你的位置' : '未授权定位，无法查找附近车场',
        ...(loc ? { lat: loc.lat, lng: loc.lng } : {
          lat: DEFAULT_MAP_CENTER.lat,
          lng: DEFAULT_MAP_CENTER.lng
        })
      });
      if (loc) {
        this.loadPlaces();
        this.loadNearby(loc);
      }
    });
  },

  loadCategories() {
    api.getCategories()
      .then(list => this.setData({ categories: ['全部'].concat(list.map(x => x.name)) }))
      .catch(() => {});
  },

  loadPlaces() {
    this.setData({ guideLoading: true });
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
        this.setData({ guideList: list, guideLoading: false });
      })
      .catch(() => {
        this.setData({ guideLoading: false });
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

  onCityTap() {
    wx.showToast({ title: '当前仅收录广州，其他城市陆续开通', icon: 'none' });
  },

  loadNearby(loc) {
    const requestId = (this._nearbyRequestId || 0) + 1;
    this._nearbyRequestId = requestId;
    this.setData({ nearbyLoading: true });
    wx.showLoading({ title: '查找中', mask: true });
    api.nearby(loc.lat, loc.lng, 3000, 20)
      .then(res => {
        if (requestId !== this._nearbyRequestId) return;
        const list = (res.list || []).map(x => ({
          ...x,
          distance_text: formatDistance(x.distance_m)
        }));
        this.setData({ nearbyList: list, markers: this.buildMarkers(list), nearbyLoading: false });
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
        nearbyList: [],
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
          nearbyList: [],
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
    if (!user.isLogin()) {
      this.setData({ loginPromptVisible: true, pendingDetailId: id });
      return;
    }
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  stopLoginPromptTouch() {},

  closeLoginPrompt() {
    if (this.data.busy) return;
    this.setData({ loginPromptVisible: false, pendingDetailId: null });
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
  },

  loadStats() {
    api.getStats()
      .then(stats => this.setData({
        stats: { ...stats, updated_text: stats.updated_at ? stats.updated_at.slice(0, 7) : '' }
      }))
      .catch(() => {});
  },

  refreshProfile() {
    const local = user.getUser();
    if (!local || !local.nickname) {
      this.setData({ profile: null });
      return;
    }
    api.getUser(user.getUserId())
      .then(p => this.setData({
        profile: {
          nickname: local.nickname,
          avatar: local.avatar || p.avatar || '',
          phone: p.phone || '',
          initial: (local.nickname || '微')[0],
          favorite_count: p.favorite_count || 0,
          like_count: p.like_count || 0
        }
      }))
      .catch(() => this.setData({
        profile: {
          nickname: local.nickname,
          avatar: local.avatar || '',
          phone: '',
          initial: (local.nickname || '微')[0],
          favorite_count: 0,
          like_count: 0
        }
      }));
  },

  // 登录只建立微信身份，不主动索取头像或昵称。
  onLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.getLoginCode()
      .then(code => api.login({ userId: user.getUserId(), code }))
      .then(p => {
        const server = p || {};
        const nickname = String(server.nickname || '').trim() || '微信用户';
        const avatar = server.avatar || '';
        const u = { userId: user.getUserId(), nickname, avatar };
        user.saveUser(u);
        const pendingDetailId = this.data.pendingDetailId;
        this.setData({
          busy: false,
          loginPromptVisible: false,
          pendingDetailId: null,
          profile: {
            nickname,
            avatar,
            phone: server.phone || '',
            initial: nickname[0],
            favorite_count: server.favorite_count || 0,
            like_count: server.like_count || 0
          }
        });
        wx.showToast({ title: '登录成功', icon: 'success' });
        if (pendingDetailId != null) {
          setTimeout(() => this.goDetailById(pendingDetailId), 320);
        }
      })
      .catch(() => {
        this.setData({ busy: false });
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      });
  },

  getLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => res && res.code ? resolve(res.code) : reject(new Error('微信登录凭证获取失败')),
        fail: reject
      });
    });
  },

  // 登录后单独更新头像，不再把头像选择当成登录动作。
  onChooseAvatar(e) {
    if (this.data.busy || !this.data.profile) return;
    const tmp = e.detail && e.detail.avatarUrl;
    if (!tmp) return;

    this.setData({ busy: true });
    wx.showLoading({ title: '保存中', mask: true });
    this.toBase64(tmp)
      .then(dataUrl => {
        const local = user.getUser() || {};
        const nickname = String(local.nickname || (this.data.profile && this.data.profile.nickname) || '微信用户').trim() || '微信用户';
        const next = {
          ...local,
          userId: user.getUserId(),
          nickname,
          avatar: dataUrl
        };
        return api.login({ userId: next.userId, nickname: next.nickname, avatar: next.avatar })
          .then(() => next);
      })
      .then(next => {
        user.saveUser(next);
        this.setData({ busy: false, 'profile.avatar': next.avatar });
        wx.hideLoading();
        wx.showToast({ title: '头像已更新', icon: 'success' });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ busy: false });
        wx.showToast({ title: '头像保存失败，请重试', icon: 'none' });
      });
  },

  onEditNick() {
    this.setData({ editingNick: true, nickDraft: (this.data.profile && this.data.profile.nickname) || '' });
  },

  onNickDraft(e) {
    this.setData({ nickDraft: String((e.detail && e.detail.value) || '').trim() });
  },

  onSaveNick() {
    const nick = String(this.data.nickDraft || '').trim() || '微信用户';
    this.setData({ editingNick: false });
    const cur = (this.data.profile && this.data.profile.nickname) || '';
    if (nick === cur) return;

    const local = user.getUser() || {};
    const next = {
      ...local,
      userId: user.getUserId(),
      nickname: nick,
      avatar: local.avatar || (this.data.profile && this.data.profile.avatar) || ''
    };
    user.saveUser(next);
    this.setData({ 'profile.nickname': nick, 'profile.initial': nick[0] });
    api.login({ userId: next.userId, nickname: nick, avatar: next.avatar })
      .then(() => wx.showToast({ title: '昵称已更新', icon: 'success' }))
      .catch(() => {});
  },

  toBase64(tmpPath) {
    return new Promise((resolve, reject) => {
      const compress = (src) => new Promise(r => {
        wx.compressImage({
          src,
          quality: 50,
          success: res => r(res.tempFilePath || src),
          fail: () => r(src)
        });
      });
      compress(tmpPath).then(path => {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path,
          encoding: 'base64',
          success: r => resolve('data:image/jpeg;base64,' + r.data),
          fail: reject
        });
      });
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后收藏与点赞记录仍在，重新登录即可找回',
      confirmColor: '#0F6E56',
      success: r => {
        if (r.confirm) {
          user.clearUser();
          this.setData({ profile: null, loginPromptVisible: false, pendingDetailId: null });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      }
    });
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  onFeedback() {
    wx.showModal({
      title: '纠错 / 补充',
      editable: true,
      placeholderText: '例如：正佳广场 B3 层现在是 8 元/小时',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        api.submitReport({ parking_id: null, comment: res.content })
          .then(() => wx.showToast({ title: '已收到，感谢反馈', icon: 'none' }))
          .catch(() => wx.showToast({ title: '提交失败，请稍后再试', icon: 'none' }));
      }
    });
  },

  onSuggestPlace() {
    wx.showModal({
      title: '提交地点',
      editable: true,
      placeholderText: '想查哪个地方的停车攻略？',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        api.logSearch(res.content, 0)
          .then(() => wx.showToast({ title: '已记录，会优先补充', icon: 'none' }))
          .catch(() => wx.showToast({ title: '提交失败', icon: 'none' }));
      }
    });
  },

  onShareAppMessage() {
    return { title: '停车攻略 · 出门前先看停哪最便宜', path: '/pages/index/index' };
  }
});

function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${m}m`;
  return `${(m / 1000).toFixed(1)}km`;
}
