const { CLOUD_ENV } = require('./utils/config.js');
const api = require('./utils/api.js');
const PLACE_IMAGES = require('./utils/place-images.js');

App({
  globalData: {
    city: { code: '440100', name: '广州' },
    location: null,      // { lat, lng }
    locationReady: false,
    cloudReady: false,
    // 单页壳内的当前 Tab。
    tabBar: {
      current: 0
    }
  },

  onLaunch() {
    this.initCloud();
    this.requestLocation();
    this.warmCache();
    this.syncPlaceImages();
  },

  // 启动预热端上缓存：拉一次全量静态数据 + 用户收藏/点赞标记，之后浏览全程本地计算
  warmCache() {
    try {
      const cache = require('./utils/cache.js');
      cache.ensureStatic().catch(() => {});      // 版本未变时只比对不重拉
      cache.ensureUserMarks().catch(() => {});
    } catch (e) { /* 缓存预热失败不影响首屏，api.js 会自动回退云调用 */ }
  },

  // 首次启动时把内置地点图迁移到云存储，成功后用本地 fileID，避免重复上传。
  syncPlaceImages() {
    const cache = require('./utils/cache.js');
    const cachedImages = cache.getPlaceImages();
    const needsSync = Object.keys(PLACE_IMAGES).some(id => {
      const item = cachedImages[id] || cachedImages[String(id)];
      return !item || !item.image_file_id || item.image_storage_path !== PLACE_IMAGES[id].image_storage_path;
    });
    if (!needsSync) return;

    try {
      api.syncPlaceImages()
        .then(images => cache.updatePlaceImages(images))
        .catch(err => console.warn('[images] 云存储迁移稍后重试', err));
    } catch (err) {
      console.warn('[images] 云存储迁移稍后重试', err);
    }
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
    // 允许用户在设置页授权后重新发起定位，不复用上一次失败状态。
    this._located = false;
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
        this.globalData.location = null;
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
