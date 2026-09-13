import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const rawDir = path.join(root, 'server', 'xhs-raw', 'selected-batch2-20260913');
const outputPath = path.join(root, 'server', 'xhs-processed-batch2-20260913-import.json');

const rule = (rule_type, price, unit, description, extra = {}) => ({
  rule_type, start_minute: null, end_minute: null, time_start: null, time_end: null,
  price, unit, unit_minutes: unit === 'minute' ? 30 : unit === 'hour' ? 60 : null,
  priority: rule_type === 'cap' ? 100 : 50, description, confidence: 'medium', ...extra
});

const parking = (name, fee_detail, guide_text, location, fee_rules, extra = {}) => ({
  name, fee_detail, guide_text, location, fee_rules,
  free_minutes: 0, confidence: 'medium', conflict_flag: false,
  navigation_available: false, coordinate_status: '待补充',
  source: '小红书公开图文整理', ...extra
});

const places = [
  {
    name: '白云山', category: '景点', city_code: '440100',
    address: '广州市白云区广园中路801号', district: '白云区',
    summary: '白云山入口分散，南门、西门和云台花园方向停车选择不同，周末节假日车位和排队情况变化明显。',
    area_tips: '白云山本轮整理了南门、西门和云台花园方向的停车点。国际会堂及益友汽配城一带有较明确的收费和步行信息，云台花园附近步行较短；南门官方车场在节假日可能排队，部分机械车位和商场车场需要留意车型、入口及现场收费变化。',
    tags: ['自然景区', '亲子'],
    parkings: [
      parking('广州白云国际会议中心国际会堂停车场', '10元/次；中途驶出后再次进入需重新收费。近期有不同收费反馈，现场以当日公示为准。', '导航到国际会堂北门方向，停车后步行约300米可到白云山一侧入口；周末相对容易找到位置，但开放情况可能随日期变化。', '广州白云国际会议中心国际会堂停车场', [rule('normal', 10, 'time', '单次收费', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' }),
      parking('白云山西门停车场', '10元/小时。', '适合从西门进山，车位情况会随周末和节假日变化；高峰时段可能在入口处排队，带儿童或推车建议提前规划进山路线。', '白云山西门停车场', [rule('normal', 10, 'hour', '基础收费')]),
      parking('益友（广园东）汽配城停车场', '5元/30分钟，即10元/小时。', '到云台花园南门步行约5至8分钟，停车位约200个；上午10点后车位可能趋紧，建议尽量提前到达。', '益友广园东汽配城停车场', [rule('normal', 5, 'minute', '每30分钟收费')], { total_spots: 200 }),
      parking('益友（国际）汽配用品展贸中心停车场', '5元/30分钟，即10元/小时。', '到云台花园南门步行约10分钟，停车位相对宽裕，高峰期可容纳较多车辆；下午到达时可作为云台花园方向的优先备选。', '益友国际汽配用品展贸中心停车场', [rule('normal', 5, 'minute', '每30分钟收费')], { total_spots: 900 }),
      parking('白云双燕机器人停车场', '10元/小时。', '位于白云山南门方向，门牌较容易辨认，位置相对多；从最早的路口进入时距离缆车方向较近。', '白云双燕机器人停车场', [rule('normal', 10, 'hour', '基础收费')]),
      parking('白云双燕机器人停车场（金溪小卖部）', '10元/小时。', '与主停车场相邻但需要继续往里开，步行距离更长；南门方向多个车场相邻，进场前注意不要错过对应入口。', '白云双燕机器人停车场 金溪小卖部', [rule('normal', 10, 'hour', '基础收费')]),
      parking('云山天地商场停车场', '白天12元/小时；深夜6元/小时；消费可抵2小时停车。', '靠近白云山南门，商场入口和停车楼相对好找；高峰及节假日可能出现满位或排队，使用消费优惠前先核对现场规则。', '云山天地商场停车场', [rule('normal', 12, 'hour', '白天收费', { confidence: 'low' }), rule('night', 6, 'hour', '深夜收费', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' })
    ]
  },
  {
    name: '陈家祠', category: '景点', city_code: '440100',
    address: '广州市荔湾区中山七路恩龙里34号', district: '荔湾区',
    summary: '陈家祠周边停车场较集中，收费差异和开放状态差别较大，适合按停留时长比较封顶价。',
    area_tips: '陈家祠本轮整理了康王路、中山七路和荔湾路方向的停车点。荔湾体育馆停车场步行到陈家祠约3分钟，价格和封顶信息较完整；康王阁、荔康大厦等车库收费分时段，世纪广场存在开放状态变化，停车前要确认入口和当日公示。',
    tags: ['历史建筑', '荔湾'],
    parkings: [
      parking('五行科技创意园停车场', '6元/小时，24小时限价35元。', '位于陈家祠周边，入口到园区内部道路可能有路边停车车辆，进场时留意会车和入口方向。', '五行科技创意园停车场', [rule('normal', 6, 'hour', '基础收费'), rule('cap', 35, 'day', '24小时限价')]),
      parking('康王阁停车场', '日间（08:00-20:00）4元/小时；夜间收费记录为10元，24小时最高限价24元，夜间计费单位以现场公示为准。', '位于康王路926号负一、负二层，适合陈家祠周边短时或过夜停车；进场后建议确认夜间计费口径。', '康王路926号康王阁停车场', [rule('normal', 4, 'hour', '日间收费', { time_start: '08:00', time_end: '20:00' }), rule('cap', 24, 'day', '24小时最高限价')], { confidence: 'low', conflict_flag: true }),
      parking('荔康大厦停车场', '日间（08:00-20:00）8元/小时，最高48元；夜间8元/小时，夜间最高24元，24小时最高68元。', '位于康王北路978号负一、负二层，分时收费和封顶价较多，长时间停放前要核对当前时段及封顶规则。', '康王北路978号荔康大厦停车场', [rule('normal', 8, 'hour', '日间收费', { time_start: '08:00', time_end: '20:00' }), rule('normal', 8, 'hour', '夜间收费', { time_start: '20:00', time_end: '08:00' }), rule('cap', 68, 'day', '24小时最高限价')]),
      parking('荔湾体育馆停车场', '日间（07:30-21:30）3小时内5元/小时，超过3小时10元/小时；夜间（21:30-次日07:30）2元/小时，夜间最高10元，24小时最高45元。', '露天停车场，步行到陈家祠约3分钟；车位数量有限，满位时按出一辆进一辆，等位时间曾较短。', '广州市荔湾区荔湾路54号荔湾体育馆停车场', [rule('first', 5, 'hour', '日间前3小时', { time_start: '07:30', time_end: '21:30' }), rule('normal', 10, 'hour', '日间超过3小时', { time_start: '07:30', time_end: '21:30' }), rule('night', 2, 'hour', '夜间收费', { time_start: '21:30', time_end: '07:30' }), rule('cap', 45, 'day', '24小时最高限价')]),
      parking('1906科技园停车场', '10元/小时，24小时最高限价100元。', '位于中山七路333号科技园内实验厂房旁，适合需要在陈家祠周边长时间停留的情况。', '荔湾区中山七路333号1906科技园', [rule('normal', 10, 'hour', '基础收费'), rule('cap', 100, 'day', '24小时最高限价')]),
      parking('强俊停车场', '12小时限价20元，24小时限价40元。', '位于中山七路锦龙北45号，适合按半天或全天停放；进场后确认限价对应的计费时段。', '广州市荔湾区中山七路锦龙北45号强俊停车场', [rule('cap', 20, 'time', '12小时限价'), rule('cap', 40, 'day', '24小时限价')]),
      parking('城光荟停车场', '16元/小时，128元封顶；购物每消费100元可减免1小时，最多减免3小时。', '位于康王中路新光城市广场负一、负三、负四层，车库层数较多；停车优惠需要满足消费条件，离场前核对减免是否生效。', '康王中路600、658号新光城市广场城光荟停车场', [rule('normal', 16, 'hour', '基础收费'), rule('cap', 128, 'day', '封顶')], { daily_cap: 128 })
    ]
  },
  {
    name: '越秀公园', category: '景点', city_code: '440100',
    address: '广州市越秀区解放北路988号', district: '越秀区',
    summary: '越秀公园入口较多，东北门官方停车场距离步道较近，周末节假日要注意车位和入口排队。',
    area_tips: '越秀公园本轮确认了东北门官方停车场和中医学院站附近路边停车点。东北门停车场收费分日间、夜间并有全天封顶，停车后步行约2分钟即可到步道入口；外围路边车位价格较低但位置和管理不稳定，不适合作为唯一方案。',
    tags: ['公园', '亲子'],
    parkings: [
      parking('越秀公园东北门停车场', '日间（07:30-21:30）前3小时2.5元/30分钟，超过3小时5元/30分钟；夜间（21:30-次日07:30）1元/30分钟，夜间最高10元；24小时封顶45元。', '导航“越秀公园东北门停车场”或绿岛餐厅方向，从解放北路西胜街一侧进入；停车后步行约2分钟到东北门步道入口。周末和节假日车位较紧张，上午或下午较早到达更容易进场。', '越秀公园东北门停车场', [rule('first', 2.5, 'minute', '日间前3小时每30分钟', { time_start: '07:30', time_end: '21:30' }), rule('normal', 5, 'minute', '日间超过3小时每30分钟', { time_start: '07:30', time_end: '21:30' }), rule('night', 1, 'minute', '夜间每30分钟', { time_start: '21:30', time_end: '07:30' }), rule('cap', 45, 'day', '24小时封顶')]),
      parking('中医学院站附近路边停车位', '5元/小时，12小时封顶40元。', '位于中医学院站附近居民区胡同一带，车行到越秀公园约10分钟；露天车位相对分散，步行或换乘公交前要确认现场是否允许停放。', '中医学院站附近居民区胡同路边停车位', [rule('normal', 5, 'hour', '基础收费'), rule('cap', 40, 'time', '12小时封顶')], { confidence: 'low' })
    ]
  },
  {
    name: '花城广场', category: '景点', city_code: '440100',
    address: '广州市天河区珠江东路花城广场', district: '天河区',
    summary: '花城广场地下车库分区较多，P8至P13更适合连接博物馆、海心沙和广州塔，预约与现场收费可能不同。',
    area_tips: '花城广场本轮整理了花城汇P13、都荟华庭和侨鑫国际等停车选择。P8至P13方向通常更方便到达花城广场及海心沙，部分车库有电梯或楼梯直达地面；工作日和活动时段核心车库可能排队，预约价格及优惠使用前要确认入场规则。',
    tags: ['城市地标', '花城广场'],
    parkings: [
      parking('花城汇P13停车场', '现场收费约7.5元/小时，预约价格6.8元/小时且无阶梯收费；不同活动期间规则可能调整，现场以当日公示为准。', 'P13位于花城汇靠近广州塔和海心沙的一侧，P8、P11、P13有电梯通往花城广场地面；步行到海心沙约5至10分钟。预约通常需要进场前完成，预约后按实际停车规则结算。', '花城汇P13停车场', [rule('normal', 7.5, 'hour', '现场基础收费', { confidence: 'low' }), rule('normal', 6.8, 'hour', '预约价格，无阶梯收费', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' }),
      parking('都荟华庭停车场', '预约后约6.4元/小时，12小时封顶32元；预约优惠和现场收费可能不同，入场前确认当日规则。', '距离花城广场步行约10至15分钟，约800米；活动或灯光节期间可作为外围备选，散场时相对容易避开核心车库排队。', '都荟华庭停车场', [rule('normal', 6.4, 'hour', '预约价格', { confidence: 'low' }), rule('cap', 32, 'time', '12小时封顶', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' }),
      parking('侨鑫国际停车场', '消费满100元可减免约4小时停车；就诊凭票有再减免1小时的反馈，基础收费未确认，现场以公示为准。', '靠近花城汇中部和妇女儿童医疗中心一带，车位相对宽一些；优惠需要满足消费或就诊条件，离场前确认减免是否已计入。', '侨鑫国际停车场', [], { confidence: 'low', conflict_flag: true })
    ]
  }
];

const rawFiles = fs.readdirSync(rawDir).filter(name => name.endsWith('.json') && name.includes('-note-'));
const allRaw = rawFiles.map(file => {
  const data = JSON.parse(fs.readFileSync(path.join(rawDir, file), 'utf8'));
  return { file, data, text: String(data.visible_text || '') };
});
for (const place of places) {
  for (const pk of place.parkings) {
    const aliases = [pk.name, pk.location].filter(Boolean);
    pk.source_records = allRaw.filter(row => aliases.some(alias => row.text.includes(alias))).slice(0, 8).map(row => ({
      raw_file: path.relative(root, path.join(rawDir, row.file)).replaceAll('\\', '/'),
      source_url: row.data.note_url || row.data.requested_url || '',
      source_title: row.data.title || '',
      captured_at: row.data.captured_at || ''
    }));
  }
}

const payload = { meta: { city: '广州', city_code: '440100', exported_at: new Date().toISOString(), source: '小红书图文原始 JSON 按数据整理规则整理', places: places.length, parkings: places.reduce((n, p) => n + p.parkings.length, 0), fee_rules: places.flatMap(p => p.parkings).reduce((n, p) => n + p.fee_rules.length, 0) }, places };
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, places: payload.meta.places, parkings: payload.meta.parkings, fee_rules: payload.meta.fee_rules, source_notes: rawFiles.length }, null, 2));
