import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(process.argv[2] ?? 'server/xhs-p0-latest-20260914-final-import.json');
const dbPath = path.resolve(process.argv[3] ?? 'server/parking.db');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!Array.isArray(data.places) || data.places.length === 0) throw new Error('导入文件没有 places');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${dbPath}.bak-${stamp}`;
fs.copyFileSync(dbPath, backupPath);

const db = new DatabaseSync(dbPath);
const city = db.prepare("select id from cities where code='440100' or name='广州' limit 1").get();
if (!city) throw new Error('找不到广州城市记录');
const cityId = city.id;
const now = new Date().toISOString();
const tagsJson = value => Array.isArray(value) ? JSON.stringify(value) : (typeof value === 'string' ? value : '[]');
const paymentJson = value => Array.isArray(value) ? JSON.stringify(value) : (typeof value === 'string' ? value : '[]');

let placeCount = 0;
let parkingCount = 0;
let ruleCount = 0;
try {
  db.exec('BEGIN IMMEDIATE');
  for (const place of data.places) {
    const district = db.prepare('select id from districts where city_id=? and name=? limit 1').get(cityId, place.district);
    if (!district) throw new Error(`找不到行政区：${place.district}`);
    let existing = db.prepare('select id from places where city_id=? and name=? limit 1').get(cityId, place.name);
    if (existing) {
      db.prepare(`update places set district_id=?, name=?, category=?, address=?, lng=?, lat=?, summary=?, tags=?, area_tips=?, search_text=?, updated_at=? where id=?`)
        .run(district.id, place.name, place.category, place.address, place.lng, place.lat, place.summary, tagsJson(place.tags), place.area_tips, `${place.name} ${place.address} ${place.summary} ${place.area_tips}`, now, existing.id);
    } else {
      const result = db.prepare(`insert into places (city_id,district_id,name,category,address,lng,lat,summary,tags,area_tips,search_text,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(cityId, district.id, place.name, place.category, place.address, place.lng, place.lat, place.summary, tagsJson(place.tags), place.area_tips, `${place.name} ${place.address} ${place.summary} ${place.area_tips}`, now, now);
      existing = { id: Number(result.lastInsertRowid) };
    }
    placeCount++;
    db.prepare('delete from place_parking where place_id=?').run(existing.id);
    for (const [index, parking] of place.parkings.entries()) {
      let existingParking = db.prepare('select id from parkings where city_id=? and name=? limit 1').get(cityId, parking.name);
      const verifiedAt = parking.coordinate_status === '已核验' ? (parking.coordinate_verified_at || now) : null;
      const values = [cityId, parking.name, parking.coordinate_address || parking.location, parking.type || '停车场', parking.lng, parking.lat, parking.free_minutes ?? 0, parking.daily_cap ?? null, parking.night_flat ?? null, paymentJson(parking.payment), parking.min_price_hour ?? null, parking.guide_text, parking.source || '小红书公开图文整理', parking.confidence || 'medium', verifiedAt, now];
      if (existingParking) {
        db.prepare(`update parkings set city_id=?,name=?,address=?,type=?,lng=?,lat=?,free_minutes=?,daily_cap=?,night_flat=?,payment=?,min_price_hour=?,tips=?,source=?,confidence=?,verified_at=?,updated_at=? where id=?`)
          .run(...values, existingParking.id);
      } else {
        const result = db.prepare(`insert into parkings (city_id,name,address,type,lng,lat,free_minutes,daily_cap,night_flat,payment,min_price_hour,tips,source,confidence,verified_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(...values);
        existingParking = { id: Number(result.lastInsertRowid) };
      }
      parkingCount++;
      db.prepare('delete from fee_rules where parking_id=?').run(existingParking.id);
      for (const rule of parking.fee_rules ?? []) {
        db.prepare(`insert into fee_rules (parking_id,rule_type,start_minute,end_minute,time_start,time_end,price,unit,unit_minutes,priority,description,confidence) values (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(existingParking.id, rule.rule_type, rule.start_minute ?? null, rule.end_minute ?? null, rule.time_start ?? null, rule.time_end ?? null, rule.price, rule.unit, rule.unit_minutes ?? (rule.unit === 'hour' ? 60 : null), rule.priority ?? 0, rule.description || '', rule.confidence || parking.confidence || 'medium');
        ruleCount++;
      }
      db.prepare(`insert into place_parking (place_id,parking_id,is_recommended,sort_weight) values (?,?,?,?)`)
        .run(existing.id, existingParking.id, index === 0 ? 1 : 0, (place.parkings.length - index) * 10);
    }
  }
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  db.close();
  throw new Error(`导入已回滚：${error.message}；数据库备份：${backupPath}`);
}
db.close();
console.log(JSON.stringify({ db: dbPath, backup: backupPath, places: placeCount, parkings: parkingCount, fee_rules: ruleCount, status: 'imported' }, null, 2));
