import fs from 'node:fs';

const packagePath = process.argv[2] ?? 'server/cloud-parking-coordinate-repair-import-20260914.json';
const reviewPath = process.argv[3] ?? 'server/cloud-parking-coordinate-repair-review-20260914.json';
const bootstrapPath = process.argv[4] ?? 'server/cloud-bootstrap-20260914.json';
const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const reviewData = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const bootstrap = JSON.parse(fs.readFileSync(bootstrapPath, 'utf8'));

// 仅放行腾讯返回的同名/明确同址 POI；泛化或跨区候选继续留待补充。
const overrideIds = new Set([75, 78, 80, 81, 95, 107, 108, 127, 129, 137, 138]);
const reviewById = new Map((reviewData.review || []).map(row => [Number(row.parking_id), row]));
const bootstrapPlaces = new Map((bootstrap.places || []).map(place => [Number(place.id), place]));
const bootstrapParkings = new Map();
for (const parking of bootstrap.parkings || []) {
  const placeId = Number(parking.place_id);
  if (!bootstrapParkings.has(placeId)) bootstrapParkings.set(placeId, []);
  bootstrapParkings.get(placeId).push({ ...parking });
}
let applied = 0;

// 某地点若没有自动放行记录，也要把它完整加入同步包，避免人工放行后仍无法入库。
for (const row of reviewData.review || []) {
  if (!overrideIds.has(Number(row.parking_id))) continue;
  if (packageData.places.some(place => (place.parkings || []).some(parking => Number(parking.id) === Number(row.parking_id)))) continue;
  const sourcePlace = bootstrapPlaces.get(Number(row.place_id));
  if (!sourcePlace) throw new Error(`人工放行记录缺少地点：${row.place_id}`);
  packageData.places.push({ ...sourcePlace, parkings: bootstrapParkings.get(Number(row.place_id)) || [] });
}

for (const place of packageData.places || []) {
  for (const parking of place.parkings || []) {
    if (!overrideIds.has(Number(parking.id))) continue;
    const row = reviewById.get(Number(parking.id));
    if (!row?.location) throw new Error(`人工放行记录缺少坐标：${parking.id}`);
    parking.lng = Number(row.location.lng);
    parking.lat = Number(row.location.lat);
    parking.coordinate_status = '待核验';
    parking.navigation_available = false;
    parking.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（停车场入口待人工核验）';
    parking.coordinate_poi_name = row.poi || null;
    parking.coordinate_poi_id = row.poi_id || null;
    parking.coordinate_address = row.address || null;
    parking.coordinate_verified_at = null;
    parking.entrance_verified = /入口|出入口/.test(row.poi || '');
    row.status = '已补入候选坐标，待入口核验';
    row.manual_override = true;
    applied++;
  }
}

reviewData.manual_overrides = [...overrideIds];
reviewData.repaired = Number(reviewData.repaired || 0) + applied;
reviewData.unresolved = (reviewData.review || []).filter(row => row.status !== '已补入候选坐标，待入口核验');
fs.writeFileSync(packagePath, `${JSON.stringify(packageData, null, 2)}\n`);
fs.writeFileSync(reviewPath, `${JSON.stringify(reviewData, null, 2)}\n`);
console.log(JSON.stringify({ applied, packagePath, reviewPath, unresolved: reviewData.unresolved.length }, null, 2));
