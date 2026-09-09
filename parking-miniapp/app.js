const { CLOUD_ENV } = require('./utils/config.js');

App({
  globalData: {
    city: { code: '440100', name: '广州' },
    location: null,      // { lat, lng }
    locationReady: false,
    cloudReady: false,
    // Tab 切换事务：pendingIndex 只用于目标页组件首帧定位，不直接改当前页 UI。
    tabBar: {
      current: 0,
      pendingIndex: null,
      switching: false
    }
  },

  onLaunch() {
    this.initCloud();
    this.requestLocation();
    this.warmCache();
    this.preloadTabPages();
  },

  // 首屏稳定后尝试预加载两个 Tab，减少首次进入页面时创建自定义 TabBar 的抖动。
  // 部分基础库没有 wx.preloadPage，因此必须做能力检测并静默跳过。
  preloadTabPages() {
    if (typeof wx.preloadPage !== 'function') return;

    const paths = ['/pages/nearby/nearby', '/pages/mine/mine'];
    setTimeout(() => {
      paths.forEach(url => {
        try {
          wx.preloadPage({ url });
        } catch (e) {
          // 预加载只是体验优化，失败时不影响正常切 Tab。
        }
      });
    }, 200);
  },

  // 启动预热端上缓存：拉一次全量静态数据 + 用户收藏/点赞标记，之后浏览全程本地计算
  warmCache() {
    try {
      const cache = require('./utils/cache.js');
      cache.ensureStatic().catch(() => {});      // 版本未变时只比对不重拉
      cache.ensureUserMarks().catch(() => {});
    } catch (e) { /* 缓存预热失败不影响首屏，api.js 会自动回退云调用 */ }
  },

  // 初始化云开发环境（未配置环境 ID 时静默跳过，页面会走 http 兜底或给出提示）
  initCloud() {
    if (!wx.cloud) {
      console.warn('[cloud] 当前基础库不支持云开发，请调高基础库版本');
      return;
    }
    if (!CLOUD_ENV || /placeholder/.test(CLOUD_ENV)) {
      console.warn('[cloud] 尚未配置 CLOUD_ENV，请到 utils/config.js 填入云开发环境 ID');
      return;
    }
    try {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      this.globalData.cloudReady = true;
    } catch (e) {
      console.error('[cloud] 初始化失败', e);
    }
  },

  // 获取用户定位，只拿经纬度不上传
  requestLocation() {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: false,
      success: (res) => {
        this.globalData.location = { lat: res.latitude, lng: res.longitude };
        this.globalData.locationReady = true;
        this._located = true;
        if (this.locationCallback) this.locationCallback(this.globalData.location);
      },
      fail: () => {
        this.globalData.locationReady = false;
        this._located = true;
        if (this.locationCallback) this.locationCallback(null);
      }
    });
  },

  // 页面注册回调，定位成功返回坐标，失败返回 null（页面自行降级）
  onLocationReady(cb) {
    if (this._located) return cb(this.globalData.location);
    this.locationCallback = cb;
  }
});
