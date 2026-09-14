import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'parking-miniapp', 'cloudfunctions', 'parking', 'data.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(root, 'server', 'xhs-p0-candidates-latest-20260914.json'), 'utf8'));
const outputPath = path.join(root, 'server', 'xhs-p0-latest-20260914-import.json');
const auditPath = path.join(root, 'server', 'xhs-p0-latest-20260914-audit.json');

const rule = (rule_type, price, unit, description, extra = {}) => ({
  rule_type, price, unit, unit_minutes: unit === 'minute' ? 30 : unit === 'hour' ? 60 : null,
  priority: rule_type === 'cap' ? 100 : 50, description, confidence: 'medium', ...extra
});

const p = (name, fee_detail, guide_text, location, fee_rules, extra = {}) => ({
  name, fee_detail, guide_text, location, fee_rules,
  type: '停车场', free_minutes: 0, payment: [], confidence: 'medium',
  conflict_flag: false, coordinate_status: '待补充', navigation_available: false,
  source: '小红书公开图文整理', ...extra
});

const defs = {
  '广州图书馆': [
    p('广州图书馆停车场', '5元/小时（前3小时）；其余时段收费以现场公示为准。', '停车后从广州图书馆东门或西门进入；机械车位对车宽有限制，车宽接近1.95米时应先确认是否能安排普通车位。', '广州图书馆停车场', [rule('normal', 5, 'hour', '前3小时基础收费', { confidence: 'low' })], { confidence: 'low' }),
    p('花城汇P13区停车场', '现场收费约7.5元/小时；预约价格约6.8元/小时且无阶梯收费，规则可能随活动调整。', 'P13靠近广州塔和海心沙方向，P8、P11、P13均可通过电梯到花城广场地面；步行到海心沙约5至10分钟，预约后按当日规则结算。', '花城汇P13区停车场', [rule('normal', 7.5, 'hour', '现场基础收费', { confidence: 'low' }), rule('normal', 6.8, 'hour', '预约价格', { confidence: 'low' })], { confidence: 'low', conflict_flag: true })
  ],
  '海心沙': [
    p('海心沙亚运公园停车场', '5元/小时，24小时封顶25元。', '停车后步行到广州塔约8至10分钟；车位相对不易满，场内有充电桩。活动日仍应预留入场时间。', '海心沙亚运公园停车场', [rule('normal', 5, 'hour', '基础收费'), rule('cap', 25, 'day', '24小时封顶')], { daily_cap: 25 }),
    p('珠江帝景北门停车场', '10元/小时，24小时封顶60元。', '作为广州塔方向的兜底停车点，停车后步行约3至5分钟到广州塔一带；大型活动期间先确认是否有交通管控。', '珠江帝景北门停车场', [rule('normal', 10, 'hour', '基础收费'), rule('cap', 60, 'day', '24小时封顶')], { daily_cap: 60 })
  ],
  '海珠湖': [
    p('海珠湖公园停车场', '约2.5元/30分钟；具体收费以入口公示为准。', '北广场/北门方向可直接进入公园停车场；周末车位较紧张，建议早点到或改乘地铁大塘站。', '海珠湖公园停车场', [rule('normal', 2.5, 'minute', '每30分钟收费', { confidence: 'low' })], { confidence: 'low' }),
    p('坚真花园停车场', '30分钟内免费，24小时封顶15元。', '距离海珠湖约0.77公里，步行约8至10分钟；可作为公园停车位不足时的备选。', '坚真花园停车场', [rule('free', 0, 'minute', '30分钟内免费'), rule('cap', 15, 'day', '24小时封顶')], { daily_cap: 15 }),
    p('东风经济联合社工会联合会停车场', '15分钟内免费，5元/小时，24小时封顶30元。', '距离海珠湖约0.77公里，步行约8至10分钟；入场后按现场指引停车。', '东风经济联合社工会联合会停车场', [rule('free', 0, 'minute', '15分钟内免费'), rule('normal', 5, 'hour', '基础收费'), rule('cap', 30, 'day', '24小时封顶')], { daily_cap: 30 })
  ],
  '华南植物园': [
    p('华南植物园正门停车场', '2.5元/30分钟（3小时内）；其他时段以现场公示为准。', '导航华南植物园正门，地铁植物园站A口步行约5分钟；周末10点后正门车位可能紧张，可按工作人员指引转西门。', '华南植物园正门停车场', [rule('normal', 2.5, 'minute', '3小时内每30分钟收费', { confidence: 'medium' })]),
    p('华南植物园西门停车场', '收费以现场公示为准。', '正门无位时可改走西门，车位相对充足；从西门入园后按园区指引游览。', '华南植物园西门停车场', [], { confidence: 'low' })
  ],
  '黄埔军校': [
    p('黄埔军校旧址纪念馆配套地上停车场', '收费约8至10元/小时，具体以现场公示为准。', '导航黄埔军校旧址纪念馆配套地上停车场；长洲岛景点之间步行或短途接驳，周末先确认是否有交通管控。', '黄埔军校旧址纪念馆配套地上停车场', [rule('normal', 10, 'hour', '参考小时收费', { confidence: 'low' })], { confidence: 'low' }),
    p('长洲岛地上停车场-出入口', '收费约8至10元/小时，具体以现场公示为准。', '适合长洲岛廊桥及周边景点；导航时使用“长洲岛地上停车场-出入口”，节假日道路可能拥堵。', '长洲岛地上停车场-出入口', [rule('normal', 10, 'hour', '参考小时收费', { confidence: 'low' })], { confidence: 'low' })
  ],
  '莲花山': [
    p('莲花山旅游区西门停车场', '3小时内3元/小时；其他时段以现场公示为准。', '导航莲花山旅游区西门，入口最近；景区内有多个停车点，进场后按指引前往P1、P2或P7，节假日入口道路可能排队。', '莲花山旅游区西门停车场', [rule('normal', 3, 'hour', '3小时内基础收费')])
  ],
  '南越王博物院': [
    p('越秀公园东北门停车场', '日间前3小时5元/小时，超过3小时10元/小时；夜间1元/30分钟，夜间最高10元；24小时封顶45元。', '停车后步行到南越王博物院王墓展区约20分钟，不是最近入口；适合同时游览越秀公园的情况，周末节假日提前确认余位。', '越秀公园东北门停车场', [rule('first', 5, 'hour', '日间前3小时', { time_start: '07:30', time_end: '21:30' }), rule('normal', 10, 'hour', '日间超过3小时', { time_start: '07:30', time_end: '21:30' }), rule('night', 1, 'minute', '夜间每30分钟', { time_start: '21:30', time_end: '07:30' }), rule('cap', 45, 'day', '24小时封顶')], { daily_cap: 45, confidence: 'low' })
  ],
  '沙湾古镇': [
    p('沙湾古镇西门停车场', '5元/小时；在同福酒家消费可减免3小时停车费，优惠以现场规则为准。', '导航沙湾古镇西门，步行进入古镇；周末车位不多，入口可能排队，建议尽量提前到达。', '沙湾古镇西门停车场', [rule('normal', 5, 'hour', '基础收费')]),
    p('沙湾古镇南停车场', '约5元/小时；另有10元/天的收费口径，收费存在差异，现场以当日公示为准。', '南门方向停车后步行进入古镇；适合长时间停留，但应在入场时确认按小时还是按天计费。', '沙湾古镇南停车场', [rule('normal', 5, 'hour', '参考小时收费', { confidence: 'low' }), rule('cap', 10, 'day', '参考全天收费', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' })
  ],
  '永庆坊/荔枝湾': [
    p('永庆坊金声停车场', '约10元/小时，具体以现场公示为准。', '导航永庆坊金声停车场，停车后步行进入恩宁路和永庆坊；老城区道路较窄，周末尽量错峰。', '永庆坊金声停车场', [rule('normal', 10, 'hour', '参考小时收费', { confidence: 'low' })], { confidence: 'low' }),
    p('广州市荔湾路125号停车场', '5元/小时；白天与夜间分时收费时，以入口公示为准。', '停车场入口通道较窄，车位主要在内部和露天区域；停车后步行到彩虹桥地铁站约数分钟，再前往永庆坊。', '广州市荔湾路125号停车场', [rule('normal', 5, 'hour', '基础收费')]),
    p('昌华街居民住宅停车场', '10元/次；实际可停时长和开放状态以现场管理为准。', '距离永庆坊步行约5分钟；住宅停车位受现场管理影响，进场前确认是否接待临时车辆。', '昌华街居民住宅停车场', [rule('normal', 10, 'time', '单次收费', { confidence: 'low' })], { confidence: 'low' })
  ],
  '余荫山房': [
    p('余荫山房停车场', '前3小时3元/小时，超过3小时6元/小时；另有全天10元封顶的记录，现场以公示为准。', '导航余荫山房停车场，园区门口停车后直接入园；车位相对方便，周末建议早点到。', '余荫山房停车场', [rule('first', 3, 'hour', '前3小时', { confidence: 'medium' }), rule('normal', 6, 'hour', '超过3小时', { confidence: 'medium' }), rule('cap', 10, 'day', '全天封顶', { confidence: 'low' })], { daily_cap: 10, conflict_flag: true, confidence: 'medium' })
  ],
  '长隆旅游度假区': [
    p('长隆野生动物世界P5停车场', '前三小时每30分钟2元；超过3小时每30分钟4元；36元/天封顶。', 'P5靠近南门，停车位相对多；旺季和节假日上午车位紧张，满位时按园区指引改停其他停车场并乘免费摆渡车。', '长隆野生动物世界P5停车场', [rule('first', 2, 'minute', '前三小时每30分钟', { end_minute: 180 }), rule('normal', 4, 'minute', '超过3小时每30分钟', { start_minute: 180 }), rule('cap', 36, 'day', '每日封顶')], { daily_cap: 36 }),
    p('长隆野生动物世界P3停车场', '收费以现场公示为准；高峰时段可能满位。', 'P3靠近南门，但高峰时段可能先满；到场后按工作人员指引选择可用车场。', '长隆野生动物世界P3停车场', [], { confidence: 'low' })
  ],
  '中山纪念堂': [
    p('广州交易广场地下停车场', '10元/小时；近期存在不同收费牌信息，现场以当日公示为准。', '普通地下车库，步行到中山纪念堂约300米、不到10分钟；从交易广场电梯出站后按纪念堂地铁站方向过街。', '广州交易广场地下停车场', [rule('normal', 10, 'hour', '基础收费', { confidence: 'low' })], { conflict_flag: true, confidence: 'low' }),
    p('颐德中心地下停车场', '收费以现场公示为准。', '中山纪念堂周边车位紧张时可作为备选，停车后步行约15分钟；不建议把路边未划线位置作为稳定方案。', '颐德中心地下停车场', [], { confidence: 'low' })
  ],
  '广东省妇幼保健院': [
    p('广东省妇幼保健院番禺院区停车场', '就诊相关停车优惠以院方当日规则为准，普通临停收费未确认。', '进入医院后可先送家人到保健楼，再按院内指引停车；保健楼与门诊楼不同，进场后注意看楼宇指引。', '广东省妇幼保健院番禺院区停车场', [], { confidence: 'low' }),
    p('7号小镇创意园停车场', '6元/小时。', '距离医院步行约100米，可避开医院入口排队；先导航到7号小镇创意园，停车后穿过园区步行到医院。', '7号小镇创意园停车场', [rule('normal', 6, 'hour', '基础收费')])
  ],
  '广东省人民医院': [
    p('七橙酒店楼下停车场', '08:00-22:00为10元/小时；22:00-次日08:00为10元/次。', '导航海谊大厦一带进入；距离医院较近，但车场条件有限、车位和入口管理可能变化，进场前确认是否接待临时车辆。', '海谊大厦七橙酒店楼下停车场', [rule('normal', 10, 'hour', '日间收费', { time_start: '08:00', time_end: '22:00' }), rule('night', 10, 'time', '夜间单次收费', { time_start: '22:00', time_end: '08:00' })], { confidence: 'low' }),
    p('青龙里小区停车场', '10元/小时；是否有位由现场门卫安排。', '停车后步行到医院约3分钟；停车位有限，需确认小区是否接待临时车辆。', '广东省人民医院英东楼对面青龙里小区停车场', [rule('normal', 10, 'hour', '参考小时收费', { confidence: 'low' })], { confidence: 'low' })
  ],
  '广东省中医院': [
    p('广东省中医院大德路总院地下停车场', '收费未确认。', '院内地下车库车位较窄，入口可能排队；停车时注意轮胎与立柱距离，车身尽量摆正后再倒入车位。', '广东省中医院大德路总院地下停车场', [], { confidence: 'low' }),
    p('车海洋自助洗车入口露天停车场', '5元/小时，具体以现场收费为准。', '位于医院附近，导航车海洋自助洗车入口；与医院步行距离需现场确认，不把该点作为院内车位替代。', '车海洋自助洗车入口露天停车场', [rule('normal', 5, 'hour', '参考小时收费', { confidence: 'low' })], { confidence: 'low' })
  ],
  '广州市第一人民医院': [
    p('广州市第一人民医院院内停车场', '收费以院方当日公示为准；早到更容易找到车位。', '院内车位有限，工作日上午高峰后可能满位；进入前留意门岗和就诊车辆指引。', '广州市第一人民医院院内停车场', [], { confidence: 'low' }),
    p('金通泰停车场', '收费以现场公示为准。', '医院周边商业停车场备选，步行前往医院；老城区道路繁忙，建议提前规划进出路线。', '金通泰停车场', [], { confidence: 'low' })
  ],
  '广州市妇女儿童医疗中心（珠江新城院区）': [
    p('市妇幼停车场', '3小时内7.5元/小时，超过3小时15元/小时；24小时封顶67.5元。', '院内车位少，基本为机械车位；周边道路容易拥堵，进场可能排队，车宽或车高不确定时先确认车位类型。', '广州市妇女儿童医疗中心珠江新城院区停车场', [rule('first', 7.5, 'hour', '前3小时', { end_minute: 180 }), rule('normal', 15, 'hour', '超过3小时'), rule('cap', 67.5, 'day', '24小时封顶')], { daily_cap: 67.5 }),
    p('中山眼科停车场', '3小时内5元/小时；超过3小时10元/小时。', '距离妇女儿童医疗中心较近，但工作时间车位紧张、周边道路拥堵；停车后按人行路线前往医院。', '中山大学附属眼科医院珠江新城院区停车场', [rule('first', 5, 'hour', '前3小时', { end_minute: 180 }), rule('normal', 10, 'hour', '超过3小时')], { confidence: 'low' })
  ],
  '广州医科大学附属第一医院': [
    p('广州医科大学附属第一医院总院停车场', '收费以院方当日公示为准。', '总院位于沿江西路，周边停车资源紧张；到达后按门岗指引，避免把外部医院或其他城市的停车信息混入本院攻略。', '广州医科大学附属第一医院总院停车场', [], { confidence: 'low' })
  ],
  '大夫山森林公园': [
    p('大夫山森林公园南门停车场', '收费标准以现场公示为准；本轮笔记确认南门为主要自驾入口。', '导航大夫山森林公园南门；南门靠近聚秀湖路线，周末车位紧张，建议尽量早到。', '大夫山森林公园南门停车场', [], { confidence: 'low' }),
    p('大夫山森林公园北门停车场', '24小时封顶30元。', '北门适合从钟村方向进入；停车后按园区指引步行或租车，周末入场高峰提前规划。', '大夫山森林公园北门停车场', [rule('cap', 30, 'day', '24小时封顶')], { daily_cap: 30 })
  ],
  '二沙岛': [
    p('二沙岛体育公园停车场', '3小时内2.5元/30分钟，超过3小时5元/30分钟，45元/天封顶。', '停车后步行到宏城公园和二沙岛艺术公园较近；车位不多，工作日白天不要把受限时段的路边车位当作稳定方案。', '二沙岛体育公园停车场', [rule('first', 2.5, 'minute', '3小时内每30分钟', { end_minute: 180 }), rule('normal', 5, 'minute', '超过3小时每30分钟', { start_minute: 180 }), rule('cap', 45, 'day', '每日封顶')], { daily_cap: 45 }),
    p('文立方商场停车场', '10元/小时。', '距离二沙岛艺术公园步行约5分钟；商场车库作为较稳定的付费备选，入场后按商场指引出入。', '文立方商场停车场', [rule('normal', 10, 'hour', '基础收费')]),
    p('宏城公园停车场', '5元/小时。', '距离宏城公园步行约8分钟；周末和活动日车位可能变化，建议到场后确认是否开放。', '宏城公园停车场', [rule('normal', 5, 'hour', '基础收费', { confidence: 'low' })], { confidence: 'low' })
  ]
};

const aliases = {
  '广州图书馆': ['广州图书馆'], '海心沙': ['海心沙'], '海珠湖': ['海珠湖'], '华南植物园': ['华南植物园'], '黄埔军校': ['黄埔军校'],
  '莲花山': ['莲花山'], '南越王博物院': ['南越王博物院'], '沙湾古镇': ['沙湾古镇'], '永庆坊/荔枝湾': ['永庆坊'], '余荫山房': ['余荫山房'],
  '长隆旅游度假区': ['长隆'], '中山纪念堂': ['中山纪念堂'], '广东省妇幼保健院': ['广东省妇幼保健院'], '广东省人民医院': ['广东省人民医院'],
  '广东省中医院': ['广东省中医院'], '广州市第一人民医院': ['广州市第一人民医院'], '广州市妇女儿童医疗中心（珠江新城院区）': ['广州市妇女儿童医疗中心'],
  '广州医科大学附属第一医院': ['广州医科大学附属第一医院'], '大夫山森林公园': ['大夫山森林公园'], '二沙岛': ['二沙岛']
};

const normalize = s => String(s || '').replace(/[（）()\s·、，,。/\\-]/g, '').toLowerCase();
function legacyPlace(canonical) {
  const candidates = aliases[canonical] || [canonical];
  return legacy.places.find(row => candidates.some(alias => {
    const a = normalize(alias), b = normalize(row.name);
    return a === b || a.includes(b) || b.includes(a);
  }));
}
function minPriceHour(rules) {
  const prices = (rules || []).filter(r => ['first', 'normal'].includes(r.rule_type) && Number(r.price) > 0).map(r => r.unit === 'minute' ? Number(r.price) * 60 / (Number(r.unit_minutes) || 30) : r.unit === 'hour' ? Number(r.price) : null).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}
function displayPrice(rows) {
  const prices = rows.map(row => row.min_price_hour).filter(Number.isFinite).sort((a, b) => a - b);
  if (!prices.length) return '价格待补充';
  const fmt = n => Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
  return prices.every(x => x === prices[0]) ? `¥${fmt(prices[0])}/h` : `¥${fmt(prices[0])}/h起`;
}

const places = [];
const audit = [];
for (const [canonical, rows] of Object.entries(defs)) {
  const base = legacyPlace(canonical);
  if (!base) throw new Error(`找不到旧地点元数据：${canonical}`);
  const parkings = rows.map(row => ({ ...row, min_price_hour: minPriceHour(row.fee_rules) }));
  const priced = parkings.map(row => row.min_price_hour).filter(Number.isFinite);
  const areaTips = {
    '广州图书馆': '广州图书馆周边停车收费和车位限制差异明显，机械车位需确认车辆尺寸；花城汇P13可作为海心沙方向的外围备选。',
    '海心沙': '海心沙核心区域活动日车位和道路管控变化明显，海心沙亚运公园距离广州塔步行约8至10分钟，外围车库适合做兜底。',
    '海珠湖': '海珠湖公园停车位有限，周末建议早到；坚真花园和东风经济联合社工会联合会停车场距离约0.77公里，可作为外围备选。',
    '华南植物园': '正门停车场靠近地铁和园区入口但周末较早满位，西门车位相对宽松，入园前按现场指引选择入口。',
    '黄埔军校': '黄埔军校和长洲岛景点分散，停车后以步行和接驳为主；节假日先确认道路管控及停车场开放状态。',
    '莲花山': '莲花山旅游区有多个停车点，西门距离核心游览区较近；节假日入口道路可能排队，进场后按园区指引分流。',
    '南越王博物院': '王墓展区位于老城区，停车选择少；越秀公园东北门停车场可作为同时游览越秀公园的外围方案，但步行距离较长。',
    '沙湾古镇': '沙湾古镇周末人流集中，西门和南门停车场均需留意入口排队及当日收费口径，建议错峰或提前到达。',
    '永庆坊/荔枝湾': '老城区道路狭窄、周末易堵，金声停车场和荔湾路125号停车场适合导航直达；住宅停车位需现场确认开放状态。',
    '余荫山房': '余荫山房停车场就在景区门口，收费存在分时或封顶差异，周末建议早点到并以入口公示为准。',
    '长隆旅游度假区': '长隆自驾停车以园区P5等官方车场为主，旺季上午车位紧张；满位时按指引改停其他车场并乘免费摆渡车。',
    '中山纪念堂': '中山纪念堂周边停车资源紧张，交易广场步行距离较短但收费可能调整；优先确认地下车库入口和现场公示。',
    '广东省妇幼保健院': '医院入口高峰容易排队，可先送人再停车；7号小镇创意园距离较近，但医院就诊优惠和普通临停收费需分别确认。',
    '广东省人民医院': '省人民医院周边车位紧张，七橙酒店和青龙里小区均需确认临时车辆是否接待；就诊高峰建议提前到达。',
    '广东省中医院': '大德路总院院内车库较窄且可能排队，外围车场需核对步行距离和当日收费；不建议把未划线路边位置当作稳定方案。',
    '广州市第一人民医院': '医院周边老城区道路繁忙，院内车位和商业备选均需按现场指引；工作日上午尽量提前到达。',
    '广州市妇女儿童医疗中心（珠江新城院区）': '院内机械车位少且周边道路拥堵，市妇幼车场与中山眼科车场收费和步行便利度不同，车辆尺寸需提前确认。',
    '广州医科大学附属第一医院': '总院位于沿江西路，周边停车资源紧张；入场时按总院门岗指引，避免使用其他城市或其他院区的停车信息。',
    '大夫山森林公园': '大夫山南北门均有停车选择，周末南门和北门入口车位变化明显；根据游览路线选择入口并尽量早到。',
    '二沙岛': '二沙岛停车位有限，体育公园车场距离景点较近但容量有限；文立方和宏城公园可作付费备选，活动日先确认开放情况。'
  }[canonical];
  places.push({
    id: base.id, name: base.name, category: base.category || (canonical.includes('医院') ? '医院' : '景点'), city_code: '440100', address: base.address,
    district: base.district || (canonical === '南越王博物院' ? '越秀区' : ''), summary: base.summary || `${base.name}周边停车信息整理。`, area_tips: areaTips, tags: base.tags || [],
    lng: Number(base.lng), lat: Number(base.lat), coordinate_status: '待核验', navigation_available: false,
    coordinate_source: '待地图POI复核', coordinate_verified_at: null, parkings,
    min_price: priced.length ? Math.min(...priced) : null, min_price_display: displayPrice(parkings)
  });
  const related = candidates.places.find(row => (aliases[canonical] || [canonical]).some(alias => normalize(row.place).includes(normalize(alias)) || normalize(alias).includes(normalize(row.place))));
  audit.push({ place: canonical, selected_parkings: rows.map(row => row.name), raw_note_count: related?.notes.length || 0, raw_files: (related?.notes || []).map(note => note.raw_file), excluded_reason: '未采用与目标地点串台、只有提问或无法确认具体停车点的内容' });
}

fs.writeFileSync(outputPath, JSON.stringify({ places }, null, 2), 'utf8');
fs.writeFileSync(auditPath, JSON.stringify({ generated_at: new Date().toISOString(), source: 'server/xhs-raw/p0-*', places: audit }, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, audit: auditPath, places: places.length, parkings: places.reduce((n, row) => n + row.parkings.length, 0), fee_rules: places.flatMap(row => row.parkings).reduce((n, row) => n + row.fee_rules.length, 0), priced_parkings: places.flatMap(row => row.parkings).filter(row => Number.isFinite(row.min_price_hour)).length }, null, 2));
