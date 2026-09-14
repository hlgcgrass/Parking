import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(process.argv[2] ?? 'server/xhs-p0-remaining2-curated-import-20260914.json');
const outputPath = path.resolve(process.argv[3] ?? 'server/xhs-panyu-wanbo-coordinate-import-20260914.json');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const place = (data.places || []).find(row => row.name === '番禺万博');
if (!place) throw new Error('未找到番禺万博');

Object.assign(place, {
  lng: 113.3482,
  lat: 23.007661,
  coordinate_status: '待核验',
  navigation_available: false,
  coordinate_source: '腾讯位置服务地点搜索 POI 坐标（商圈中心候选，待人工核验）',
  coordinate_poi_name: '万博商务区营销中心',
  coordinate_poi_id: '1540618782399605525',
  coordinate_address: '广东省广州市番禺区汇智三路万博商务区',
  coordinate_verified_at: null,
  entrance_verified: false
});

fs.writeFileSync(outputPath, `${JSON.stringify({ places: [place] }, null, 2)}\n`);
console.log(JSON.stringify({
  output: outputPath,
  name: place.name,
  lng: place.lng,
  lat: place.lat,
  coordinate_poi_name: place.coordinate_poi_name,
  parkings: place.parkings.length
}, null, 2));
