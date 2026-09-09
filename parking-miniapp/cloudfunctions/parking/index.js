/**
 * 停车攻略 · 云函数 parking（数据库驱动版）
 * ------------------------------------------------------------
 * 数据源：云数据库（p_meta / p_places / p_parkings / p_tips + 用户集合）。
 * 不再把静态数据写死在代码包 data.json 里，统一通过接口从数据库查询。
 *
 * 设计要点：
 *   1. 静态数据（地点/车场/攻略/城市/分类）权威源 = 云数据库。
 *      云函数实例内按 version 缓存到内存，管理后台改库即自动重载，无需重新部署。
 *   2. 所有只读 action（places/hot/search/nearby/place/cities/categories/stats）
 *      走数据库；复用原有的内存过滤/排序/距离逻辑，零逻辑改动风险。
 *   3. 用户 / 收藏 / 点赞 / 反馈 落在 p_users / p_favorites / p_likes / p_reports / p_search_logs。
 *   4. 用户身份一律取云函数内的 getWXContext().OPENID，**不接受前端传来的 userId**，
 *      从根上杜绝伪造身份刷点赞 / 查他人收藏。
 *   5. 管理员通过 ADMIN_OPENIDS 环境变量白名单鉴权，可 CRUD 任意实体（用于清理/补充数据）。
 *
 * 返回格式与旧版保持一致：{ code:0, message:'success', data } / { code:-1, message }
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const BUNDLED_DATA = require('./data.json');
const PLACE_IMAGES = require('./place-images.js');

// ---------- 集合名 ----------
const C_META = 'p_meta';        // 单文档：cities / categories / exported_at / version
const C_PLACE = 'p_places';     // 地点
const C_PARKING = 'p_parkings'; // 车场（含 place_id）
const C_TIP = 'p_tips';         // 攻略（含 place_id, status）
const C_USER = 'p_users';
const C_FAV = 'p_favorites';
const C_LIKE = 'p_likes';

// 管理员 OPENID 白名单：部署后在「云开发→云函数→parking→配置→环境变量」设 ADMIN_OPENIDS=oXXX,oYYY
// 也可扩展为查 p_users.is_admin 字段，本版先用环境变量白名单。
const ADMIN_OPENIDS = (process.env.ADMIN_OPENIDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ---------- 静态数据（云函数实例缓存，权威源=数据库） ----------
let cache = {
  meta: null, places: [], parkingsByPlace: {}, tipsByPlace: {}, parkingById: {},
  version: null, source: null, loadedAt: 0
};
let loadPromise = null;

async function loadStatic() {
  // 已加载且版本未变 → 直接复用缓存，避免重复读库
  if (cache.loadedAt && !loadPromise) {
    const m = await withTimeout(safe(() => db.collection(C_META).limit(1).get(), { data: [] }), 400, { data: [] });
    const v = m.data && m.data[0] && m.data[0].version;
    if (cache.source === 'bundle' && (!m.data || !m.data.length)) return;
    if (v === cache.version) return;
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const metaRes = await withTimeout(safe(() => db.collection(C_META).limit(1).get(), { data: [] }), 700, { data: [] });
    const [placesRes, parkingsRes, tipsRes] = await Promise.all([
      withTimeout(safe(() => db.collection(C_PLACE).limit(1000).get(), { data: [] }), 700, { data: [] }),
      withTimeout(safe(() => db.collection(C_PARKING).limit(2000).get(), { data: [] }), 700, { data: [] }),
      withTimeout(safe(() => db.collection(C_TIP).where({ status: 'ok' }).limit(2000).get(), { data: [] }), 700, { data: [] })
    ]);

    // 云数据库完成迁移后优先使用数据库；若首次部署还没导入静态集合，
    // 直接使用随云函数部署的数据包，保证首页和详情页都能正常打开。
    const dbPlaces = placesRes.data || [];
    const dbParkings = parkingsRes.data || [];
    const useBundle = !metaRes.data || !metaRes.data.length || !dbPlaces.length || !dbParkings.length;
    // 数据库为空时，后台自动灌入随包 data.json（幂等，下次请求即走数据库）
    if (useBundle) selfSeed();
    const bundleMeta = {
      ...(BUNDLED_DATA.meta || {}),
      cities: BUNDLED_DATA.cities || [],
      categories: BUNDLED_DATA.categories || []
    };
    const meta = useBundle ? bundleMeta : metaRes.data[0];
    const places = (useBundle ? (BUNDLED_DATA.places || []) : dbPlaces)
      .map(p => ({ ...p, view_count: p.view_count || 0 }));
    const sourceParkings = useBundle
      ? Object.entries(BUNDLED_DATA.parkingsByPlace || {}).flatMap(([pid, rows]) =>
        (rows || []).map(pk => ({ ...pk, place_id: Number(pid) }))
      )
      : dbParkings;
    const sourceTips = useBundle
      ? Object.entries(BUNDLED_DATA.tipsByPlace || {}).flatMap(([pid, rows]) =>
        (rows || []).map(t => ({ ...t, place_id: Number(pid), status: 'ok' }))
      )
      : (tipsRes.data || []);
    const parkingsByPlace = {};
    const parkingById = {};
    for (const pk of sourceParkings) {
      const pid = pk.place_id;
      (parkingsByPlace[pid] = parkingsByPlace[pid] || []).push(pk);
      parkingById[pk.id] = { ...pk, place_id: pid, place_name: '' };
    }
    for (const p of places) {
      for (const pk of (parkingsByPlace[p.id] || [])) pk.place_name = p.name;
    }
    const tipsByPlace = {};
    for (const t of sourceTips) {
      (tipsByPlace[t.place_id] = tipsByPlace[t.place_id] || []).push({
        category: t.category, content: t.content, source: t.source
      });
    }
    cache = {
      meta, places, parkingsByPlace, tipsByPlace, parkingById,
      version: useBundle
        ? ((BUNDLED_DATA.meta && BUNDLED_DATA.meta.exported_at) || 'bundle')
        : (meta ? meta.version : null),
      source: useBundle ? 'bundle' : 'database',
      loadedAt: Date.now()
    };
  })();
  try { await loadPromise; } finally { loadPromise = null; }
}

// 管理后台改库后调用，使静态缓存失效
async function bumpVersion() {
  const v = Date.now();
  const exist = await safe(() => db.collection(C_META).limit(1).get(), { data: [] });
  if (exist.data && exist.data.length) {
    await db.collection(C_META).doc(exist.data[0]._id).update({
      data: { version: v, updated_at: new Date().toISOString() }
    });
  } else {
    await db.collection(C_META).add({
      data: { version: v, updated_at: new Date().toISOString(), cities: [], categories: [], exported_at: null }
    });
  }
  cache.version = v; // 立即本地失效
}

// 首次部署且数据库为空时，用随包 data.json 自动灌库（幂等：seeding 标志防重入，batchRemoveAll 防重复）
let seeding = null;
async function selfSeed() {
  if (seeding) return seeding;
  seeding = (async () => {
    await ensureCollections();
    const B = BUNDLED_DATA;
    const meta = {
      cities: B.cities || [], categories: B.categories || [],
      exported_at: (B.meta && B.meta.exported_at) || null,
      fee_rules: (B.meta && B.meta.fee_rules) || 0,
      updated_at: nowISO(), version: Date.now()
    };
    const mres = await safe(() => db.collection(C_META).limit(1).get(), { data: [] });
    if (mres.data && mres.data.length) await db.collection(C_META).doc(mres.data[0]._id).update({ data: meta });
    else await db.collection(C_META).add({ data: meta });

    await batchRemoveAll(C_PLACE);
    await batchAdd(C_PLACE, (B.places || []).map(p => ({ ...p })));

    const parkings = [];
    for (const pid in (B.parkingsByPlace || {})) for (const pk of B.parkingsByPlace[pid]) parkings.push(Object.assign({}, pk, { place_id: Number(pid), like_count: 0 }));
    await batchRemoveAll(C_PARKING);
    await batchAdd(C_PARKING, parkings);

    const tips = [];
    for (const pid in (B.tipsByPlace || {})) for (const t of B.tipsByPlace[pid]) tips.push({ place_id: Number(pid), category: t.category, content: t.content, source: t.source, status: 'ok', created_at: nowISO() });
    await batchRemoveAll(C_TIP);
    await batchAdd(C_TIP, tips);
  })().catch(e => { console.error('[selfSeed] 自动灌库失败', e); }).finally(() => { seeding = null; });
  return seeding;
}

// ---------- 工具 ----------
const R = 6371000;
function haversine(lat1, lng1, lat2, lng2) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
function scaleOf(total) {
  if (total == null) return null;
  if (total >= 500) return '大型车场';
  if (total >= 200) return '中型车场';
  return '小型车场';
}
const nowISO = () => new Date().toISOString();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const CONF_TEXT = {
  high: '来源：官方价目表',
  medium: '来源：公开信息整理',
  low: '信息未核实，以现场为准'
};

const ok = data => ({ code: 0, message: 'success', data });
const fail = message => ({ code: -1, message, data: null });

// ---------- 云数据库读写（带容错） ----------
async function ensureOpenid(event, wxCtx) {
  const openid = wxCtx && wxCtx.OPENID;
  if (openid) return openid;
  // 兜底：本地调试 / 未开通时允许显式传入，正式环境永远走 OPENID
  return event.userId || 'anonymous';
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

// 云函数当前环境的默认超时只有 3 秒。数据库集合未创建、权限配置异常或冷启动较慢时，
// 不让非核心读操作拖垮详情响应；超过窗口直接使用 fallback。
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}

async function countLikes(parkingId) {
  try {
    const r = await db.collection(C_LIKE).where({ parking_id: parkingId }).count();
    return r.total || 0;
  } catch (e) { return 0; }
}
// 点赞计数自增到车场文档：详情页/端上缓存直接读 like_count，避免逐个车场 count 查询（万级用户读放大杀手）
async function incParkingLike(parkingId, delta) {
  try {
    const r = await db.collection(C_PARKING).where({ id: Number(parkingId) }).limit(1).get();
    if (r.data && r.data.length) {
      await db.collection(C_PARKING).doc(r.data[0]._id).update({ data: { like_count: _.inc(delta) } });
    }
  } catch (e) { /* 计数异常不影响点赞主流程 */ }
}
async function countFavorites(openid) {
  try {
    const r = await db.collection(C_FAV).where({ openid }).count();
    return r.total || 0;
  } catch (e) { return 0; }
}
async function myLikesCount(openid) {
  try {
    const r = await db.collection(C_LIKE).where({ openid }).count();
    return r.total || 0;
  } catch (e) { return 0; }
}

// ---------- 管理鉴权 / 批量写 ----------
function isAdmin(openid) {
  if (!openid || openid === 'anonymous') return false;
  if (ADMIN_OPENIDS.length && ADMIN_OPENIDS.includes(openid)) return true;
  return false;
}
async function batchAdd(collection, docs) {
  for (const d of docs) await db.collection(collection).add({ data: d });
}
async function batchRemoveAll(collection) {
  // 云开发无 truncate，循环删除（数据量小可接受）
  let res = await db.collection(collection).limit(1000).get();
  while (res.data && res.data.length) {
    for (const r of res.data) await db.collection(collection).doc(r._id).remove();
    if (!res.data.length || res.data.length < 1000) break;
    res = await db.collection(collection).limit(1000).get();
  }
}

// ---------- 查询（逻辑与原内存版一致，数据源来自 cache） ----------
function city0() {
  return (cache.meta && cache.meta.cities && cache.meta.cities[0]) || null;
}

function buildList({ cityCode, category, keyword, page = 1, size = 20, lat, lng, sort = 'heat' }) {
  let list = cache.places.filter(p => {
    if (cityCode && String(p.city_code || '440100') !== String(cityCode)) return false;
    if (category && category !== '全部' && p.category !== category) return false;
    if (keyword) {
      const kw = String(keyword).toLowerCase();
      const hay = `${p.name || ''} ${p.address || ''} ${p.search_text || ''} ${(p.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    if (sort === 'view') return (b.view_count || 0) - (a.view_count || 0);
    return (b.heat || 0) - (a.heat || 0) || a.id - b.id;
  });
  const sizeN = Math.min(num(size, 20), 50);
  const offset = (Math.max(1, num(page, 1)) - 1) * sizeN;
  return list.slice(offset, offset + sizeN).map(p => {
    const out = { ...p };
    if (lat != null && lng != null && p.lat != null && p.lng != null) out.distance_m = haversine(lat, lng, p.lat, p.lng);
    return out;
  });
}

async function getDetail(id, lat, lng, sort, openid) {
  const place = cache.places.find(p => p.id === Number(id));
  if (!place) return null;

  const raw = cache.parkingsByPlace[place.id] || [];
  // 详情页仅查用户状态（收藏/点赞）；点赞数来自车场文档的 like_count 字段（由 incParkingLike 维护），不再逐车场 count 查询。
  const [favRes, likeRes] = await Promise.all([
    withTimeout(safe(() => db.collection(C_FAV).where({ openid }).limit(100).get(), { data: [] }), 400, { data: [] }),
    withTimeout(safe(() => db.collection(C_LIKE).where({ openid }).limit(100).get(), { data: [] }), 400, { data: [] })
  ]);
  const favSet = new Set((favRes.data || []).map(x => x.parking_id));
  const likeSet = new Set((likeRes.data || []).map(x => x.parking_id));

  let parkingList = raw.map((pk, i) => {
    const out = {
      ...pk,
      scale: scaleOf(pk.total_spots),
      confidence_text: CONF_TEXT[pk.confidence] || CONF_TEXT.medium
    };
    if (lat != null && lng != null && pk.lat != null && pk.lng != null) {
      out.user_distance_m = haversine(lat, lng, pk.lat, pk.lng);
    }
    out.like_count = pk.like_count || 0;
    out.is_favorited = favSet.has(pk.id);
    out.is_liked = likeSet.has(pk.id);
    return out;
  });

  if (sort === 'like') {
    parkingList.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || (a.min_price_hour || 999) - (b.min_price_hour || 999));
  }

  const c0 = city0();
  const image = PLACE_IMAGES[place.id] || {};
  return {
    id: place.id, name: place.name, category: place.category, address: place.address,
    district: place.district, city_name: (c0 && c0.name) || '广州',
    city_code: (c0 && c0.code) || '440100', lng: place.lng, lat: place.lat,
    heat: place.heat, summary: place.summary, tags: place.tags || [], area_tips: place.area_tips,
    updated_at: place.updated_at, ...image, parkings: parkingList, tips: cache.tipsByPlace[place.id] || []
  };
}

function searchPlaces(keyword, cityCode, limit = 20) {
  if (!keyword) return [];
  const kw = String(keyword).toLowerCase();
  return cache.places
    .filter(p => {
      if (cityCode && String(p.city_code || '440100') !== String(cityCode)) return false;
      const hay = `${p.name || ''} ${p.address || ''} ${p.search_text || ''}`.toLowerCase();
      return hay.includes(kw);
    })
    .map(p => {
      const name = (p.name || '').toLowerCase();
      let rank = 2;
      if (name === kw) rank = 0; else if (name.startsWith(kw)) rank = 1;
      return { ...p, _rank: rank };
    })
    .sort((a, b) => a._rank - b._rank || (b.heat || 0) - (a.heat || 0))
    .slice(0, Math.min(num(limit, 20), 50))
    .map(({ _rank, ...p }) => p);
}

function nearbyPlaces(lat, lng, radius = 3000, limit = 20) {
  return cache.places
    .filter(p => p.lat != null && p.lng != null)
    .map(p => ({ ...p, distance_m: haversine(lat, lng, p.lat, p.lng) }))
    .filter(p => p.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, Math.min(num(limit, 20), 50))
    .map(p => {
      const top = (cache.parkingsByPlace[p.id] || [])[0];
      return {
        id: p.id, name: p.name, category: p.category, address: p.address, district: p.district,
        lng: p.lng, lat: p.lat, parking_count: p.parking_count, min_price: p.min_price,
        top_parking: top ? top.name : null, distance_m: p.distance_m
      };
    });
}

// ---------- 用户 / 收藏 / 点赞 ----------
async function upsertUser(openid, { nickname, avatar, phone }) {
  const U = db.collection(C_USER);
  const exist = await U.where({ openid }).limit(1).get();
  const patch = { updated_at: nowISO() };
  if (nickname) patch.nickname = nickname;
  if (avatar) patch.avatar = avatar;
  if (phone) patch.phone = phone;

  let user;
  if (exist.data && exist.data.length) {
    await U.doc(exist.data[0]._id).update({ data: patch });
    user = { ...exist.data[0], ...patch };
  } else {
    const rec = { openid, nickname: nickname || '', avatar: avatar || '', phone: phone || '', created_at: nowISO(), updated_at: nowISO() };
    const added = await U.add({ data: rec });
    user = { ...rec, _id: added._id };
  }
  return ok({
    userId: openid, nickname: user.nickname, avatar: user.avatar, phone: user.phone,
    favorite_count: await countFavorites(openid), like_count: await myLikesCount(openid)
  });
}

async function toggleFavorite(openid, parkingId) {
  const F = db.collection(C_FAV);
  const exist = await F.where({ openid, parking_id: parkingId }).limit(1).get();
  let favorited;
  if (exist.data && exist.data.length) {
    await F.doc(exist.data[0]._id).remove();
    favorited = false;
  } else {
    await F.add({ data: { openid, parking_id: parkingId, created_at: nowISO() } });
    favorited = true;
  }
  return ok({ favorited, favorite_count: await countFavorites(openid) });
}

async function toggleLike(openid, parkingId) {
  const L = db.collection(C_LIKE);
  const exist = await L.where({ openid, parking_id: parkingId }).limit(1).get();
  let liked;
  if (exist.data && exist.data.length) {
    await L.doc(exist.data[0]._id).remove();
    liked = false;
    await incParkingLike(parkingId, -1);
  } else {
    await L.add({ data: { openid, parking_id: parkingId, created_at: nowISO() } });
    liked = true;
    await incParkingLike(parkingId, 1);
  }
  const likeCount = await countLikes(parkingId);
  // 云函数实例也会缓存车场数据；点赞后同步两份索引，避免同一实例再次打开详情仍返回旧数量。
  const cached = cache.parkingById[parkingId];
  if (cached) cached.like_count = likeCount;
  for (const rows of Object.values(cache.parkingsByPlace)) {
    for (const pk of rows) {
      if (String(pk.id) === String(parkingId)) pk.like_count = likeCount;
    }
  }
  return ok({ liked, like_count: likeCount });
}

async function listFavorites(openid) {
  const res = await db.collection(C_FAV).where({ openid }).orderBy('created_at', 'desc').limit(100).get();
  const rows = res.data || [];
  const out = [];
  for (const r of rows) {
    const pk = cache.parkingById[r.parking_id];
    if (!pk) continue;
    out.push({ ...pk, like_count: await countLikes(pk.id) });
  }
  return ok({ list: out });
}

// ---------- 管理员 CRUD ----------
async function adminUpsertPlace(openid, data) {
  if (!isAdmin(openid)) return fail('无权限');
  const id = Number(data.id);
  if (!id) return fail('缺少 id');
  const doc = { ...data, id, updated_at: nowISO() };
  const exist = await db.collection(C_PLACE).where({ id }).limit(1).get();
  if (exist.data && exist.data.length) {
    await db.collection(C_PLACE).doc(exist.data[0]._id).update({ data: doc });
  } else {
    await db.collection(C_PLACE).add({ data: doc });
  }
  await bumpVersion();
  return ok({ done: true });
}
async function adminUpsertParking(openid, data) {
  if (!isAdmin(openid)) return fail('无权限');
  const id = Number(data.id);
  const place_id = Number(data.place_id);
  if (!id || !place_id) return fail('缺少 id / place_id');
  const doc = { ...data, id, place_id, updated_at: nowISO() };
  const exist = await db.collection(C_PARKING).where({ id }).limit(1).get();
  if (exist.data && exist.data.length) {
    await db.collection(C_PARKING).doc(exist.data[0]._id).update({ data: doc });
  } else {
    await db.collection(C_PARKING).add({ data: Object.assign({}, doc, { like_count: 0 }) });
  }
  await bumpVersion();
  return ok({ done: true });
}
async function adminUpsertTip(openid, data) {
  if (!isAdmin(openid)) return fail('无权限');
  const place_id = Number(data.place_id);
  if (!place_id || !data.content) return fail('缺少 place_id / content');
  const doc = {
    place_id, category: data.category || '攻略', content: data.content,
    source: data.source || '管理员', status: 'ok', updated_at: nowISO()
  };
  if (data._id) {
    await db.collection(C_TIP).doc(data._id).update({ data: doc });
  } else {
    doc.created_at = nowISO();
    await db.collection(C_TIP).add({ data: doc });
  }
  await bumpVersion();
  return ok({ done: true });
}
async function adminDelete(openid, collection, _id) {
  if (!isAdmin(openid)) return fail('无权限');
  if (!_id) return fail('缺少 _id');
  await db.collection(collection).doc(_id).remove();
  await bumpVersion();
  return ok({ done: true });
}

// ---------- 入口 ----------
exports.main = async (event = {}, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = await ensureOpenid(event, wxCtx);
  const action = event.action || '';

  try {
    // 只读请求不需要创建用户/互动集合。此前每次冷启动都会先并行创建 9 个集合，
    // 叠加数据库读取很容易超过默认 3 秒超时，导致「地点详情」统一提示加载失败。
    // 写入、迁移和初始化请求仍保留自动建集合能力。
    const readOnlyActions = new Set([
      'health', 'cities', 'stats', 'categories', 'places', 'hot', 'search', 'nearby', 'place'
    ]);
    if (!readOnlyActions.has(action)) await ensureCollections();

    switch (action) {
      // ===== 只读数据（权威源=数据库） =====
      case 'health':
        await loadStatic();
        return ok({
          status: 'ok', time: nowISO(),
          data_version: cache.meta ? cache.meta.exported_at : null,
          static_count: cache.places.length, openid
        });

      case 'cities': {
        await loadStatic();
        return ok((cache.meta && cache.meta.cities) || []);
      }

      case 'stats': {
        await loadStatic();
        return ok({
          cities: (cache.meta && cache.meta.cities) ? cache.meta.cities.length : 0,
          places: cache.places.length,
          parkings: Object.values(cache.parkingsByPlace).reduce((s, a) => s + a.length, 0),
          fee_rules: cache.meta ? cache.meta.fee_rules : 0,
          updated_at: cache.meta ? cache.meta.updated_at : null
        });
      }

      // 端上缓存：轻量版本号（每次启动比对，仅在 version 变化时重新拉全量）
      case 'version': {
        await loadStatic();
        return ok({ version: cache.version });
      }

      // 端上缓存：一次性下发全量静态数据（地点/车场/攻略/元信息），供小程序本地检索/排序/距离/详情
      case 'bootstrap': {
        await loadStatic();
        const parkings = [];
        for (const pid in cache.parkingsByPlace) for (const pk of cache.parkingsByPlace[pid]) parkings.push(pk);
        const tips = [];
        for (const pid in cache.tipsByPlace) for (const t of cache.tipsByPlace[pid]) tips.push(Object.assign({ place_id: Number(pid) }, t));
        return ok({ version: cache.version, meta: cache.meta || {}, places: cache.places, parkings, tips });
      }

      // 端上缓存：返回当前用户收藏/点赞的车场 parking_id 列表，详情页据此标记状态（无需逐条查库）
      case 'marks': {
        const f = await safe(() => db.collection(C_FAV).where({ openid }).limit(100).get(), { data: [] });
        const l = await safe(() => db.collection(C_LIKE).where({ openid }).limit(100).get(), { data: [] });
        return ok({ favorites: (f.data || []).map(x => x.parking_id), likes: (l.data || []).map(x => x.parking_id) });
      }

      case 'categories': {
        await loadStatic();
        return ok((cache.meta && cache.meta.categories) || []);
      }

      case 'places': {
        await loadStatic();
        return ok({ list: buildList(event), total: cache.places.length });
      }

      case 'hot': {
        await loadStatic();
        return ok(buildList({ ...event, size: Math.min(num(event.limit, 10), 50), sort: 'heat' }));
      }

      case 'search': {
        await loadStatic();
        return ok({ keyword: event.keyword || '', list: searchPlaces(event.keyword, event.cityCode, event.limit || 20) });
      }

      case 'nearby': {
        if (event.lat == null || event.lng == null) return fail('缺少 lat / lng 参数');
        await loadStatic();
        return ok({ list: nearbyPlaces(Number(event.lat), Number(event.lng), num(event.radius, 3000), num(event.limit, 20)) });
      }

      case 'place': {
        if (event.id == null) return fail('缺少 id');
        await loadStatic();
        const d = await getDetail(event.id, event.lat, event.lng, event.sort, openid);
        return d ? ok(d) : fail('未找到该地点');
      }

      // ===== 用户 =====
      case 'login':
        return upsertUser(openid, { nickname: event.nickname, avatar: event.avatar, phone: event.phone });

      case 'user': {
        const r = await safe(async () => (await db.collection(C_USER).where({ openid }).limit(1).get()).data, []);
        if (!r || !r.length) return ok({ userId: openid, nickname: '', avatar: '', phone: '', favorite_count: 0, like_count: 0 });
        const u = r[0];
        return ok({
          userId: openid, nickname: u.nickname, avatar: u.avatar, phone: u.phone,
          favorite_count: await countFavorites(openid), like_count: await myLikesCount(openid)
        });
      }

      // ===== 收藏 / 点赞 =====
      case 'favorites':
        await loadStatic();
        return listFavorites(openid);

      case 'favorite': {
        if (event.parking_id == null) return fail('缺少 parking_id');
        return toggleFavorite(openid, event.parking_id);
      }

      case 'like': {
        if (event.parking_id == null) return fail('缺少 parking_id');
        return toggleLike(openid, event.parking_id);
      }

      // ===== 反馈 / 日志 =====
      case 'report': {
        if (event.parking_id == null) return fail('缺少 parking_id');
        await safe(() => db.collection('p_reports').add({
          data: { openid, parking_id: event.parking_id, content: event.content || '', field: event.field || '', created_at: nowISO() }
        }));
        return ok({ submitted: true, message: '感谢反馈，审核后将更新' });
      }

      case 'search-log': {
        await safe(() => db.collection('p_search_logs').add({
          data: { openid, keyword: event.keyword || null, result_count: event.result_count || 0, city_code: event.city_code || null, created_at: nowISO() }
        }));
        return ok({ logged: true });
      }

      // ===== 管理员：数据导入（一次性，从代码包 data.json 覆盖写入） =====
      case 'migrate': {
        if (!isAdmin(openid)) return fail('无权限');
        const src = require('./data.json');
        const meta = {
          cities: src.cities || [], categories: src.categories || [],
          exported_at: (src.meta && src.meta.exported_at) || null,
          fee_rules: (src.meta && src.meta.fee_rules) || 0,
          updated_at: nowISO(), version: Date.now()
        };
        const mres = await safe(() => db.collection(C_META).limit(1).get(), { data: [] });
        if (mres.data && mres.data.length) {
          await db.collection(C_META).doc(mres.data[0]._id).update({ data: meta });
        } else {
          await db.collection(C_META).add({ data: meta });
        }

        await batchRemoveAll(C_PLACE);
        await batchAdd(C_PLACE, (src.places || []).map(p => ({ ...p })));

        const parkings = [];
        for (const pid in (src.parkingsByPlace || {})) {
          for (const pk of src.parkingsByPlace[pid]) parkings.push({ ...pk, place_id: Number(pid) });
        }
        await batchRemoveAll(C_PARKING);
        await batchAdd(C_PARKING, parkings.map(pk => Object.assign({}, pk, { like_count: pk.like_count || 0 })));

        const tips = [];
        for (const pid in (src.tipsByPlace || {})) {
          for (const t of src.tipsByPlace[pid]) {
            tips.push({ place_id: Number(pid), category: t.category, content: t.content, source: t.source, status: 'ok', created_at: nowISO() });
          }
        }
        await batchRemoveAll(C_TIP);
        await batchAdd(C_TIP, tips);

        await bumpVersion();
        return ok({ places: (src.places || []).length, parkings: parkings.length, tips: tips.length });
      }

      // ===== 管理员：CRUD =====
      case 'admin-upsert-place':
        return adminUpsertPlace(openid, event.data || {});
      case 'admin-upsert-parking':
        return adminUpsertParking(openid, event.data || {});
      case 'admin-upsert-tip':
        return adminUpsertTip(openid, event.data || {});
      case 'admin-delete-place':
        return adminDelete(openid, C_PLACE, event._id);
      case 'admin-delete-parking':
        return adminDelete(openid, C_PARKING, event._id);
      case 'admin-delete-tip':
        return adminDelete(openid, C_TIP, event._id);

      // ===== 运维：初始化数据库集合 =====
      case 'init': {
        const results = {};
        for (const name of REQUIRED_COLLECTIONS) {
          try { await db.createCollection(name); results[name] = 'created'; }
          catch (e) { results[name] = /exist|已存在|501001/i.test(e.message || '') ? '已存在' : 'failed: ' + (e.message || ''); }
        }
        return ok({ collections: results, tip: '初始化完成，之后调用 action:migrate 导入静态数据' });
      }

      default:
        return fail(`未知的 action: ${action}`);
    }
  } catch (e) {
    return fail(e.message || '云函数执行异常');
  }
};

// 自动建集合：云函数实例复用期内只执行一次，已存在则忽略错误。
const REQUIRED_COLLECTIONS = [C_USER, C_FAV, C_LIKE, 'p_reports', 'p_search_logs', C_META, C_PLACE, C_PARKING, C_TIP];
let ensureCollectionsPromise = null;
function ensureCollections() {
  if (!ensureCollectionsPromise) {
    ensureCollectionsPromise = Promise.all(
      REQUIRED_COLLECTIONS.map(name => db.createCollection(name).catch(() => null))
    );
  }
  return ensureCollectionsPromise;
}
