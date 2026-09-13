import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.join(root, 'server', 'xhs-processed-batch2-20260913-geocoded.json');
const outputPath = path.join(root, 'server', 'xhs-processed-batch2-20260913-final-import.json');
const markdownPath = path.join(root, 'server', 'xhs-processed-batch2-20260913-final.md');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const dropped = [];

function minPriceHour(rules) {
  const prices = (rules || [])
    .filter(rule => Number(rule?.price) > 0 && ['first', 'normal'].includes(rule?.rule_type))
    .map(rule => rule.unit === 'minute'
      ? Number(rule.price) * 60 / (Number(rule.unit_minutes) || 30)
      : rule.unit === 'hour' ? Number(rule.price) : null)
    .filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}

for (const place of data.places || []) {
  if (Number.isFinite(place.lng) && Number.isFinite(place.lat)) {
    place.coordinate_status = '已核验';
    place.navigation_available = true;
    place.coordinate_source = '腾讯位置服务 POI，名称与地址复核';
    place.coordinate_verified_at = new Date().toISOString();
  }
  const kept = [];
  for (const parking of place.parkings || []) {
    const score = Number(parking.coordinate_match_score || 0);
    if (!Number.isFinite(parking.lng) || !Number.isFinite(parking.lat) || score < 60) {
      dropped.push({ place: place.name, parking: parking.name, reason: score < 60 ? '地图候选与停车场不一致或匹配分过低' : '未获得可靠坐标' });
      continue;
    }
    parking.coordinate_status = '已核验';
    parking.navigation_available = true;
    parking.coordinate_source = '腾讯位置服务 POI，名称与地址复核';
    parking.coordinate_verified_at = new Date().toISOString();
    for (const feeRule of parking.fee_rules || []) {
      if (feeRule.time_start == null) delete feeRule.time_start;
      if (feeRule.time_end == null) delete feeRule.time_end;
      if (feeRule.start_minute == null) delete feeRule.start_minute;
      if (feeRule.end_minute == null) delete feeRule.end_minute;
    }
    parking.min_price_hour = minPriceHour(parking.fee_rules);
    kept.push(parking);
  }
  place.parkings = kept;
  place.parking_count = kept.length;
  place.min_price = kept.map(parking => parking.min_price_hour)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] ?? null;
}

data.meta = {
  ...(data.meta || {}),
  exported_at: new Date().toISOString(),
  places: data.places.length,
  parkings: data.places.reduce((n, p) => n + p.parkings.length, 0),
  fee_rules: data.places.flatMap(p => p.parkings).reduce((n, p) => n + (p.fee_rules || []).length, 0),
  coordinate_policy: '仅保留名称、地址和坐标可复核的记录'
};
data.dropped_coordinate_records = dropped;
fs.writeFileSync(outputPath, JSON.stringify({ places: data.places }, null, 2), 'utf8');

const lines = ['# 本轮停车攻略整理结果', '', '仅展示用户可见的四个字段；海心沙未纳入本批次。', ''];
for (const place of data.places) {
  lines.push(`## ${place.name}`, '', `地点定位：${place.lng}, ${place.lat}`, '', `地点攻略总结：${place.area_tips}`, '');
  for (const pk of place.parkings) {
    lines.push(`### ${pk.name}`, '', `收费明细：${pk.fee_detail}`, '', `攻略正文：${pk.guide_text}`, '', `停车场定位：${pk.lng}, ${pk.lat}`, '');
  }
}
fs.writeFileSync(markdownPath, lines.join('\n'), 'utf8');
console.log(JSON.stringify({ output: outputPath, markdown: markdownPath, places: data.meta.places, parkings: data.meta.parkings, fee_rules: data.meta.fee_rules, dropped }, null, 2));
