/**
 * 停车攻略 · 后端 API 服务
 * 零依赖：Node 内置 http + node:sqlite
 * 启动：node server.js
 */
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'parking.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('[server] 未找到数据库，请先运行：node db.js');
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH);

// ---------- 工具 ----------
const R = 6371000; // 地球半径（米）
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

function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function ok(res, data) {
  json(res, { code: 0, message: 'success', data });
}
function fail(res, message, code = 400) {
  json(res, { code: -1, message, data: null }, code);
}

// 置信度中文文案（前端直接展示，保证诚实）
const CONF_TEXT = {
  high: '来源：官方价目表',
  medium: '来源：公开信息整理',
  low: '信息未核实，以现场为准'
};

// ---------- 查询封装 ----------
function getPlaces({ cityCode, category, keyword, page = 1, size = 20, lat, lng, sort = 'heat' }) {
  const where = ['p.status = 1'];
  const args = [];
  if (cityCode) { where.push('c.code = ?'); args.push(cityCode); }
  if (category && category !== '全部') { where.push('p.category = ?'); args.push(category); }
  if (keyword) {
    where.push('(p.search_text LIKE ? OR p.name LIKE ? OR p.address LIKE ?)');
    const kw = `%${keyword}%`;
    args.push(kw, kw, kw);
  }
  const offset = (Math.max(1, page) - 1) * size;
  let order = 'p.heat DESC, p.id ASC';
  if (sort === 'view') order = 'p.view_count DESC';

  const sql = `
    SELECT p.id, p.name, p.category, p.address, p.lng, p.lat, p.heat, p.summary, p.tags,
           p.area_tips, d.name AS district,
           (SELECT COUNT(*) FROM place_parking pp WHERE pp.place_id = p.id) AS parking_count,
           (SELECT MIN(pk.min_price_hour) FROM place_parking pp
              JOIN parkings pk ON pk.id = pp.parking_id
             WHERE pp.place_id = p.id AND pk.status = 1 AND pk.min_price_hour > 0) AS min_price
      FROM places p
      LEFT JOIN cities c ON c.id = p.city_id
      LEFT JOIN districts d ON d.id = p.district_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT ? OFFSET ?`;

  const rows = db.prepare(sql).all(...args, Number(size), offset);
  return rows.map(r => {
    const out = {
      id: r.id, name: r.name, category: r.category, address: r.address,
      district: r.district, lng: r.lng, lat: r.lat, heat: r.heat,
      summary: r.summary, tags: safeJson(r.tags), area_tips: r.area_tips,
      parking_count: r.parking_count, min_price: r.min_price
    };
    if (lat != null && lng != null && r.lat != null && r.lng != null) {
      out.distance_m = haversine(lat, lng, r.lat, r.lng);
    }
    return out;
  });
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

function getPlaceDetail(id, lat, lng) {
  const place = db.prepare(`
    SELECT p.*, d.name AS district, c.name AS city_name, c.code AS city_code
      FROM places p
      LEFT JOIN cities c ON c.id = p.city_id
      LEFT JOIN districts d ON d.id = p.district_id
     WHERE p.id = ? AND p.status = 1
  `).get(id);
  if (!place) return null;

  const parkings = db.prepare(`
    SELECT pk.*, pp.distance_m, pp.walk_minutes, pp.is_recommended
      FROM place_parking pp
      JOIN parkings pk ON pk.id = pp.parking_id
     WHERE pp.place_id = ? AND pk.status = 1
     ORDER BY pp.sort_weight DESC, pk.min_price_hour ASC
  `).all(id);

  const feeStmt = db.prepare(
    `SELECT rule_type, start_minute, end_minute, time_start, time_end, price, unit, unit_minutes, description, confidence
       FROM fee_rules WHERE parking_id = ? ORDER BY priority DESC`
  );

  const parkingList = parkings.map(pk => {
    const out = {
      id: pk.id, name: pk.name, address: pk.address, type: pk.type,
      total_spots: pk.total_spots, scale: scaleOf(pk.total_spots),
      lng: pk.lng, lat: pk.lat,
      free_minutes: pk.free_minutes, daily_cap: pk.daily_cap, night_flat: pk.night_flat,
      open_hours: pk.open_hours, payment: safeJson(pk.payment),
      min_price_hour: pk.min_price_hour, tips: pk.tips,
      source: pk.source, confidence: pk.confidence,
      confidence_text: CONF_TEXT[pk.confidence] || CONF_TEXT.medium,
      verified_at: pk.verified_at,
      distance_m: pk.distance_m, walk_minutes: pk.walk_minutes,
      is_recommended: pk.is_recommended,
      fee_rules: feeStmt.all(pk.id)
    };
    if (lat != null && lng != null && pk.lat != null && pk.lng != null) {
      out.user_distance_m = haversine(lat, lng, pk.lat, pk.lng);
    }
    return out;
  });

  const tips = db.prepare(
    `SELECT category, content, source FROM tips
      WHERE target_type = 'place' AND target_id = ? AND status = 1 ORDER BY id`
  ).all(id);

  db.prepare('UPDATE places SET view_count = view_count + 1 WHERE id = ?').run(id);

  return {
    id: place.id, name: place.name, category: place.category,
    address: place.address, district: place.district,
    city_name: place.city_name, city_code: place.city_code,
    lng: place.lng, lat: place.lat, heat: place.heat,
    summary: place.summary, tags: safeJson(place.tags),
    area_tips: place.area_tips, updated_at: place.updated_at,
    parkings: parkingList, tips
  };
}

function searchPlaces(keyword, cityCode, limit = 20) {
  if (!keyword) return [];
  const kw = `%${keyword}%`;
  const args = [kw, kw, kw];
  let cityClause = '';
  if (cityCode) { cityClause = 'AND c.code = ?'; args.push(cityCode); }
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.address, p.lng, p.lat, d.name AS district,
           (SELECT MIN(pk.min_price_hour) FROM place_parking pp
              JOIN parkings pk ON pk.id = pp.parking_id
             WHERE pp.place_id = p.id AND pk.status = 1 AND pk.min_price_hour > 0) AS min_price
      FROM places p
      LEFT JOIN cities c ON c.id = p.city_id
      LEFT JOIN districts d ON d.id = p.district_id
     WHERE p.status = 1 ${cityClause}
       AND (p.name LIKE ? OR p.address LIKE ? OR p.search_text LIKE ?)
     ORDER BY
       CASE WHEN p.name = ? THEN 0
            WHEN p.name LIKE ? THEN 1
            ELSE 2 END,
       p.heat DESC
     LIMIT ?
  `).all(...args, keyword, `${keyword}%`, Number(limit));
  return rows;
}

// 附近可停车的地点。
// 说明：停车场坐标尚未采集（113 个车场均无经纬度），因此不做「车场级」附近查询，
// 避免用目的地坐标冒充车场坐标。按目的地聚合返回，坐标是目的地真实坐标。
function nearbyPlaces(lat, lng, radius = 3000, limit = 20) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.address, p.lng, p.lat, p.heat, d.name AS district,
           (SELECT COUNT(*) FROM place_parking pp WHERE pp.place_id = p.id) AS parking_count,
           (SELECT MIN(pk.min_price_hour) FROM place_parking pp
              JOIN parkings pk ON pk.id = pp.parking_id
             WHERE pp.place_id = p.id AND pk.status = 1 AND pk.min_price_hour > 0) AS min_price,
           (SELECT pk.name FROM place_parking pp
              JOIN parkings pk ON pk.id = pp.parking_id
             WHERE pp.place_id = p.id AND pk.status = 1 AND pk.min_price_hour > 0
             ORDER BY pp.sort_weight DESC LIMIT 1) AS top_parking
      FROM places p
      LEFT JOIN districts d ON d.id = p.district_id
     WHERE p.status = 1 AND p.lat IS NOT NULL AND p.lng IS NOT NULL
  `).all();

  return rows
    .map(r => ({ ...r, distance_m: haversine(lat, lng, r.lat, r.lng) }))
    .filter(r => r.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit)
    .map(r => ({
      id: r.id, name: r.name, category: r.category, address: r.address,
      district: r.district, lng: r.lng, lat: r.lat,
      parking_count: r.parking_count, min_price: r.min_price,
      top_parking: r.top_parking, distance_m: r.distance_m
    }));
}

// ---------- 路由 ----------
const routes = {
  'GET /api/health': () => ({ status: 'ok', time: new Date().toISOString() }),

  'GET /api/cities': () =>
    db.prepare('SELECT id, name, code, pinyin, province, lng, lat, hot_level FROM cities WHERE status = 1 ORDER BY hot_level DESC, id').all(),

  'GET /api/stats': () => ({
    cities: db.prepare('SELECT COUNT(*) c FROM cities WHERE status = 1').get().c,
    places: db.prepare('SELECT COUNT(*) c FROM places WHERE status = 1').get().c,
    parkings: db.prepare('SELECT COUNT(*) c FROM parkings WHERE status = 1').get().c,
    fee_rules: db.prepare('SELECT COUNT(*) c FROM fee_rules').get().c,
    updated_at: db.prepare('SELECT MAX(updated_at) t FROM places').get().t
  }),

  'GET /api/categories': () =>
    db.prepare('SELECT category AS name, COUNT(*) AS count FROM places WHERE status = 1 GROUP BY category ORDER BY count DESC').all(),

  'GET /api/places': (q) => ({
    list: getPlaces(q),
    total: db.prepare('SELECT COUNT(*) AS c FROM places WHERE status = 1').get().c
  }),

  'GET /api/search': (q) => ({
    keyword: q.keyword || '',
    list: searchPlaces(q.keyword, q.cityCode, q.limit || 20)
  }),

  'GET /api/nearby': (q) => {
    if (q.lat == null || q.lng == null) throw new Error('缺少 lat / lng 参数');
    return { list: nearbyPlaces(Number(q.lat), Number(q.lng), Number(q.radius) || 3000, Number(q.limit) || 20) };
  },

  'GET /api/hot': (q) => getPlaces({ ...q, size: Number(q.limit) || 10, sort: 'heat' })
};

// ---------- 服务 ----------
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, {});

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const q = Object.fromEntries(url.searchParams.entries());
  ['lat', 'lng'].forEach(k => { if (q[k] != null && q[k] !== '') q[k] = Number(q[k]); });

  try {
    // 详情 /places/:id
    const detailMatch = pathname.match(/^\/api\/places\/(\d+)$/);
    if (req.method === 'GET' && detailMatch) {
      const detail = getPlaceDetail(Number(detailMatch[1]), q.lat, q.lng);
      return detail ? ok(res, detail) : fail(res, '未找到该地点', 404);
    }

    const key = `${req.method} ${pathname}`;
    if (routes[key]) return ok(res, routes[key](q));

    // 搜索日志（补数据风向标）
    if (req.method === 'POST' && pathname === '/api/search-log') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const { keyword, city_id, result_count } = JSON.parse(body || '{}');
          db.prepare('INSERT INTO search_logs (keyword, city_id, result_count) VALUES (?,?,?)')
            .run(keyword || null, city_id || null, result_count || 0);
          ok(res, { logged: true });
        } catch (e) { fail(res, e.message); }
      });
      return;
    }

    // 用户上报实价 / 纠错
    if (req.method === 'POST' && pathname === '/api/reports') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const { parking_id, price_paid, duration_minutes, comment, images } = JSON.parse(body || '{}');
          if (!parking_id) throw new Error('缺少 parking_id');
          db.prepare(
            `INSERT INTO price_reports (parking_id, price_paid, duration_minutes, comment, images)
             VALUES (?,?,?,?,?)`
          ).run(parking_id, price_paid ?? null, duration_minutes ?? null, comment || null, JSON.stringify(images || []));
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

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  console.log(`\n[server] 停车攻略 API 已启动`);
  console.log(`[server] 本机：http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`[server] 局域网：http://${ip}:${PORT}  （真机调试用这个）`));
  console.log(`[server] 接口：/api/health /api/cities /api/places /api/places/:id /api/search /api/nearby /api/hot`);
});
