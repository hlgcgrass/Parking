/**
 * 接口层：云开发 / HTTP 双通道 + 端上缓存
 * ------------------------------------------------------------
 * 对外导出的方法签名保持不变，页面代码无需任何改动。
 * - 端上缓存优先：只读 action 命中本地缓存时直接返回（检索/排序/距离/详情端上算），
 *   未就绪或缓存缺失时回退云调用；首屏统一拉一次（见 app.js warmCache）。
 * - 收藏/点赞写操作：乐观更新本地标记，使详情/收藏页即时刷新，再异步同步云端。
 * - HTTP 通道保留作兜底（仅 DATA_SOURCE='http' 时生效）。
 */
const { DATA_SOURCE, CLOUD_FUNC, BASE_URL, APP_KEY } = require('./config.js');
const cache = require('./cache.js');
const query = require('./query.js');

const useCloud = DATA_SOURCE === 'cloud';

// 云函数旧版本可能返回未格式化的小时价（例如 1.6666666666666667）。
// 只在展示字段上做兜底，避免影响收费计算和其他业务数值。
function normalizePriceFields(value) {
  if (Array.isArray(value)) return value.map(normalizePriceFields);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  Object.keys(value).forEach(key => {
    let item = value[key];
    if (key === '_priceValue' && item !== '' && item != null) {
      const number = Number(item);
      if (Number.isFinite(number)) item = Math.round((number + Number.EPSILON) * 100) / 100;
    } else if (item && typeof item === 'object') {
      item = normalizePriceFields(item);
    }
    out[key] = item;
  });
  return out;
}

// ---------------- 云开发通道 ----------------
function cloudCall(action, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNC,
      data: Object.assign({ action }, data),
      success(res) {
        const r = res.result || {};
        if (r.code === 0) return resolve(normalizePriceFields(r.data));
        reject(new Error(r.message || '云函数调用失败'));
      },
      fail(err) {
        const msg = err.errMsg || '';
        let hint = '云服务调用失败：' + msg;
        if (/env|Environment|环境/i.test(msg)) {
          hint = '云环境未就绪 → 检查 utils/config.js 的 CLOUD_ENV 是否为真实环境 ID（IDE 顶部「云开发」→ 环境里复制）';
        } else if (/FunctionName|not found|404|不存在/i.test(msg)) {
          hint = '云函数 parking 未部署 → 在 IDE 中右键 cloudfunctions/parking →「上传并部署：云端安装依赖」';
        } else if (/-504003|timeout/i.test(msg)) {
          hint = '云函数执行超时 → 云函数首次调用会冷启动，稍候重试即可';
        }
        reject(new Error(hint));
      }
    });
  }).catch(err => {
    // 首次调用涉及冷启动，失败自动重试一次
    if (/超时|timeout|冷启动/i.test(err.message)) {
      return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: CLOUD_FUNC,
          data: Object.assign({ action }, data),
          success(res) {
            const r = res.result || {};
            r.code === 0
              ? resolve(normalizePriceFields(r.data))
              : reject(new Error(r.message || '云函数调用失败'));
          },
          fail(e2) { reject(new Error(e2.errMsg || '云函数调用失败')); }
        });
      });
    }
    return Promise.reject(err);
  });
}

// ---------------- HTTP 通道（兜底） ----------------
function rawRequest(path, data, method) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      data,
      method,
      header: { 'content-type': 'application/json', 'X-Parking-Key': APP_KEY },
      timeout: 20000,
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.code === 0) {
          resolve(res.data.data);
        } else if (res.statusCode === 403) {
          reject(new Error('接口密钥校验失败：小程序与后端 APP_KEY 不一致'));
        } else {
          reject(new Error((res.data && res.data.message) || `请求失败 ${res.statusCode}`));
        }
      },
      fail(err) {
        const msg = err.errMsg || '网络请求失败';
        let hint = msg;
        if (/domain|合法域名|not in/i.test(msg)) {
          hint = '域名不在白名单 → 真机请开调试模式，或在微信公众平台配置 request 合法域名';
        } else if (/timeout/i.test(msg)) {
          hint = '请求超时 → 后端服务可能已停止，请检查后端或在 config.js 切到 cloud 通道';
        } else if (/fail url|CONNECTION/i.test(msg)) {
          hint = '连接失败 → 后端服务未启动或网络不可达';
        }
        reject(new Error(hint));
      }
    });
  });
}

function httpRequest(path, data = {}, method = 'GET') {
  return rawRequest(path, data, method).catch(err => {
    const needRetry = /域名|超时|连接失败|timeout|CONNECTION/i.test(err.message);
    return needRetry ? rawRequest(path, data, method) : Promise.reject(err);
  });
}

// 本地静态缓存是否可用于只读请求
function localReady() {
  return useCloud && cache.isReady() && cache.getStatic();
}

// 统一分派：云通道下不接收前端传入的 userId（身份由云函数 OPENID 认定）
function call(action, httpPath, httpData, httpMethod) {
  if (useCloud) {
    const d = Object.assign({}, httpData);
    delete d.userId;
    return cloudCall(action, d);
  }
  return httpRequest(httpPath, httpData, httpMethod);
}

// 优先端上缓存，命中失败回退云调用
function fromCacheOrCloud(buildLocal, action, httpPath, httpData, httpMethod) {
  if (localReady()) {
    try { return Promise.resolve(buildLocal()); } catch (e) { /* 端上算出错则回退 */ }
  }
  return call(action, httpPath, httpData, httpMethod);
}

module.exports = {
  // ===== 只读：优先端上缓存 =====
  getCities: () => fromCacheOrCloud(() => query.cities(cache.getStatic()), 'cities', '/api/cities'),
  getStats: () => fromCacheOrCloud(() => query.stats(cache.getStatic()), 'stats', '/api/stats'),
  getCategories: () => fromCacheOrCloud(() => query.categories(cache.getStatic()), 'categories', '/api/categories'),
  getPlaces: (params) => fromCacheOrCloud(
    () => ({ list: query.buildList(cache.getStatic(), params || {}), total: (cache.getStatic().places || []).length }),
    'places', '/api/places', params
  ),
  getPlaceDetail: (id, lat, lng, userId, sort) => {
    if (localReady()) {
      const { fav, like } = cache.getMarks();
      const d = query.getDetailStatic(cache.getStatic(), id, lat, lng, sort, fav, like, cache.getPlaceImages());
      if (d) return Promise.resolve(d); // 命中本地；未找到才回退云（可能数据尚未同步）
    }
    // 云开发调用不使用 HTTP 路径，必须把地点 id 放进云函数 event；
    // HTTP 兜底仍保留原有的 /api/places/:id 路径。
    return call('place', `/api/places/${id}`, { id, lat, lng, userId, sort });
  },
  search: (keyword, cityCode) => fromCacheOrCloud(
    () => ({ keyword: keyword || '', list: query.searchPlaces(cache.getStatic(), keyword, cityCode) }),
    'search', '/api/search', { keyword, cityCode }
  ),
  nearby: (lat, lng, radius) => fromCacheOrCloud(
    () => ({ list: query.nearbyPlaces(cache.getStatic(), lat, lng, radius) }),
    'nearby', '/api/nearby', { lat, lng, radius }
  ),
  hot: (limit = 10) => fromCacheOrCloud(
    () => query.buildList(cache.getStatic(), { size: Math.min(limit || 10, 50), sort: 'heat' }),
    'hot', '/api/hot', { limit }
  ),

  // ===== 写操作 / 日志：走云 =====
  submitReport: (data) => call('report', '/api/reports', data, 'POST'),
  // 管理员图片接口：由后台/管理员工具显式调用，不在小程序启动时自动执行。
  adminAddPlaceImage: (data) => call('admin-add-place-image', '/api/admin/place-images', data, 'POST'),
  adminDeletePlaceImage: (data) => call('admin-delete-place-image', '/api/admin/place-images', data, 'DELETE'),
  // 管理员批量清理 / 导入：默认 dry_run 预览，只有显式确认值才会真实写库。
  adminDeletePlaces: (data) => cloudCall('admin-delete-places', data),
  adminImportGuides: (data) => cloudCall('admin-import-guides', data),
  logSearch: (keyword, resultCount, cityId) =>
    call('search-log', '/api/search-log', { keyword, result_count: resultCount, city_id: cityId }, 'POST'),

  // ===== 用户 / 收藏 / 点赞 =====
  login: (data) => call('login', '/api/login', data, 'POST'),
  getUser: (userId) => call('user', `/api/user/${userId}`).then(r => {
    cache.ensureUserMarks().catch(() => {}); // 登录后顺带刷新本地标记缓存
    return r;
  }),
  getFavorites: (userId) => {
    const getLocalFavorites = () => {
      if (!localReady()) return null;
      const { fav } = cache.getMarks();
      const favoriteIds = Array.from(fav || []);
      const s = cache.getStatic();
      const maps = query.ensureMaps(s);
      const list = favoriteIds
        .map(id => maps.parkingById[id])
        .filter(Boolean)
        .map(pk => Object.assign({}, pk, { like_count: pk.like_count || 0 }));
      // 本地标记为空，或都能映射到车位时直接用本地；否则回退云
      return favoriteIds.length === 0 || list.length === favoriteIds.length ? { list } : null;
    };

    if (!localReady()) return call('favorites', `/api/favorites/${userId}`);

    // 登录后标记刷新是异步的；进入收藏页前先等最新收藏 ID 到位。
    return cache.ensureUserMarks()
      .then(() => {
        const local = getLocalFavorites();
        return local || call('favorites', `/api/favorites/${userId}`);
      })
      .catch(() => call('favorites', `/api/favorites/${userId}`));
  },
  toggleFavorite: (data) => {
    const id = data.parking_id;
    const before = cache.isMarked('fav', id);
    const on = !before;
    cache.updateMark('fav', id, on); // 乐观更新
    return call('favorite', '/api/favorites', data, 'POST').then(r => {
      cache.updateMark('fav', id, !!r.favorited);
      return r;
    }).catch(e => { cache.updateMark('fav', id, before); throw e; });
  },
  toggleLike: (data) => {
    const id = data.parking_id;
    const before = cache.isMarked('like', id);
    const on = !before;
    cache.updateMark('like', id, on); // 乐观更新
    return call('like', '/api/likes', data, 'POST').then(r => {
      cache.updateMark('like', id, !!r.liked);
      // 以服务端计数为准，并同步详情列表、索引和本地持久缓存。
      cache.updateLikeCount(id, r.like_count);
      return r;
    }).catch(e => { cache.updateMark('like', id, before); throw e; });
  },

  // 运维：初始化云数据库集合（控制台/云函数测试里调用一次即可）
  initCloudDB: () => cloudCall('init', {})
};
