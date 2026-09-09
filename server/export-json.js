/**
 * 导出「API 就绪」的静态数据，供零依赖部署版 server 使用。
 * 用法：node export-json.js  → 生成 ../deploy/data.json
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'parking.db');
const OUT_DIR = path.join(ROOT, 'deploy');

if (!fs.existsSync(DB_PATH)) {
  console.error('[export] 未找到 parking.db，请先运行：node db.js');
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH);

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

const cities = db
  .prepare('SELECT id, name, code, pinyin, province, lng, lat, hot_level FROM cities WHERE status = 1 ORDER BY hot_level DESC, id')
  .all();

const categories = db
  .prepare('SELECT category AS name, COUNT(*) AS count FROM places WHERE status = 1 GROUP BY category ORDER BY count DESC')
  .all();

const places = db
  .prepare(`
    SELECT p.id, p.name, p.category, p.address, p.lng, p.lat, p.heat, p.summary, p.tags,
           p.area_tips, p.search_text, p.view_count, p.updated_at,
           d.name AS district, c.code AS city_code,
           (SELECT COUNT(*) FROM place_parking pp WHERE pp.place_id = p.id) AS parking_count,
           (SELECT MIN(pk.min_price_hour) FROM place_parking pp
              JOIN parkings pk ON pk.id = pp.parking_id
             WHERE pp.place_id = p.id AND pk.status = 1 AND pk.min_price_hour > 0) AS min_price
      FROM places p
      LEFT JOIN districts d ON d.id = p.district_id
      LEFT JOIN cities c ON c.id = p.city_id
     WHERE p.status = 1
     ORDER BY p.id
  `)
  .all()
  .map(p => ({ ...p, tags: safeJson(p.tags) }));

const parkingRows = db
  .prepare(`
    SELECT pk.*, pp.place_id, pp.distance_m, pp.walk_minutes, pp.is_recommended, pp.sort_weight
      FROM place_parking pp
      JOIN parkings pk ON pk.id = pp.parking_id
     WHERE pk.status = 1
     ORDER BY pp.place_id, pp.sort_weight DESC, pk.min_price_hour ASC
  `)
  .all();

const feeStmt = db.prepare(
  `SELECT rule_type, start_minute, end_minute, time_start, time_end, price, unit, unit_minutes, description, confidence, priority
     FROM fee_rules WHERE parking_id = ? ORDER BY priority DESC`
);

const parkingsByPlace = {};
for (const pk of parkingRows) {
  (parkingsByPlace[pk.place_id] ||= []).push({
    id: pk.id,
    name: pk.name,
    address: pk.address,
    type: pk.type,
    total_spots: pk.total_spots,
    lng: pk.lng,
    lat: pk.lat,
    free_minutes: pk.free_minutes,
    daily_cap: pk.daily_cap,
    night_flat: pk.night_flat,
    open_hours: pk.open_hours,
    payment: safeJson(pk.payment),
    min_price_hour: pk.min_price_hour,
    tips: pk.tips,
    source: pk.source,
    confidence: pk.confidence,
    verified_at: pk.verified_at,
    distance_m: pk.distance_m,
    walk_minutes: pk.walk_minutes,
    is_recommended: pk.is_recommended,
    fee_rules: feeStmt.all(pk.id)
  });
}

const tipsByPlace = {};
for (const t of db
  .prepare(`SELECT target_id, category, content, source FROM tips WHERE target_type = 'place' AND status = 1 ORDER BY id`)
  .all()) {
  (tipsByPlace[t.target_id] ||= []).push({ category: t.category, content: t.content, source: t.source });
}

const stats = {
  cities: cities.length,
  places: places.length,
  parkings: parkingRows.length,
  fee_rules: db.prepare('SELECT COUNT(*) c FROM fee_rules').get().c,
  updated_at: db.prepare('SELECT MAX(updated_at) t FROM places').get().t
};

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const out = {
  meta: { city: '广州', city_code: '440100', exported_at: new Date().toISOString(), ...stats },
  cities,
  categories,
  places,
  parkingsByPlace,
  tipsByPlace
};
fs.writeFileSync(path.join(OUT_DIR, 'data.json'), JSON.stringify(out), 'utf8');

const sizeKb = Math.round(fs.statSync(path.join(OUT_DIR, 'data.json')).size / 1024);
console.log(`[export] 已生成 deploy/data.json`);
console.log(`[export] 城市 ${cities.length} / 地点 ${places.length} / 车场 ${parkingRows.length} / 规则 ${stats.fee_rules}`);
console.log(`[export] 文件大小 ${sizeKb} KB`);
