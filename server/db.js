/**
 * 数据库初始化 + 广州数据导入
 * 运行：node db.js
 * 零依赖：使用 Node 22 内置 node:sqlite
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'parking.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sqlite.sql');
const DATA_PATH = path.join(ROOT, 'data', 'guangzhou_parking.json');

// 生成占位符，避免手工数错
const q = n => Array(n).fill('?').join(',');

// ---------- geohash ----------
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function encodeGeohash(lat, lng, precision = 9) {
  if (lat == null || lng == null) return null;
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '', bits = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      ch = (ch << 1) | (lng > mid ? 1 : 0);
      if (lng > mid) lngMin = mid; else lngMax = mid;
    } else {
      const mid = (latMin + latMax) / 2;
      ch = (ch << 1) | (lat > mid ? 1 : 0);
      if (lat > mid) latMin = mid; else latMax = mid;
    }
    even = !even;
    if (++bits === 5) { hash += BASE32[ch]; bits = 0; ch = 0; }
  }
  return hash;
}

// ---------- 收费规则解析 ----------
// 源数据 fee_rules: [{period:'首小时', price:10, unit:'小时'}, ...]
// 映射为结构化规则：首段 / 常规 / 封顶 / 夜间
function buildFeeRules(parking) {
  const rules = [];
  let firstEndMinute = null;

  for (const r of parking.fee_rules || []) {
    const period = String(r.period || '');
    const price = Number(r.price);
    if (!isFinite(price)) continue;
    const unit = (r.unit || '').includes('分') ? 'minute' : 'hour';

    const m = period.match(/(\d+(?:\.\d+)?)\s*(小时|分钟)/);
    const isCap = /封顶|最高|上限/.test(period);
    // 免费时段（如「30分钟内」0 元）不是计费规则，单独归类，绝不参与最低价计算
    const isFree = price === 0 || /免费|免收/.test(period) || /免费/.test(String(r.unit));
    // 「首2小时」「1小时内」这类带区间的都算首段
    const isFirst = !firstEndMinute && (/首|前/.test(period) || /内$/.test(period));

    if (isFree) {
      rules.push({ rule_type: 'free', start_minute: null, end_minute: m ? Number(m[1]) : null, price: 0, unit, unit_minutes: null, priority: 10, description: period });
      continue;
    }
    if (isCap) {
      rules.push({ rule_type: 'cap', start_minute: null, end_minute: null, price, unit: 'day', unit_minutes: null, priority: 100, description: period });
      continue;
    }
    if (isFirst) {
      const n = m ? Number(m[1]) : 1;
      const endMinute = unit === 'minute' ? n : n * 60;
      firstEndMinute = endMinute;
      rules.push({ rule_type: 'first', start_minute: 0, end_minute: endMinute, price, unit, unit_minutes: unit === 'minute' ? n : 60, priority: 90, description: period });
    } else {
      rules.push({
        rule_type: 'normal',
        start_minute: firstEndMinute,
        end_minute: null,
        price,
        unit,
        unit_minutes: unit === 'minute' ? (m ? Number(m[1]) : 30) : 60,
        priority: 50,
        description: period
      });
    }
  }

  if (parking.daily_cap != null) {
    rules.push({ rule_type: 'cap', start_minute: null, end_minute: null, price: Number(parking.daily_cap), unit: 'day', unit_minutes: null, priority: 100, description: '24小时封顶' });
  }
  if (parking.night_flat != null) {
    rules.push({ rule_type: 'night', start_minute: null, end_minute: null, time_start: '22:00', time_end: '08:00', price: Number(parking.night_flat), unit: 'time', unit_minutes: null, priority: 80, description: '夜间一口价' });
  }
  return rules;
}

// 取最低小时单价，用于列表比价排序
function calcMinPriceHour(rules) {
  const candidates = rules
    .filter(r => (r.rule_type === 'first' || r.rule_type === 'normal') && r.price > 0)
    .map(r => (r.unit === 'minute' ? (r.price * 60) / (r.unit_minutes || 30) : r.price));
  return candidates.length ? Math.min(...candidates) : null;
}

function scaleOf(total) {
  if (total == null) return null;
  if (total >= 500) return '大型车场';
  if (total >= 200) return '中型车场';
  return '小型车场';
}

// ---------- 主流程 ----------
function main() {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  console.log('[db] 建表完成');

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // 城市
  const cityStmt = db.prepare(
    `INSERT INTO cities (name, code, pinyin, province, lng, lat, hot_level, status, created_at, updated_at)
     VALUES (${q(10)})`
  );
  cityStmt.run(data.city, data.city_code || '440100', 'guangzhou', '广东省', 113.2644, 23.1291, 5, 1, now, now);
  const cityId = db.prepare('SELECT id FROM cities WHERE code = ?').get(data.city_code || '440100').id;
  console.log(`[db] 城市：${data.city} (id=${cityId})`);

  const districtMap = new Map();
  const districtStmt = db.prepare('INSERT INTO districts (city_id, name, created_at) VALUES (?, ?, ?)');
  const districtSel = db.prepare('SELECT id FROM districts WHERE city_id = ? AND name = ?');

  const placeStmt = db.prepare(
    `INSERT INTO places
     (city_id, district_id, name, category, address, lng, lat, geohash, heat, summary, tags, area_tips, search_text, status, created_at, updated_at)
     VALUES (${q(16)})`
  );
  const parkingStmt = db.prepare(
    `INSERT INTO parkings
     (city_id, name, address, type, total_spots, lng, lat, geohash, free_minutes, daily_cap, night_flat,
      open_hours, payment, min_price_hour, tips, source, confidence, verified_at, status, created_at, updated_at)
     VALUES (${q(21)})`
  );
  const feeStmt = db.prepare(
    `INSERT INTO fee_rules (parking_id, rule_type, start_minute, end_minute, time_start, time_end, price, unit, unit_minutes, priority, description, confidence, created_at)
     VALUES (${q(13)})`
  );
  const relStmt = db.prepare(
    `INSERT INTO place_parking (place_id, parking_id, distance_m, walk_minutes, is_recommended, sort_weight)
     VALUES (${q(6)})`
  );
  const tipStmt = db.prepare(
    `INSERT INTO tips (target_type, target_id, category, content, source, status, created_at)
     VALUES (${q(7)})`
  );

  let placeCount = 0, parkingCount = 0, feeCount = 0, tipCount = 0;

  db.exec('BEGIN');
  try {
    for (const p of data.places) {
      // 区县
      let districtId = null;
      if (p.district) {
        if (!districtMap.has(p.district)) {
          districtStmt.run(cityId, p.district, now);
          districtMap.set(p.district, districtSel.get(cityId, p.district).id);
        }
        districtId = districtMap.get(p.district);
      }

      const tags = Array.isArray(p.tags) ? p.tags : [];
      const searchText = [p.name, p.address, tags.join(' ')].filter(Boolean).join(' ');

      placeStmt.run(
        cityId, districtId, p.name, p.category, p.address || null,
        p.lng ?? null, p.lat ?? null, encodeGeohash(p.lat, p.lng),
        p.heat ?? 50, p.summary || null, JSON.stringify(tags, null, 0),
        p.area_tips || null, searchText, 1, now, now
      );
      const placeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      placeCount++;

      if (p.area_tips) {
        tipStmt.run('place', placeId, '攻略', p.area_tips, '编辑整理', 1, now);
        tipCount++;
      }

      const parkings = p.parkings || [];
      parkings.forEach((pk, idx) => {
        const rules = buildFeeRules(pk);
        const minPrice = calcMinPriceHour(rules);
        parkingStmt.run(
          cityId, pk.name, pk.address || null, pk.type || null, pk.total_spots ?? null,
          pk.lng ?? null, pk.lat ?? null, encodeGeohash(pk.lat, pk.lng),
          pk.free_minutes ?? 0, pk.daily_cap ?? null, pk.night_flat ?? null,
          pk.open_hours || null, JSON.stringify(pk.payment || []),
          minPrice, pk.tips || null, pk.source || null, pk.confidence || 'medium',
          now, 1, now, now
        );
        const parkingId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
        parkingCount++;

        for (const r of rules) {
          feeStmt.run(parkingId, r.rule_type, r.start_minute ?? null, r.end_minute ?? null,
            r.time_start || null, r.time_end || null, r.price, r.unit, r.unit_minutes ?? null,
            r.priority, r.description || null, pk.confidence || 'medium', now);
          feeCount++;
        }

        const distance = pk.distance_m ?? null;
        relStmt.run(placeId, parkingId, distance,
          distance != null ? Math.max(1, Math.round(distance / 80)) : null,
          idx === 0 ? 1 : 0, 100 - idx);
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log(`[db] 导入完成：目的地 ${placeCount} / 停车场 ${parkingCount} / 收费规则 ${feeCount} / 攻略提示 ${tipCount}`);
  const s = db.prepare('SELECT COUNT(*) c FROM parkings WHERE min_price_hour IS NOT NULL').get();
  console.log(`[db] 有价格数据的车场：${s.c} / ${parkingCount}`);
  db.close();
}

if (require.main === module) main();
module.exports = { encodeGeohash, scaleOf };
