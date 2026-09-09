const api = require('../../utils/api.js');
const user = require('../../utils/user.js');
const { DEFAULT_CITY } = require('../../utils/config.js');
const app = getApp();

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
    lat: null,
    lng: null,
    nearbyList: [],
    markers: [],
    stats: {},
    profile: null,
    form: { avatar: '', nickname: '' },
    editingNick: false,
    nickDraft: '',
    busy: false
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
      this.setData({
        locText: loc ? '已开启定位' : '未授权定位',
        located: true,
        hasLoc: !!loc,
        statusText: loc ? '已定位到你的位置' : '未授权定位，无法查找附近车场',
        ...(loc ? { lat: loc.lat, lng: loc.lng } : {})
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
    wx.showLoading({ title: '查找中', mask: true });
    api.nearby(loc.lat, loc.lng, 3000, 20)
      .then(res => {
        const list = (res.list || []).map(x => ({
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
        this.setData({ nearbyList: list, markers });
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

  onChooseAvatar(e) {
    if (this.data.busy) return;
    const tmp = e.detail && e.detail.avatarUrl;
    if (!tmp) return;

    this.setData({ busy: true });
    wx.showLoading({ title: '登录中', mask: true });
    this.toBase64(tmp)
      .then(dataUrl => {
        this.setData({ 'form.avatar': dataUrl });
        return this.completeLogin(this.data.form.nickname, dataUrl);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ busy: false });
        wx.showToast({ title: '头像读取失败，请重试', icon: 'none' });
      });
  },

  onNickInput(e) {
    this.setData({ 'form.nickname': String((e.detail && e.detail.value) || '').trim() });
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

  completeLogin(rawNick, avatar) {
    const nickname = String(rawNick || '').trim() || '微信用户';
    const u = { userId: user.getUserId(), nickname, avatar: avatar || '' };
    return api.login(u)
      .then(p => {
        user.saveUser(u);
        this.setData({
          busy: false,
          profile: {
            nickname,
            avatar: u.avatar,
            phone: p.phone || '',
            initial: nickname[0],
            favorite_count: p.favorite_count || 0,
            like_count: p.like_count || 0
          }
        });
        wx.hideLoading();
        wx.showToast({
          title: nickname === '微信用户' ? '登录成功，可点昵称修改' : '登录成功',
          icon: 'success'
        });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ busy: false });
        wx.showToast({ title: '登录失败，请检查网络后重试', icon: 'none' });
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
          this.setData({ profile: null });
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
