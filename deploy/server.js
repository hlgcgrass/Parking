/**
 * 停车攻略 · 后端 API（零依赖部署版）
 * 纯内存数据 + Node 内置 http，不依赖 SQLite / 任何 npm 包
 * 停车数据来自 data.json（由 server/export-json.js 生成）
 * 互动数据（用户/收藏/点赞）落地 store.json，重启不丢
 * 启动：node server.js（监听 process.env.PORT，绑定 0.0.0.0）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');
const STORE_PATH = path.join(__dirname, 'store.json');

if (!fs.existsSync(DATA_PATH)) {
  console.error('[server] 未找到 data.json，请先运行：node ../server/export-json.js');
  process.exit(1);
}
const DATA = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

// ---------- 互动数据（持久化） ----------
let store = { users: {}, favorites: [], likes: [] };
if (fs.existsSync(STORE_PATH)) {
  try { store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch (e) { /* 损坏则重建 */ }
}
function saveStore() {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(store)); }
  catch (e) { console.error('[store] 写入失败', e.message); }
}

const cities = DATA.cities || [];
const categories = DATA.categories || [];
const places = (DATA.places || []).map(p => ({ ...p, view_count: p.view_count || 0 }));
const parkingsByPlace = DATA.parkingsByPlace || {};
const tipsByPlace = DATA.tipsByPlace || {};

// 停车场全局索引（含所属地点）：用于收藏列表展示
const parkingById = {};
for (const pid in parkingsByPlace) {
  const p = places.find(x => x.id === Number(pid));
  for (const pk of parkingsByPlace[pid]) {
    parkingById[pk.id] = { ...pk, place_id: Number(pid), place_name: p ? p.name : '' };
  }
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
function likeCounts() {
  const m = {};
  for (const l of store.likes) m[l.parking_id] = (m[l.parking_id] || 0) + 1;
  return m;
}
function favoriteCount(userId) {
  return store.favorites.filter(f => f.userId === userId).length;
}
function likeCountOf(userId) {
  return store.likes.filter(l => l.userId === userId).length;
}
function nowISO() { return new Date().toISOString(); }

function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE'
  });
  res.end(body);
}
const ok = (res, data) => json(res, { code: 0, message: 'success', data });
const fail = (res, message, code = 400) => json(res, { code: -1, message, data: null }, code);

const CONF_TEXT = {
  high: '来源：官方价目表',
  medium: '来源：公开信息整理',
  low: '信息未核实，以现场为准'
};
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ---------- 安全防护 ----------
// 轻量密钥：小程序在请求头带 X-Parking-Key，挡掉浏览器/curl 随意调用。
// 注：小程序客户端无法藏住密钥，这只能提高门槛（防随手扒），不是绝对防线；
// 真正敏感的数据后续应迁到带登录态 + 签名校验的正式后端。
const APP_KEY = process.env.APP_KEY || 'pk_parking_2026_xq8';
function checkKey(req) {
  return req.headers['x-parking-key'] === APP_KEY;
}
function clientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
// 滑动窗口限流（按 IP），防批量抓取 / 刷接口
const ipHits = {};
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 120;          // 普通接口每分钟上限
const RATE_MAX_WRITE = 30;     // 写接口（登录/收藏/点赞）更严格
function rateLimited(ip, max) {
  const now = Date.now();
  const arr = (ipHits[ip] || []).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  ipHits[ip] = arr;
  return arr.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const ip in ipHits) ipHits[ip] = ipHits[ip].filter(t => now - t < RATE_WINDOW);
}, 5 * 60 * 1000).unref();

// 请求体大小上限（防大包内存攻击）；login 因含 base64 头像单独放宽
const MAX_BODY = 64 * 1024;
const MAX_BODY_LOGIN = 800 * 1024;
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > max) { reject(new Error('请求体过大')); return; }
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

// ---------- 查询 ----------
function getPlaces({ cityCode, category, keyword, page = 1, size = 20, lat, lng, sort = 'heat' }) {
  let list = places.filter(p => {
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

function getPlaceDetail(id, lat, lng, userId, sort) {
  const place = places.find(p => p.id === Number(id));
  if (!place) return null;

  const lc = likeCounts();
  const favSet = new Set(store.favorites.filter(f => f.userId === userId).map(f => f.parking_id));
  const likeSet = new Set(store.likes.filter(l => l.userId === userId).map(l => l.parking_id));

  let parkingList = (parkingsByPlace[place.id] || []).map(pk => {
    const out = { ...pk, scale: scaleOf(pk.total_spots), confidence_text: CONF_TEXT[pk.confidence] || CONF_TEXT.medium };
    if (lat != null && lng != null && pk.lat != null && pk.lng != null) out.user_distance_m = haversine(lat, lng, pk.lat, pk.lng);
    out.like_count = lc[pk.id] || 0;
    out.is_favorited = favSet.has(pk.id);
    out.is_liked = likeSet.has(pk.id);
    return out;
  });

  if (sort === 'like') {
    parkingList.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || (a.min_price_hour || 999) - (b.min_price_hour || 999));
  }

  place.view_count = (place.view_count || 0) + 1;
  return {
    id: place.id, name: place.name, category: place.category, address: place.address,
    district: place.district, city_name: (cities[0] && cities[0].name) || '广州',
    city_code: (cities[0] && cities[0].code) || '440100', lng: place.lng, lat: place.lat,
    heat: place.heat, summary: place.summary, tags: place.tags || [], area_tips: place.area_tips,
    updated_at: place.updated_at, parkings: parkingList, tips: tipsByPlace[place.id] || []
  };
}

function searchPlaces(keyword, cityCode, limit = 20) {
  if (!keyword) return [];
  const kw = String(keyword).toLowerCase();
  return places
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
  return places
    .filter(p => p.lat != null && p.lng != null)
    .map(p => ({ ...p, distance_m: haversine(lat, lng, p.lat, p.lng) }))
    .filter(p => p.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, Math.min(num(limit, 20), 50))
    .map(p => {
      const top = (parkingsByPlace[p.id] || [])[0];
      return {
        id: p.id, name: p.name, category: p.category, address: p.address, district: p.district,
        lng: p.lng, lat: p.lat, parking_count: p.parking_count, min_price: p.min_price,
        top_parking: top ? top.name : null, distance_m: p.distance_m
      };
    });
}

function getUserFavorites(userId) {
  const lc = likeCounts();
  return store.favorites
    .filter(f => f.userId === userId)
    .map(f => parkingById[f.parking_id])
    .filter(Boolean)
    .map(pk => ({ ...pk, like_count: lc[pk.id] || 0 }));
}

// ---------- 路由 ----------
const routes = {
  'GET /api/health': () => ({ status: 'ok', time: new Date().toISOString(), data_version: DATA.meta.exported_at }),
  'GET /api/cities': () => cities,
  'GET /api/stats': () => ({
    cities: cities.length, places: places.length,
    parkings: Object.values(parkingsByPlace).reduce((s, a) => s + a.length, 0),
    fee_rules: DATA.meta.fee_rules, updated_at: DATA.meta.updated_at
  }),
  'GET /api/categories': () => categories,
  'GET /api/places': q => ({ list: getPlaces(q), total: places.length }),
  'GET /api/search': q => ({ keyword: q.keyword || '', list: searchPlaces(q.keyword, q.cityCode, q.limit || 20) }),
  'GET /api/nearby': q => {
    if (q.lat == null || q.lng == null) throw new Error('缺少 lat / lng 参数');
    return { list: nearbyPlaces(Number(q.lat), Number(q.lng), Number(q.radius) || 3000, Number(q.limit) || 20) };
  },
  'GET /api/hot': q => getPlaces({ ...q, size: Math.min(Number(q.limit) || 10, 50), sort: 'heat' })
};

const searchLogs = [];
const reports = [];

// ---------- 服务 ----------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});

  let pathname = req.url;
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; }
  catch (e) { /* keep */ }
  const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  const q = Object.fromEntries(new URLSearchParams(queryStr).entries());
  ['lat', 'lng'].forEach(k => { if (q[k] != null && q[k] !== '') q[k] = Number(q[k]); });

  try {
    // ===== 安全防护：密钥校验 + 限流 =====
    // 健康检查与首页不强制密钥（便于外部探活）；其余数据接口必须带 X-Parking-Key
    const noKeyPaths = ['/api/health', '/'];
    if (!noKeyPaths.includes(pathname) && !checkKey(req)) {
      return fail(res, '拒绝访问：缺少合法凭证', 403);
    }
    const ip = clientIP(req);
    const isWrite = req.method === 'POST' || req.method === 'DELETE';
    if (rateLimited(ip, isWrite ? RATE_MAX_WRITE : RATE_MAX)) {
      return fail(res, '请求过于频繁，请稍后再试', 429);
    }

    // 详情（支持 userId 与 sort=like）
    const detailMatch = pathname.match(/^\/api\/places\/(\d+)$/);
    if (req.method === 'GET' && detailMatch) {
      const detail = getPlaceDetail(Number(detailMatch[1]), q.lat, q.lng, q.userId, q.sort);
      return detail ? ok(res, detail) : fail(res, '未找到该地点', 404);
    }

    // 用户资料
    const userMatch = pathname.match(/^\/api\/user\/([^/]+)$/);
    if (req.method === 'GET' && userMatch) {
      const u = store.users[userMatch[1]];
      if (!u) return fail(res, '用户不存在', 404);
      return ok(res, { ...u, favorite_count: favoriteCount(u.userId), like_count: likeCountOf(u.userId) });
    }

    // 收藏列表
    const favMatch = pathname.match(/^\/api\/favorites\/([^/]+)$/);
    if (req.method === 'GET' && favMatch) {
      return ok(res, { list: getUserFavorites(favMatch[1]) });
    }

    // 已注册静态路由
    const key = `${req.method} ${pathname}`;
    if (routes[key]) return ok(res, routes[key](q));

    // 首页
    if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        `<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,sans-serif;padding:32px;color:#0F6E56">` +
        `<h2>停车攻略 API 已运行 ✅</h2><p>城市 ${DATA.meta.cities} · 地点 ${DATA.meta.places} · 车场 ${DATA.meta.parkings} · 收费规则 ${DATA.meta.fee_rules}</p>` +
        `<p><a href="/api/health">/api/health</a> · <a href="/api/stats">/api/stats</a> · <a href="/api/places?size=5">/api/places</a></p>` +
        `<p style="color:#085041">数据版本：${DATA.meta.exported_at}</p></body>`
      );
    }

    // 登录 / 同步用户（头像昵称手机号；手机号明文需企业主体 + 后端解密，当前存授权标识或掩码）
    if (req.method === 'POST' && pathname === '/api/login') {
      const b = await readBody(req, MAX_BODY_LOGIN);
      if (!b.userId) return fail(res, '缺少 userId');
      const u = store.users[b.userId] || { userId: b.userId, created_at: nowISO() };
      if (b.nickname) u.nickname = b.nickname;
      if (b.avatar) u.avatar = b.avatar;
      if (b.phone) u.phone = b.phone;
      u.updated_at = nowISO();
      store.users[b.userId] = u;
      saveStore();
      return ok(res, { ...u, favorite_count: favoriteCount(u.userId), like_count: likeCountOf(u.userId) });
    }

    // 收藏（切换）
    if (req.method === 'POST' && pathname === '/api/favorites') {
      const b = await readBody(req);
      if (!b.userId || !b.parking_id) return fail(res, '缺少 userId / parking_id');
      const exists = store.favorites.find(f => f.userId === b.userId && f.parking_id === b.parking_id);
      let favorited;
      if (exists) {
        store.favorites = store.favorites.filter(f => !(f.userId === b.userId && f.parking_id === b.parking_id));
        favorited = false;
      } else {
        store.favorites.push({ userId: b.userId, parking_id: b.parking_id, created_at: nowISO() });
        favorited = true;
      }
      saveStore();
      return ok(res, { favorited, favorite_count: favoriteCount(b.userId) });
    }

    // 点赞（切换，一人一次）
    if (req.method === 'POST' && pathname === '/api/likes') {
      const b = await readBody(req);
      if (!b.userId || !b.parking_id) return fail(res, '缺少 userId / parking_id');
      const exists = store.likes.find(l => l.userId === b.userId && l.parking_id === b.parking_id);
      let liked;
      if (exists) {
        store.likes = store.likes.filter(l => !(l.userId === b.userId && l.parking_id === b.parking_id));
        liked = false;
      } else {
        store.likes.push({ userId: b.userId, parking_id: b.parking_id, created_at: nowISO() });
        liked = true;
      }
      saveStore();
      const lc = likeCounts();
      return ok(res, { liked, like_count: lc[b.parking_id] || 0 });
    }

    // 搜索日志
    if (req.method === 'POST' && pathname === '/api/search-log') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          searchLogs.push({ keyword: d.keyword || null, city_id: d.city_id ?? null, result_count: d.result_count || 0, at: nowISO() });
          ok(res, { logged: true });
        } catch (e) { fail(res, e.message); }
      });
      return;
    }

    // 纠错
    if (req.method === 'POST' && pathname === '/api/reports') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const d = JSON.parse(body || '{}');
          if (!d.parking_id) throw new Error('缺少 parking_id');
          reports.push({ ...d, at: nowISO() });
          ok(res, { submitted: true, message: '感谢反馈，审核后将更新' });
        } catch (e) { fail(res, e.message); }
      });
      return;
    }

    fail(res, `接口不存在: ${pathname}`, 404);
  } catch (e) {
    fail(res, e.message, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\n[server] 停车攻略 API 已启动（端口 ${PORT}）`);
  console.log(`[server] 数据：城市 ${DATA.meta.cities} / 地点 ${DATA.meta.places} / 车场 ${DATA.meta.parkings} / 规则 ${DATA.meta.fee_rules}`);
  console.log(`[server] 本机：http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`[server] 局域网：http://${ip}:${PORT}`));
});
