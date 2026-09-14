import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'server/xhs-p1-full-import-20260914.json');
const outputPath = path.resolve(process.argv[3] ?? 'server/xhs-p1-place-coordinates-import-20260914.json');
const reviewPath = path.resolve(process.argv[4] ?? 'server/xhs-p1-place-coordinate-review-20260914.json');
const key = process.env.TENCENT_MAP_KEY;
if (!key) throw new Error('缺少 TENCENT_MAP_KEY；请只通过本机环境变量提供，不要写入文件');

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value ?? '')
  .toLowerCase()
  .replace(/[（）()\s·、，,。/\\\-号栋室]/g, '');
const locationOf = candidate => {
  const lng = Number(candidate?.location?.lng);
  const lat = Number(candidate?.location?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
};
const queryAliases = {
  '广州烈士陵园': ['广州起义烈士陵园']
};

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

function rank(place, candidates) {
  const wanted = normalize(place.name);
  const district = String(place.district ?? '').replace(/区$/, '');
  return candidates.map(candidate => {
    const title = normalize(candidate.title);
    const address = String(candidate.address ?? '');
    let score = 0;
    if (title === wanted) score += 120;
    else if (title.includes(wanted) || wanted.includes(title)) score += 90;
    else if (title.includes(normalize(place.name.replace(/(公园|景区|博物馆|音乐厅)$/, '')))) score += 50;
    if (district && address.includes(district)) score += 30;
    if (/景点|公园|景区|博物馆|艺术馆|音乐厅|纪念馆|文化馆|商圈/.test(`${candidate.category || ''}${candidate.title || ''}`)) score += 10;
    return { candidate, score, location: locationOf(candidate) };
  }).filter(row => row.location).sort((a, b) => b.score - a.score);
}

const review = [];
for (const place of data.places) {
  const queries = [...new Set([
    `广州 ${place.name}`,
    `广州市 ${place.district || ''} ${place.name}`,
    `广州 ${place.name} 景区`,
    ...(queryAliases[place.name] || []).map(alias => `广州 ${alias}`)
  ])];
  const all = new Map();
  try {
    for (const query of queries) {
      for (const candidate of await search(query)) all.set(candidate.id, candidate);
      await sleep(100);
    }
    const ranked = rank(place, [...all.values()]);
    if (queryAliases[place.name]?.length) {
      const preferred = ranked.find(row => queryAliases[place.name].some(alias => normalize(row.candidate.title).includes(normalize(alias))
        && String(row.candidate.address || '').includes(String(place.district || '').replace(/区$/, ''))));
      if (preferred) {
        const index = ranked.indexOf(preferred);
        ranked.splice(index, 1);
        ranked.unshift(preferred);
      }
    }
    const top = ranked[0];
    const second = ranked[1];
    const gap = top && second ? top.score - second.score : 999;
    if (!top) {
      place.lng = null; place.lat = null;
      place.coordinate_status = '待补充';
      place.navigation_available = false;
      review.push({ place: place.name, status: '未找到带坐标候选', queries });
      continue;
    }
    place.lng = top.location.lng;
    place.lat = top.location.lat;
    place.coordinate_status = '待核验';
    place.navigation_available = false;
    place.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（地点坐标待人工核验）';
    place.coordinate_poi_name = top.candidate.title || null;
    place.coordinate_poi_id = top.candidate.id || null;
    place.coordinate_address = top.candidate.address || null;
    place.coordinate_verified_at = null;
    place.entrance_verified = false;
    review.push({
      place: place.name,
      status: gap >= 8 ? '已补入候选坐标，待人工核验' : '已补入候选坐标，候选分差较小',
      score: top.score,
      score_gap: gap,
      poi: top.candidate.title,
      poi_id: top.candidate.id,
      address: top.candidate.address,
      location: top.location,
      alternatives: ranked.slice(1, 4).map(row => ({ title: row.candidate.title, id: row.candidate.id, address: row.candidate.address, score: row.score }))
    });
  } catch (error) {
    review.push({ place: place.name, status: '检索失败', error: error.message, queries });
  }
}

data.coordinate_run_at = new Date().toISOString();
data.coordinate_provider = '腾讯位置服务 WebService 地点搜索';
data.coordinate_review_file = path.relative(process.cwd(), reviewPath).replaceAll('\\', '/');
data.coordinates_ready = {
  places: data.places.filter(place => place.lng != null && place.lat != null).length,
  parkings: data.places.flatMap(place => place.parkings || []).filter(parking => parking.lng != null && parking.lat != null).length
};
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
fs.writeFileSync(reviewPath, `${JSON.stringify({ generated_at: data.coordinate_run_at, provider: '腾讯位置服务', review }, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, review: reviewPath, coordinates_ready: data.coordinates_ready, review }, null, 2));
