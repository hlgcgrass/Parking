import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(process.argv[2] ?? 'server/xhs-p0-latest-20260914-import.json');
const outputPath = path.resolve(process.argv[3] ?? 'server/xhs-p0-latest-20260914-tencent.json');
const reviewPath = path.resolve(process.argv[4] ?? 'server/xhs-p0-latest-20260914-tencent.review.json');
const key = process.env.TENCENT_MAP_KEY;
if (!key) throw new Error('缺少 TENCENT_MAP_KEY；请只通过本机环境变量提供，不要写入文件');

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const review = [];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalize = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[（）()\s·、，,。/\\\-号栋室]/g, '')
  .replace(/华南国家植物园/g, '华南植物园')
  .replace(/停车场|地下车库|地面车库|立体车库|车库|停车位|停车点|出入口|入口|出口/g, '');

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

function candidateLocation(candidate) {
  const lng = Number(candidate?.location?.lng);
  const lat = Number(candidate?.location?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function rankPlace(place, candidates) {
  const wanted = normalize(place.name);
  const district = String(place.district ?? '').replace(/区$/, '');
  return candidates.map(candidate => {
    const title = normalize(candidate.title);
    let score = longestShared(wanted, title) * 3;
    if (title === wanted) score += 70;
    else if (title.includes(wanted) || wanted.includes(title)) score += 45;
    if (district && String(candidate.address ?? '').includes(district)) score += 12;
    if (String(candidate.category ?? '').match(/景点|文化场馆|医院|公园|植物园|博物馆|纪念馆/)) score += 5;
    return { candidate, score };
  }).sort((a, b) => b.score - a.score);
}

function rankParking(parking, place, candidates) {
  const wanted = normalize(parking.name);
  const locationWanted = normalize(parking.location);
  const placeWanted = normalize(place.name.replace('（珠江新城院区）', ''));
  const district = String(place.district ?? '').replace(/区$/, '');
  return candidates
    .filter(candidate => /停车|车库|P\d/i.test(`${candidate.title} ${candidate.category ?? ''}`))
    .map(candidate => {
      const title = normalize(candidate.title);
      const address = String(candidate.address ?? '');
      let score = Math.max(longestShared(wanted, title), longestShared(locationWanted, title)) * 5;
      if (title === wanted || title === locationWanted) score += 70;
      else if (title.includes(wanted) || wanted.includes(title) || title.includes(locationWanted) || locationWanted.includes(title)) score += 48;
      if (title.includes(placeWanted) || address.includes(place.name.replace('（珠江新城院区）', ''))) score += 10;
      if (district && address.includes(district)) score += 8;
      if (/入口|出入口/.test(candidate.title)) score += 10;
      if (/停车场|停车库/.test(candidate.category ?? '')) score += 5;
      return { candidate, score };
    }).sort((a, b) => b.score - a.score);
}

function choose(ranked, level, placeName, name) {
  const top = ranked[0];
  const second = ranked[1];
  const location = candidateLocation(top?.candidate);
  const gap = top && second ? top.score - second.score : 999;
  const accepted = Boolean(top && location && top.score >= 58 && gap >= 8);
  review.push({
    level, place: placeName, name,
    status: accepted ? '候选通过匹配，待入口核验' : '待人工复核',
    score: top?.score ?? 0, score_gap: gap,
    poi: top?.candidate?.title ?? '', poi_id: top?.candidate?.id ?? '',
    address: top?.candidate?.address ?? '', location: location ?? null,
    alternatives: (ranked.slice(1, 4) ?? []).map(item => ({ title: item.candidate.title, id: item.candidate.id, address: item.candidate.address, score: item.score }))
  });
  return accepted ? { ...top, location } : null;
}

async function searchParking(parking, place) {
  const rawQueries = [
    `广州 ${parking.name} ${place.name}`,
    `广州 ${parking.location}`,
    `广州 ${parking.name}`,
    `广州 ${parking.name.replace(/区停车场$/, '停车场')}`,
    `广州 ${parking.name.replace(/停车场$/, '')}`
  ];
  const queries = [...new Set(rawQueries.filter(Boolean))];
  const all = new Map();
  for (const query of queries) {
    for (const candidate of await search(query)) all.set(candidate.id, candidate);
    await sleep(80);
  }
  return [...all.values()];
}

let placeReady = 0;
let parkingReady = 0;
for (const place of data.places) {
  let picked = null;
  try {
    picked = choose(rankPlace(place, await search(`广州 ${place.name}`)), '地点', place.name, place.name);
  } catch (error) {
    review.push({ level: '地点', place: place.name, name: place.name, status: '检索失败', error: error.message });
  }
  if (picked) {
    place.lng = picked.location.lng; place.lat = picked.location.lat;
    place.coordinate_status = '待核验'; place.navigation_available = false;
    place.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（待入口复核）';
    place.coordinate_poi_name = picked.candidate.title;
    place.coordinate_poi_id = picked.candidate.id;
    place.coordinate_address = picked.candidate.address;
    place.entrance_verified = false;
    place.coordinate_verified_at = null;
    placeReady++;
  } else {
    place.coordinate_status = '待补充'; place.navigation_available = false;
  }
  await sleep(120);

  for (const parking of place.parkings) {
    let selected = null;
    try {
      selected = choose(rankParking(parking, place, await searchParking(parking, place)), '停车场', place.name, parking.name);
    } catch (error) {
      review.push({ level: '停车场', place: place.name, name: parking.name, status: '检索失败', error: error.message });
    }
    if (selected) {
      parking.lng = selected.location.lng; parking.lat = selected.location.lat;
      parking.coordinate_status = '待核验'; parking.navigation_available = false;
      parking.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（入口待复核）';
      parking.coordinate_poi_name = selected.candidate.title;
      parking.coordinate_poi_id = selected.candidate.id;
      parking.coordinate_address = selected.candidate.address;
      parking.entrance_verified = /入口|出入口/.test(selected.candidate.title);
      parking.coordinate_verified_at = null;
      parkingReady++;
    } else {
      parking.coordinate_status = '待补充'; parking.navigation_available = false;
    }
    await sleep(120);
  }
}

data.coordinate_run_at = new Date().toISOString();
data.coordinates_ready = { places: placeReady, parkings: parkingReady };
data.coordinate_provider = '腾讯位置服务 WebService 地点搜索';
data.coordinate_review_file = path.relative(root, reviewPath);
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
fs.writeFileSync(reviewPath, JSON.stringify({ generated_at: data.coordinate_run_at, provider: '腾讯位置服务', review }, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, review: reviewPath, places: data.places.length, parkings: data.places.reduce((sum, place) => sum + place.parkings.length, 0), candidates: { places: placeReady, parkings: parkingReady } }, null, 2));
