import fs from 'node:fs';

const packagePath = process.argv[2] ?? 'server/xhs-p1-33-34-import-20260914.json';
const auditPath = process.argv[3] ?? 'server/xhs-p1-33-34-audit-20260914.json';
const finalPath = process.argv[4] ?? 'server/xhs-p1-33-34-final-20260914.md';
const data = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

const placeOverrides = {
  '白云机场': [113.308138, 23.391559, '广州白云国际机场', '12156608007023960961', '广东省广州市白云区机场大道东888号'],
  '庆盛站': [113.491259, 22.86623, '庆盛站-1号进站口', '128334861790320073', '广东省广州市南沙区东涌镇庆沙路88号'],
  '琶洲站': [113.366617, 23.098519, '琶洲[地铁站]', '11966514560684291051', '广东省广州市海珠区新港东路琶洲站'],
  '滘口客运站': [113.208325, 23.1139, '广州滘口汽车站', '15138163431715632892', '广东省广州市荔湾区芳村大道西533号'],
  '广州汽车站': [113.252441, 23.148305, '广东省汽车客运站', '14081526597197224578', '广东省广州市越秀区环市西路147号'],
  '广交会展馆': [113.362361, 23.100913, '中国进出口商品交易会展馆', '11428870536400391998', '广东省广州市海珠区阅江中路380号'],
  '南沙客运港': [113.612046, 22.769886, '广州市南沙客运港（轮渡站）', '13690283806242102145', '广东省广州市南沙区九龙（中国客运码头）'],
};
const parkingOverrides = {
  '白云机场T3 P11停车场': [113.321287, 23.362161, 'T3航站楼P11停车场入口', '12187260267134291402', '广东省广州市白云区广州白云国际机场T3航站楼P11停车场'],
  '白云站P6停车场': [113.249197, 23.189915, '广州白云站P6南停车场-出入口', '2964815038078279979', '广东省广州市白云区新塘一巷与棠新路交叉口正西方向40米左右'],
  '天河客运站内部停车场': [113.3436, 23.171, '天河客运站停车场', '12960946920587577910', '广东省广州市天河区元岗横路与天源路辅路交叉口西北方向92米左右'],
  '广交会展馆停车场': [113.358205, 23.101457, '广交会展馆A区停车场-出入口', '5803342636889989954', '广东省广州市海珠区'],
  '保利世贸博览馆停车场': [113.365302, 23.09559, '保利世贸博览馆地下停车场-出入口', '7329987427455014401', '广东省广州市海珠区'],
  '广州国际采购中心负一层停车场': [113.370327, 23.099079, '广州国际采购中心地下停车场', '2611946817757189698', '广东省广州市海珠区会展东路与新港东路交叉口正东方向167米左右'],
  '广州体育馆1号馆停车场': [113.275799, 23.180681, '广州体育馆立体停车场', '8960504156122096243', '广东省广州市白云区白云大道南783号广州体育馆'],
  '广州大学城体育中心停车场': [113.390113, 23.05642, '大学城体育中心体育场P1-P2地面停车场', '18218469094594299020', '广东省广州市番禺区大学城内环东路208号广州大学城体育中心体育场'],
};

const setCoordinate = (row, value, sourceLabel) => {
  const [lng, lat, poi, id, address] = value;
  Object.assign(row, { lng, lat, coordinate_status: '待核验', navigation_available: false, coordinate_source: sourceLabel, coordinate_poi_name: poi, coordinate_poi_id: id, coordinate_address: address, coordinate_verified_at: null, entrance_verified: /入口|出入口/.test(poi) });
};
for (const row of data.places || []) {
  if (placeOverrides[row.name]) setCoordinate(row, placeOverrides[row.name], '腾讯位置服务地点搜索 POI 坐标（官方地点/主要入口待核验）');
  for (const parking of row.parkings || []) if (parkingOverrides[parking.name]) setCoordinate(parking, parkingOverrides[parking.name], '腾讯位置服务地点搜索 POI 坐标（停车场入口待核验）');
}

// 新塘站临时停车场自动命中泛称“停车场”，不保留该错误坐标。
const xintang = data.places.flatMap(row => row.parkings || []).find(row => row.name === '新塘站北侧临时停车场');
if (xintang) Object.assign(xintang, { lng: null, lat: null, coordinate_status: '待补充', navigation_available: false, coordinate_source: null, coordinate_poi_name: null, coordinate_poi_id: null, coordinate_address: null, coordinate_verified_at: null, entrance_verified: false });

for (const row of audit.review || []) {
  const override = row.level === '地点' ? placeOverrides[row.place] : parkingOverrides[row.name];
  if (!override) continue;
  row.status = '人工筛选后坐标待核验';
  row.manual_override = true;
  row.location = { lng: override[0], lat: override[1] };
  row.poi = override[2]; row.poi_id = override[3]; row.address = override[4];
}
const allParkings = data.places.flatMap(row => row.parkings || []);
audit.manual_overrides = { places: Object.keys(placeOverrides), parkings: Object.keys(parkingOverrides) };
audit.missing_place_coordinates = data.places.filter(row => row.lng == null || row.lat == null).length;
audit.missing_parking_coordinates = allParkings.filter(row => row.lng == null || row.lat == null).length;
audit.review = audit.review;
fs.writeFileSync(packagePath, `${JSON.stringify(data, null, 2)}\n`);
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
const md = ['# 3.3—3.4 停车攻略整理稿', '', `生成时间：${audit.generated_at}`, '', ...data.places.map(row => [`## ${row.name}`, `- 停车场：${row.parkings.length ? row.parkings.map(k => k.name).join('、') : '攻略完善中'}`, `- 收费：${row.parkings.length ? row.parkings.map(k => k.fee_detail).join('；') : '收费待现场确认'}`, `- 攻略正文：${row.area_tips}`, `- 地点定位：${row.coordinate_address || '位置待补充'}`, ''].join('\n'))].join('\n');
fs.writeFileSync(finalPath, md);
console.log(JSON.stringify({ packagePath, auditPath, finalPath, place_coordinates: data.places.filter(row => row.lng != null && row.lat != null).length, parking_coordinates: allParkings.filter(row => row.lng != null && row.lat != null).length, missing_parking_coordinates: audit.missing_parking_coordinates }, null, 2));
