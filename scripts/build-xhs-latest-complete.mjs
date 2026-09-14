import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const curatedPath = path.resolve(process.argv[2] ?? 'server/xhs-p0-latest-20260914-import.json');
const tencentPath = path.resolve(process.argv[3] ?? 'server/xhs-p0-latest-20260914-tencent.json');
const reviewPath = path.resolve(process.argv[4] ?? 'server/xhs-p0-latest-20260914-tencent.review.json');
const candidatesPath = path.resolve(process.argv[5] ?? 'server/xhs-p0-candidates-latest-20260914.json');
const outputPath = path.resolve(process.argv[6] ?? 'server/xhs-p0-latest-20260914-complete-import.json');
const markdownPath = path.resolve(process.argv[7] ?? 'server/xhs-p0-latest-20260914-complete.md');
const auditPath = path.resolve(process.argv[8] ?? 'server/xhs-p0-latest-20260914-complete-audit.json');

const curated = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
const tencent = JSON.parse(fs.readFileSync(tencentPath, 'utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')).review;
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const dropped = new Map([
  ['海心沙/珠江帝景北门停车场', '候选内容与目标地点关联不足，腾讯结果只回到海心沙停车场，避免重复或误导。'],
  ['黄埔军校/长洲岛地上停车场-出入口', '原始名称过于泛化，腾讯候选落到其他地点，无法形成可搜索的正式停车场。'],
  ['南越王博物院/越秀公园东北门停车场', '与越秀公园已有停车场重复，按主地点规则不重复挂接。']
]);
const clean = value => String(value ?? '')
  .replace(/本轮笔记中明确|本轮笔记确认|本轮笔记/g, '当前信息')
  .replace(/部分笔记记录为10元\/天/g, '另有10元\/天的收费口径')
  .replace(/小红书上说|评论中|正文中|原文|作者回复/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();
const finite = value => Number.isFinite(Number(value));
const evidenceFor = (level, place, name) => review.find(row => row.level === level && row.place === place && row.name === name);
const rawFilesFor = placeName => {
  const row = candidates.places.find(item => item.place === placeName);
  return [...new Set((row?.notes ?? []).map(note => note.raw_file).filter(Boolean))];
};
function coord(row, evidence, level) {
  const direct = finite(row.lng) && finite(row.lat) && row.coordinate_status !== '待补充' ? { lng: Number(row.lng), lat: Number(row.lat) } : null;
  const candidate = evidence?.location && finite(evidence.location.lng) && finite(evidence.location.lat) ? { lng: Number(evidence.location.lng), lat: Number(evidence.location.lat) } : null;
  const chosen = direct || candidate;
  if (!chosen) return {
    lng: null, lat: null, coordinate_status: '待补充', navigation_available: false,
    coordinate_source: '暂未找到可确认的腾讯地图 POI', coordinate_poi_name: evidence?.poi || '', coordinate_poi_id: evidence?.poi_id || '', coordinate_address: evidence?.address || '', entrance_verified: false, coordinate_verified_at: null
  };
  const pending = true;
  return {
    lng: chosen.lng, lat: chosen.lat, coordinate_status: pending ? '待核验' : '已核验', navigation_available: false,
    coordinate_source: evidence?.poi ? `腾讯位置服务候选 POI（${evidence.status === '候选通过匹配，待入口核验' ? '入口待核验' : '归属待核验'}）` : '腾讯位置服务候选 POI（待核验）',
    coordinate_poi_name: evidence?.poi || row.coordinate_poi_name || '', coordinate_poi_id: evidence?.poi_id || row.coordinate_poi_id || '', coordinate_address: evidence?.address || row.coordinate_address || '', entrance_verified: /入口|出入口/.test(evidence?.poi || row.coordinate_poi_name || ''), coordinate_verified_at: null
  };
}

const outPlaces = [];
const audit = [];
for (const base of curated.places) {
  const t = tencent.places.find(row => row.name === base.name) || {};
  const placeEvidence = evidenceFor('地点', base.name, base.name);
  const placeCoord = coord(t, placeEvidence, '地点');
  const parkings = base.parkings.filter(baseParking => !dropped.has(`${base.name}/${baseParking.name}`)).map(baseParking => {
    const tParking = t.parkings?.find(row => row.name === baseParking.name) || {};
    const parkingEvidence = evidenceFor('停车场', base.name, baseParking.name);
    const c = coord(tParking, parkingEvidence, '停车场');
    return {
      ...baseParking,
      fee_detail: clean(baseParking.fee_detail) || '收费待现场确认。',
      guide_text: clean(baseParking.guide_text) || '入口、车位和步行路线待现场确认。',
      location: clean(baseParking.location) || clean(baseParking.name),
      ...c,
      navigation_available: false,
      source_records: rawFilesFor(base.name)
    };
  });
  const withPrices = parkings.map(row => row.min_price_hour).filter(finite);
  outPlaces.push({
    ...base,
    district: base.district || (base.name === '南越王博物院' ? '越秀区' : '待补充'),
    summary: clean(base.summary) || `${base.name}周边停车信息整理。`,
    area_tips: clean(base.area_tips) || '停车入口、收费和车位情况待现场确认。',
    ...placeCoord,
    navigation_available: false,
    parkings,
    min_price: withPrices.length ? Math.min(...withPrices) : null,
    min_price_display: withPrices.length ? base.min_price_display : '价格待补充',
    source_records: rawFilesFor(base.name)
  });
  audit.push({ place: base.name, parking_count: parkings.length, parking_names: parkings.map(row => row.name), dropped: base.parkings.filter(row => dropped.has(`${base.name}/${row.name}`)).map(row => ({ name: row.name, reason: dropped.get(`${base.name}/${row.name}`) })), raw_files: rawFilesFor(base.name), coordinates: parkings.map(row => ({ name: row.name, status: row.coordinate_status, poi: row.coordinate_poi_name, poi_id: row.coordinate_poi_id, lng: row.lng, lat: row.lat })) });
}

const generatedAt = new Date().toISOString();
const output = { places: outPlaces, generated_at: generatedAt, purpose: '保留有用停车候选；不确定收费和定位显式标记，重复或无明确归属的候选剔除', coordinate_provider: '腾讯位置服务 WebService 地点搜索', dropped: [...dropped].map(([key, reason]) => ({ key, reason })) };
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(auditPath, JSON.stringify({ generated_at: generatedAt, source: 'server/xhs-raw/p0-*', places: audit }, null, 2), 'utf8');

const lines = ['# 停车攻略完整整理（腾讯定位候选）', '', `地点：${outPlaces.length} 个；停车场：${outPlaces.reduce((n, row) => n + row.parkings.length, 0)} 个。收费或定位不完整的条目已保留并标注待确认。`, ''];
for (const place of outPlaces) {
  lines.push(`## ${place.name}`, '');
  for (const parking of place.parkings) {
    const location = finite(parking.lng) && finite(parking.lat) ? `${parking.lng}, ${parking.lat}（定位待核验）` : '定位待补充';
    lines.push(`停车场：${parking.name}`, `收费：${parking.fee_detail}`, `攻略正文：${parking.guide_text}`, `停车场定位：${location}`, '');
  }
}
fs.writeFileSync(markdownPath, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, markdown: markdownPath, audit: auditPath, places: outPlaces.length, parkings: outPlaces.reduce((n, row) => n + row.parkings.length, 0), dropped: dropped.size, pending_coords: outPlaces.flatMap(row => [row, ...row.parkings]).filter(row => row.coordinate_status !== '已核验').length }, null, 2));
