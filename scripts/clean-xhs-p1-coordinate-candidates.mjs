import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(process.argv[2] || 'server/xhs-p1-curated-tencent-20260914.json');
const reviewPath = path.resolve(process.argv[3] || 'server/xhs-p1-curated-tencent-review-20260914.json');
const outputPath = path.resolve(process.argv[4] || 'server/xhs-p1-curated-ready-import-20260914.json');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')).review || [];
const byKey = new Map(review.map(row => [`${row.level}/${row.place}/${row.name}`, row]));
const cleared = [];

function clear(row, level, placeName) {
  if (row.lng == null && row.lat == null) return;
  const district = String(data.places.find(place => place.name === placeName)?.district || '').replace(/区/g, '');
  const evidence = byKey.get(`${level}/${placeName}/${row.name}`);
  const address = String(evidence?.address || '');
  if (district && address && !address.includes(district)) {
    cleared.push({ level, place: placeName, name: row.name, poi: evidence?.poi || '', address, expected_district: district });
    for (const key of ['lng', 'lat', 'coordinate_source', 'coordinate_poi_name', 'coordinate_poi_id', 'coordinate_address', 'coordinate_verified_at']) row[key] = null;
    row.coordinate_status = '待补充';
    row.navigation_available = false;
    row.entrance_verified = false;
  }
}

for (const place of data.places) {
  clear(place, '地点', place.name);
  for (const parking of place.parkings || []) clear(parking, '停车场', place.name);
}

data.coordinate_quality = { provider: '腾讯位置服务 WebService 地点搜索', district_mismatch_cleared: cleared.length };
data.coordinate_review_file = path.relative(root, reviewPath).replaceAll('\\', '/');
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, coordinates_ready: { places: data.places.filter(row => row.lng != null && row.lat != null).length, parkings: data.places.flatMap(row => row.parkings || []).filter(row => row.lng != null && row.lat != null).length }, cleared }, null, 2));
