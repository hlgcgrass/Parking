import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(process.cwd());
const dbPath = path.join(root, 'server', 'parking.db');
const dataPath = path.join(root, 'server', 'xhs-p0-import-41-final.json');
const backupPath = path.join(root, 'server', `parking.db.backup-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
fs.copyFileSync(dbPath, backupPath);

const q = n => Array(n).fill('?').join(',');
const geohash = (lat, lng) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  const chars = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180, hash = '', bits = 0, ch = 0, even = true;
  while (hash.length < 9) {
    const mid = even ? (lngMin + lngMax) / 2 : (latMin + latMax) / 2;
    const value = even ? Number(lng) : Number(lat);
    if (value > mid) { ch = (ch << 1) | 1; if (even) lngMin = mid; else latMin = mid; }
    else { ch <<= 1; if (even) lngMax = mid; else latMax = mid; }
    even = !even;
    if (++bits === 5) { hash += chars[ch]; bits = 0; ch = 0; }
  }
  return hash;
};
const minPrice = rules => {
  const values = (rules || []).filter(r => ['first', 'normal'].includes(r.rule_type) && Number(r.price) > 0)
    .map(r => r.unit === 'minute' ? Number(r.price) * 60 / (Number(r.unit_minutes) || 30) : Number(r.price));
  return values.length ? Math.min(...values) : null;
};

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
db.exec('BEGIN');
try {
  // 只清理停车攻略静态内容；保留 users / price_reports / search_logs / crawl_tasks。
  db.exec('DELETE FROM place_parking; DELETE FROM fee_rules; DELETE FROM parkings; DELETE FROM tips; DELETE FROM places; DELETE FROM districts; DELETE FROM cities;');

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const city = data.cities?.[0] || { name: '广州', code: '440100', lng: 113.2644, lat: 23.1291 };
  db.prepare(`INSERT INTO cities (id,name,code,pinyin,province,lng,lat,hot_level,status,created_at,updated_at) VALUES (${q(11)})`)
    .run(1, city.name, city.code, city.pinyin || 'guangzhou', city.province || '广东省', city.lng, city.lat, city.hot_level || 5, 1, now, now);
  const districtIds = new Map();
  const districtInsert = db.prepare('INSERT INTO districts (city_id,name,created_at) VALUES (?,?,?)');
  const placeInsert = db.prepare(`INSERT INTO places (id,city_id,district_id,name,category,address,lng,lat,geohash,heat,summary,tags,area_tips,search_text,view_count,status,created_at,updated_at) VALUES (${q(18)})`);
  const parkingInsert = db.prepare(`INSERT INTO parkings (id,city_id,name,address,type,total_spots,lng,lat,geohash,free_minutes,daily_cap,night_flat,open_hours,payment,min_price_hour,tips,source,confidence,verified_at,status,created_at,updated_at) VALUES (${q(22)})`);
  const feeInsert = db.prepare(`INSERT INTO fee_rules (parking_id,rule_type,start_minute,end_minute,time_start,time_end,price,unit,unit_minutes,priority,description,confidence,created_at) VALUES (${q(13)})`);
  const relInsert = db.prepare(`INSERT INTO place_parking (place_id,parking_id,distance_m,walk_minutes,is_recommended,sort_weight) VALUES (${q(6)})`);
  const tipInsert = db.prepare(`INSERT INTO tips (target_type,target_id,category,content,source,status,created_at) VALUES (${q(7)})`);

  let parkingCount = 0, feeCount = 0, tipCount = 0;
  for (const place of data.places || []) {
    if (place.district && !districtIds.has(place.district)) {
      districtInsert.run(1, place.district, now);
      districtIds.set(place.district, db.prepare('SELECT last_insert_rowid() AS id').get().id);
    }
    const districtId = place.district ? districtIds.get(place.district) : null;
    placeInsert.run(place.id, 1, districtId, place.name, place.category || '景点', place.address || null,
      place.lng ?? null, place.lat ?? null, geohash(place.lat, place.lng), place.heat ?? 50,
      place.summary || null, JSON.stringify(place.tags || []), place.area_tips || null,
      place.search_text || [place.name, place.address].filter(Boolean).join(' '), place.view_count || 0, 1, now, now);
    const tip = (data.tipsByPlace?.[place.id] || [])[0];
    if (tip?.content) { tipInsert.run('place', place.id, tip.category || '攻略', tip.content, '编辑整理', 1, now); tipCount++; }
    const rows = data.parkingsByPlace?.[place.id] || [];
    rows.forEach((pk, index) => {
      const rules = pk.fee_rules || [];
      parkingInsert.run(pk.id, 1, pk.name, pk.address || null, pk.type || null, pk.total_spots ?? null,
        pk.lng ?? null, pk.lat ?? null, geohash(pk.lat, pk.lng), pk.free_minutes ?? 0, pk.daily_cap ?? null,
        pk.night_flat ?? null, pk.open_hours || null, JSON.stringify(pk.payment || []),
        pk.min_price_hour ?? minPrice(rules), pk.tips || null, '编辑整理', pk.confidence || 'medium', pk.verified_at || now, 1, now, now);
      parkingCount++;
      for (const rule of rules) {
        if (!Number.isFinite(Number(rule.price))) continue;
        feeInsert.run(pk.id, rule.rule_type || 'normal', rule.start_minute ?? null, rule.end_minute ?? null,
          rule.time_start || null, rule.time_end || null, Number(rule.price), rule.unit || 'hour', rule.unit_minutes ?? null,
          rule.priority ?? 50, rule.description || null, rule.confidence || pk.confidence || 'medium', now);
        feeCount++;
      }
      relInsert.run(place.id, pk.id, pk.distance_m ?? null, pk.distance_m != null ? Math.max(1, Math.round(pk.distance_m / 80)) : null, index === 0 ? 1 : 0, 100 - index);
    });
  }
  db.exec('COMMIT');
  db.close();
  console.log(JSON.stringify({ backupPath, places: data.places?.length || 0, parkings: parkingCount, fee_rules: feeCount, tips: tipCount }, null, 2));
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  throw error;
}
