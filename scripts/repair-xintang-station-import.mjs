import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputPath = path.resolve('server/xhs-p1-33-34-import-20260914.json');
const capturePath = path.resolve('server/xhs-captures-p1-33-direct-relevance2-20260914.json');
const outputPath = path.resolve('server/xhs-xintang-station-repair-import-20260914.json');

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const captures = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
const place = payload.places.find(row => row.name === '新塘站');
if (!place) throw new Error('原始整理包中找不到新塘站');
const capture = captures.find(row => row.target_place === '新塘站');
if (!capture) throw new Error('抓取汇总中找不到新塘站');

const notes = new Map((capture.notes || []).map(note => [note.raw_file, note]));
const rawPathById = id => [...notes.keys()].find(file => file.includes(`-${id}.json`));
const sourceRecords = (ids, evidenceType = '正文') => ids.map(id => {
  const rawFile = rawPathById(id);
  const note = notes.get(rawFile);
  if (!note) throw new Error(`找不到新塘站原始笔记：${id}`);
  return {
    source_type: 'xiaohongshu',
    source_url: note.note_url || null,
    source_title: note.title || null,
    source_author: null,
    source_published_at: null,
    rank: note.search_rank || note.rank || null,
    evidence_type: evidenceType,
    raw_file: rawFile
  };
});

const rule = (rule_type, price, unit, description, extra = {}) => ({
  rule_type,
  price,
  unit,
  unit_minutes: unit === 'minute' ? (extra.unit_minutes ?? null) : null,
  start_minute: extra.start_minute ?? null,
  end_minute: extra.end_minute ?? null,
  time_start: extra.time_start ?? null,
  time_end: extra.time_end ?? null,
  description,
  confidence: extra.confidence || 'medium',
  priority: extra.priority ?? 50
});

const base = place.parkings[0];
const parking = (name, fee_detail, guide_text, location, fee_rules, ids, extra = {}) => ({
  ...base,
  name,
  fee_detail,
  guide_text,
  location,
  address: location,
  type: extra.type || '停车场',
  lng: extra.lng ?? null,
  lat: extra.lat ?? null,
  coordinate_status: extra.lng != null && extra.lat != null ? '待核验' : '待补充',
  navigation_available: false,
  coordinate_source: extra.coordinate_source ?? null,
  coordinate_poi_name: extra.coordinate_poi_name ?? null,
  coordinate_poi_id: extra.coordinate_poi_id ?? null,
  coordinate_address: extra.coordinate_address ?? null,
  entrance_verified: false,
  fee_rules,
  daily_cap: extra.daily_cap ?? null,
  night_flat: null,
  min_price_hour: extra.min_price_hour ?? null,
  confidence: extra.confidence || (fee_rules.length ? 'medium' : 'low'),
  conflict_flag: Boolean(extra.conflict_flag),
  source_records: sourceRecords(ids),
  source: '编辑整理（公开信息）',
  verified_at: null
});

place.lng = 113.606329;
place.lat = 23.133998;
place.coordinate_status = '待核验';
place.navigation_available = false;
place.coordinate_source = '腾讯位置服务地点搜索 POI 坐标（目标地点 POI，待入口复核）';
place.coordinate_poi_name = '广州新塘站';
place.coordinate_poi_id = '13005981794020610370';
place.coordinate_address = '广东省广州市增城区新塘地铁站E3口步行120米';
place.coordinate_verified_at = null;
place.entrance_verified = false;
place.area_tips = '站北停车场步行到站约5至8分钟，收费记录为2元/小时、12元/天封顶；北侧临时停车场靠近东进站口，1元/30分钟、全天12元封顶，但可能满位；社会停车场有首小时6元、之后1.5元/15分钟、24小时21元封顶的收费口径；东进站口对面另有露天社会停车场，存在12元/天封顶记录。不同车场的开放和收费可能调整，入场前按现场公示确认。';
place.parkings = [
  parking(
    '新塘站站北停车场',
    '2元/小时；有12元/天封顶的收费记录，优惠时段和当前标准以现场公示为准。',
    '导航搜索“站北停车场”；停车后步行到新塘站约5至8分钟，路线按当日开放入口通行。车位相对充足，但高峰期仍需确认余位。',
    '站北停车场',
    [rule('normal', 2, 'hour', '基础收费：2元/小时'), rule('cap', 12, 'day', '日封顶：12元/天')],
    ['698996a1000000000b00a25f', '6a4a680d000000000701192b'],
    { daily_cap: 12, min_price_hour: 2, conflict_flag: true }
  ),
  parking(
    '新塘站北侧临时停车场',
    '1元/30分钟；全天封顶12元。24小时可进出，但夜间现场管理情况需到场确认。',
    '可尝试导航“新塘高铁站北侧临时停车场”或“新塘站-临时地上停车场”，位置靠近东进站口。停车场为露天，监控区域约240个车位，可能出现满位。',
    '新塘高铁站北侧临时停车场',
    [rule('normal', 1, 'minute', '基础收费：1元/30分钟', { unit_minutes: 30 }), rule('cap', 12, 'day', '全天封顶：12元/天')],
    ['65bb45a90000000002012ddd', '67a7019d000000002803c1bc'],
    { daily_cap: 12, min_price_hour: 2 }
  ),
  parking(
    '广州新塘站社会停车场',
    '首小时6元；之后1.5元/15分钟；24小时封顶21元。收费可能随时段或管理调整，入场前以现场公示为准。',
    '可搜索“广州新塘站社会停车场”；停车后按当日开放进站口前往站房，东、西进站路线可能随站区管理调整。',
    '广州新塘站社会停车场',
    [rule('first', 6, 'hour', '首小时：6元/小时', { end_minute: 60 }), rule('normal', 1.5, 'minute', '之后：1.5元/15分钟', { unit_minutes: 15, start_minute: 60 }), rule('cap', 21, 'day', '24小时封顶：21元/天')],
    ['6a4a680d000000000701192b', '6a1667070000000007028802'],
    { lng: 113.607216, lat: 23.134824, daily_cap: 21, min_price_hour: 6, conflict_flag: true, coordinate_source: '腾讯位置服务地点搜索 POI 坐标（停车场出入口，待入口复核）', coordinate_poi_name: '广州新塘站社会停车场-出入口', coordinate_poi_id: '12738419480803323090', coordinate_address: '广东省广州市增城区站前路与站区道路交叉口正南方向106米左右' }
  ),
  parking(
    '新塘站东进站口对面露天社会停车场',
    '有12元/天封顶的收费记录；另有免费记录，具体场地和收费时段存在差异，入场前以现场公示为准。',
    '位置在新塘站东进站口对面一带，认准社会停车场入口；该处为露天车场，停车后按现场指引步行进站。',
    '新塘站东进站口对面社会停车场',
    [rule('cap', 12, 'day', '日封顶：12元/天', { confidence: 'low' })],
    ['6a1667070000000007028802'],
    { conflict_flag: true, confidence: 'low' }
  )
];

const prices = place.parkings.map(row => row.min_price_hour).filter(Number.isFinite);
place.min_price = Math.min(...prices);
place.min_price_display = '¥2/h起';

const out = { places: [place] };
fs.writeFileSync(outputPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(root, outputPath).replaceAll('\\', '/'),
  place: place.name,
  parkings: place.parkings.length,
  fee_rules: place.parkings.reduce((sum, row) => sum + row.fee_rules.length, 0),
  place_coordinate: [place.lng, place.lat],
  parking_coordinates: place.parkings.filter(row => row.lng != null && row.lat != null).length
}, null, 2));
