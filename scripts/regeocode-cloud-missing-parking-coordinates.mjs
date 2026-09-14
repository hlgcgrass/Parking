import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'server/cloud-bootstrap-20260914.json');
const outputPath = path.resolve(process.argv[3] ?? 'server/cloud-parking-coordinate-repair-import-20260914.json');
const reviewPath = path.resolve(process.argv[4] ?? 'server/cloud-parking-coordinate-repair-review-20260914.json');
const key = process.env.TENCENT_MAP_KEY;
if (!key) throw new Error('缺少 TENCENT_MAP_KEY；请只通过本机环境变量提供，不要写入文件');

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const placeById = new Map((source.places || []).map(place => [Number(place.id), place]));
const parkingsByPlace = new Map();
for (const parking of source.parkings || []) {
  const id = Number(parking.place_id);
  if (!parkingsByPlace.has(id)) parkingsByPlace.set(id, []);
  parkingsByPlace.get(id).push({ ...parking });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value ?? '')
  .toLowerCase()
  .replace(/[（）()\s·、，,。/\\\-号栋室]/g, '')
  .replace(/停车场|地下车库|地面车库|立体车库|车库|停车位|停车点|出入口|入口|出口/g, '');
const locationOf = candidate => {
  const lng = Number(candidate?.location?.lng);
  const lat = Number(candidate?.location?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};
function longestShared(left, right) {
  let best = 0;
  for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) {
    let k = 0;
    while (left[i + k] && right[j + k] && left[i + k] === right[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}
async function search(keyword) {
  const url = new URL('https://apis.map.qq.com/ws/place/v1/search/');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('boundary', 'region(广州,0)');
  url.searchParams.set('page_size', '20');
  url.searchParams.set('page_index', '1');
  url.searchParams.set('orderby', '_distance');
  url.searchParams.set('key', key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`腾讯接口 HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 0) throw new Error(`腾讯接口 ${body.message || body.status}`);
  return Array.isArray(body.data) ? body.data : [];
}
function rankParking(parking, place, candidates) {
  const wanted = normalize(parking.name);
  const locationWanted = normalize(parking.location || parking.address || parking.name);
  const placeWanted = normalize(place.name);
  const district = String(place.district || '').replace(/区$/, '');
  return candidates
    .filter(candidate => /停车|车库|P\d/i.test(`${candidate.title || ''} ${candidate.category || ''}`))
    .map(candidate => {
      const title = normalize(candidate.title);
      const address = String(candidate.address || '');
      let score = Math.max(longestShared(wanted, title), longestShared(locationWanted, title)) * 5;
      if (title === wanted || title === locationWanted) score += 70;
      else if (title.includes(wanted) || wanted.includes(title) || title.includes(locationWanted) || locationWanted.includes(title)) score += 48;
      if (title.includes(placeWanted) || address.includes(place.name)) score += 10;
      if (district && address.includes(district)) score += 8;
      if (/入口|出入口/.test(candidate.title || '')) score += 10;
      if (/停车场|停车库/.test(candidate.category || '')) score += 5;
      return { candidate, score, location: locationOf(candidate) };
    })
    .filter(row => row.location)
    .sort((a, b) => b.score - a.score);
}

const review = [];
const changedPlaceIds = new Set();
let scanned = 0;
let repaired = 0;
for (const [placeId, rows] of parkingsByPlace) {
  const place = placeById.get(placeId);
  if (!place) continue;
  for (const parking of rows) {
    if (parking.lng != null && parking.lat != null) continue;
    scanned++;
    const queries = [...new Set([
      `广州 ${parking.name} ${place.name}`,
      `广州 ${parking.location || parking.address || parking.name}`,
      `广州 ${parking.name}`
    ])];
    const all = new Map();
    try {
      for (const query of queries) {
        for (const candidate of await search(query)) all.set(candidate.id, candidate);
        await sleep(90);
      }
      const ranked = rankParking(parking, place, [...all.values()]);
      const top = ranked[0];
      const second = ranked[1];
      const gap = top && second ? top.score - second.score : 999;
      const wanted = normalize(parking.name);
      const title = normalize(top?.candidate?.title);
      const district = String(place.district || '').replace(/区$/, '');
      const address = String(top?.candidate?.address || '');
      const exactName = Boolean(top && (title === wanted || title.includes(wanted) || wanted.includes(title)));
      const sameDistrict = Boolean(district && address.includes(district));
      const accepted = Boolean(top && sameDistrict && (
        (top.score >= 58 && gap >= 8)
        || (exactName && top.score >= 40)
      ));
      if (accepted) {
        parking.lng = top.location.lng;
        parking.lat = top.location.lat;
        parking.coordinate_status = '待核验';
        parking.navigation_available = false;
        parking.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（停车场入口待人工核验）';
        parking.coordinate_poi_name = top.candidate.title || null;
        parking.coordinate_poi_id = top.candidate.id || null;
        parking.coordinate_address = top.candidate.address || null;
        parking.coordinate_verified_at = null;
        parking.entrance_verified = /入口|出入口/.test(top.candidate.title || '');
        repaired++;
        changedPlaceIds.add(placeId);
      }
      review.push({
        place_id: placeId, place: place.name, parking_id: parking.id, name: parking.name,
        status: accepted ? '已补入候选坐标，待入口核验' : '候选不明确，保留待补充',
        score: top?.score || 0, score_gap: gap,
        poi: top?.candidate?.title || '', poi_id: top?.candidate?.id || '',
        address: top?.candidate?.address || '', location: top?.location || null,
        alternatives: ranked.slice(1, 4).map(row => ({ title: row.candidate.title, id: row.candidate.id, address: row.candidate.address, score: row.score }))
      });
    } catch (error) {
      review.push({ place_id: placeId, place: place.name, parking_id: parking.id, name: parking.name, status: '检索失败', error: error.message, queries });
    }
  }
}

const places = [...changedPlaceIds].map(placeId => ({
  ...placeById.get(placeId),
  parkings: parkingsByPlace.get(placeId) || []
}));
const output = { places };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(reviewPath, `${JSON.stringify({ generated_at: new Date().toISOString(), provider: '腾讯位置服务', scanned, repaired, unresolved: review.filter(row => row.status !== '已补入候选坐标，待入口核验'), review }, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, review: reviewPath, scanned, repaired, affected_places: places.length, unresolved: review.filter(row => row.status !== '已补入候选坐标，待入口核验').length }, null, 2));
