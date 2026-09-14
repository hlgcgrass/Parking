import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(process.argv[2] ?? 'server/xhs-p0-latest-20260914-tencent.json');
const reviewPath = path.resolve(process.argv[3] ?? 'server/xhs-p0-latest-20260914-tencent.review.json');
const outputPath = path.resolve(process.argv[4] ?? 'server/xhs-p0-latest-20260914-final-import.json');
const markdownPath = path.resolve(process.argv[5] ?? 'server/xhs-p0-latest-20260914-final.md');
const pendingPath = path.resolve(process.argv[6] ?? 'server/xhs-p0-latest-20260914-pending.json');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8')).review;

const selected = {
  '广州图书馆': ['广州图书馆停车场', '花城汇P13区停车场'],
  '海心沙': ['海心沙亚运公园停车场'],
  '海珠湖': ['海珠湖公园停车场', '坚真花园停车场'],
  '华南植物园': ['华南植物园正门停车场'],
  '黄埔军校': ['黄埔军校旧址纪念馆配套地上停车场'],
  '莲花山': ['莲花山旅游区西门停车场'],
  '沙湾古镇': ['沙湾古镇西门停车场', '沙湾古镇南停车场'],
  '永庆坊/荔枝湾': ['永庆坊金声停车场'],
  '余荫山房': ['余荫山房停车场'],
  '长隆旅游度假区': ['长隆野生动物世界P5停车场'],
  '中山纪念堂': ['广州交易广场地下停车场'],
  '广东省妇幼保健院': ['7号小镇创意园停车场'],
  '广东省人民医院': ['青龙里小区停车场'],
  '广州市妇女儿童医疗中心（珠江新城院区）': ['市妇幼停车场', '中山眼科停车场'],
  '大夫山森林公园': ['大夫山森林公园北门停车场'],
  '二沙岛': ['二沙岛体育公园停车场', '文立方商场停车场', '宏城公园停车场']
};

const pendingReasons = {
  '南越王博物院': '唯一可核验的候选停车场已归属于越秀公园主地点；按同一停车场只保留一个主地点的规则，本批不重复挂接。',
  '广东省中医院': '现有收费事实不足以形成正式收费明细，保留待补收费和入口复核。',
  '广州市第一人民医院': '现有笔记未确认院内或周边停车场正式收费，保留待补。',
  '广州医科大学附属第一医院': '检索到总院 POI 和院区入口，但未确认可供就诊车辆使用的停车场及收费。',
  '大夫山森林公园': '确认南门/北门入口，但本批笔记未形成可核验的正式收费规则。'
};

const byKey = (level, place, name) => review.find(row => row.level === level && row.place === place && row.name === name);
const finite = value => Number.isFinite(Number(value));
function attachCoordinate(row, evidence, level) {
  const location = finite(row.lng) && finite(row.lat) ? { lng: Number(row.lng), lat: Number(row.lat) } : evidence?.location;
  if (!location || !finite(location.lng) || !finite(location.lat)) throw new Error(`${level}缺少腾讯 POI 坐标：${row.name}`);
  const poi = evidence?.poi || row.coordinate_poi_name || row.name;
  const entrance = /入口|出入口/.test(poi);
  return {
    ...row,
    lng: Number(location.lng), lat: Number(location.lat),
    coordinate_status: '已核验', navigation_available: true,
    coordinate_source: entrance ? '腾讯位置服务 POI 入口候选，名称、地址与停车路线复核' : '腾讯位置服务地点搜索 POI，名称、地址与停车路线复核（POI 中心）',
    coordinate_poi_name: poi,
    coordinate_poi_id: evidence?.poi_id || row.coordinate_poi_id || '',
    coordinate_address: evidence?.address || row.coordinate_address || row.location,
    entrance_verified: entrance,
    coordinate_verified_at: new Date().toISOString()
  };
}

const finalPlaces = [];
const pending = [];
for (const place of source.places) {
  const names = selected[place.name];
  if (!names) {
    pending.push({ place: place.name, reason: pendingReasons[place.name] || '本批次未满足最终入库条件', raw_files: [] });
    continue;
  }
  const placeEvidence = byKey('地点', place.name, place.name);
  try {
    const next = attachCoordinate(place, placeEvidence, '地点');
    if (!next.district && next.name === '南越王博物院') next.district = '越秀区';
    next.parkings = names.map(name => {
      const parking = place.parkings.find(row => row.name === name);
      if (!parking) throw new Error(`找不到停车场：${place.name}/${name}`);
      const parkingEvidence = byKey('停车场', place.name, name);
      if (!parking.fee_detail || (!parking.fee_rules?.length && !/\d/.test(parking.fee_detail))) throw new Error(`收费事实不足：${place.name}/${name}`);
      return attachCoordinate(parking, parkingEvidence, '停车场');
    });
    finalPlaces.push(next);
  } catch (error) {
    pending.push({ place: place.name, reason: error.message, raw_files: [] });
  }
}

const out = { places: finalPlaces, generated_at: new Date().toISOString(), coordinate_provider: '腾讯位置服务 WebService 地点搜索' };
fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');
fs.writeFileSync(pendingPath, JSON.stringify({ generated_at: out.generated_at, places: pending }, null, 2), 'utf8');

const lines = ['# 停车攻略整理批次（腾讯定位复核）', '', `本批正式可入库地点：${finalPlaces.length} 个；待补充：${pending.length} 个。`, ''];
for (const place of finalPlaces) {
  lines.push(`## ${place.name}`, '');
  for (const parking of place.parkings) {
    lines.push(`停车场：${parking.name}`, `收费：${parking.fee_detail}`, `攻略正文：${parking.guide_text}`, `停车场定位：${parking.coordinate_poi_name}（${parking.lng}, ${parking.lat}）`, '');
  }
}
lines.push('## 待补充', '');
for (const item of pending) lines.push(`- ${item.place}：${item.reason}`);
fs.writeFileSync(markdownPath, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, markdown: markdownPath, pending: pendingPath, final_places: finalPlaces.length, final_parkings: finalPlaces.reduce((n, place) => n + place.parkings.length, 0), pending_places: pending.length }, null, 2));
