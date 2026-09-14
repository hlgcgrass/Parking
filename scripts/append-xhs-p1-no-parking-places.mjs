import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] ?? 'server/xhs-p1-curated-ready-import-20260914.json';
const output = process.argv[3] ?? 'server/xhs-p1-full-import-20260914.json';
const auditOutput = process.argv[4] ?? 'server/xhs-p1-full-audit-20260914.json';

const data = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
if (!Array.isArray(data.places)) throw new Error('输入文件缺少 places 数组');

const pendingPlaces = [
  ['南沙湿地公园', '广州市南沙区万顷沙镇新港大道1号', '南沙区', '南沙湿地公园是珠江口滨海湿地景区，停车攻略待进一步完善。'],
  ['黄花岗公园', '广州市越秀区先烈中路79号', '越秀区', '黄花岗公园是越秀区历史纪念公园，停车攻略待进一步完善。'],
  ['广州烈士陵园', '广州市越秀区中山二路92号', '越秀区', '广州烈士陵园位于越秀区老城区，停车攻略待进一步完善。'],
  ['广州博物馆', '广州市越秀区解放北路988号镇海楼', '越秀区', '广州博物馆位于越秀山镇海楼，停车攻略待进一步完善。'],
  ['粤剧艺术博物馆', '广州市荔湾区恩宁路127号', '荔湾区', '粤剧艺术博物馆位于荔湾历史文化街区，停车攻略待进一步完善。']
];

const existing = new Set(data.places.map(place => place.name));
for (const [name, address, district, summary] of pendingPlaces) {
  if (existing.has(name)) continue;
  data.places.push({
    name,
    category: '景点',
    city_code: '440100',
    address,
    district,
    summary,
    area_tips: '攻略完善中',
    tags: ['自驾', '攻略完善中'],
    lng: null,
    lat: null,
    coordinate_status: '待补充',
    navigation_available: false,
    coordinate_source: null,
    coordinate_poi_name: null,
    coordinate_poi_id: null,
    coordinate_address: null,
    coordinate_verified_at: null,
    entrance_verified: false,
    parkings: [],
    min_price: null,
    min_price_display: '价格待补充',
    heat: 50
  });
}

const outputPath = path.resolve(output);
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
const audit = {
  generated_at: new Date().toISOString(),
  input,
  output,
  places: data.places.length,
  parkings: data.places.reduce((sum, place) => sum + place.parkings.length, 0),
  fee_rules: data.places.flatMap(place => place.parkings).reduce((sum, parking) => sum + (parking.fee_rules || []).length, 0),
  guide_pending_places: data.places.filter(place => place.parkings.length === 0).map(place => place.name),
  missing_coordinate_places: data.places.filter(place => place.lng == null || place.lat == null).map(place => place.name)
};
fs.writeFileSync(path.resolve(auditOutput), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));
