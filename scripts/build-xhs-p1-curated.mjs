import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.resolve(process.env.XHS_P1_CANDIDATE_PATH || 'server/xhs-p1-candidates-20260914.json');
const capturePath = path.resolve(process.env.XHS_P1_CAPTURE_PATH || 'server/xhs-captures-p1-31-direct-relevance-combined-20260914.json');
const outputPath = path.resolve(process.env.XHS_P1_OUTPUT_PATH || 'server/xhs-p1-curated-import-20260914.json');
const auditPath = path.resolve(process.env.XHS_P1_AUDIT_PATH || 'server/xhs-p1-curated-audit-20260914.json');
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
const byPlace = new Map((source.places || []).map(row => [row.place, row]));

const nulls = () => ({
  lng: null, lat: null, coordinate_status: '待补充', navigation_available: false,
  coordinate_source: null, coordinate_poi_name: null, coordinate_poi_id: null,
  coordinate_address: null, coordinate_verified_at: null, entrance_verified: false
});

function rule(rule_type, price, unit, description, extra = {}) {
  return {
    rule_type, price, unit,
    unit_minutes: ['minute'].includes(unit) ? (extra.unit_minutes || 30) : null,
    start_minute: null, end_minute: null, time_start: null, time_end: null,
    description, confidence: extra.confidence || 'medium', priority: rule_type === 'cap' ? 100 : 50,
    ...extra
  };
}

const hour = (price, description, extra = {}) => rule('normal', price, 'hour', description, extra);
const minute = (price, minutes, description, extra = {}) => rule('normal', price, 'minute', description, { unit_minutes: minutes, ...extra });
const day = (price, description, extra = {}) => rule('cap', price, 'day', description, extra);
const month = (price, description, extra = {}) => rule('normal', price, 'month', description, extra);
const time = (price, description, extra = {}) => rule('normal', price, 'time', description, extra);
const free = (description, minutes = null, extra = {}) => rule('free', 0, minutes ? 'minute' : 'hour', description, minutes ? { unit_minutes: minutes, ...extra } : extra);

function sourceRecords(placeName, needles) {
  const row = byPlace.get(placeName);
  const notes = row?.notes || [];
  const selected = needles.map(needle => notes.find(note => {
    const haystack = `${note.title || ''} ${note.body || ''}`;
    return haystack.includes(needle);
  })).filter(Boolean);
  return selected.map(note => ({
    source_type: 'xiaohongshu', source_url: note.url || null, source_title: note.title || null,
    source_author: note.author || null, source_published_at: note.published_at || null,
    rank: note.rank || null, evidence_type: '正文', raw_file: note.raw_file || null
  }));
}

function parking(placeName, name, fee_detail, guide_text, location, fee_rules, needles, extra = {}) {
  return {
    name, fee_detail, guide_text, location, address: extra.address || location,
    type: extra.type || '停车场', total_spots: extra.total_spots ?? null,
    ...nulls(), fee_rules, daily_cap: extra.daily_cap ?? null, night_flat: extra.night_flat ?? null,
    open_hours: extra.open_hours || null, payment: [], min_price_hour: null,
    confidence: extra.confidence || 'medium', conflict_flag: Boolean(extra.conflict_flag),
    source_records: sourceRecords(placeName, needles), source: '编辑整理', verified_at: null,
    ...extra
  };
}

const defs = {
  '十三行博物馆': {
    category: '景点', address: '广州市荔湾区西堤二马路37号', district: '荔湾区',
    summary: '广州十三行博物馆位于珠江沿岸老城区，适合结合十三行片区步行游览。',
    area_tips: '老城区道路较窄，领展广场地下停车场距目标约1.2公里，适合停车后步行；荔湾路125号停车场有车位多、价格低的反馈但收费口径不完整，入场前应看现场公示。',
    parkings: [
      parking('十三行博物馆', '荔湾路125号停车场', '收费信息未完整记录，按现场公示结算。', '停车场车位较多，停车后再步行或换乘前往博物馆；入口和当前开放状态建议到场确认。', '荔湾路125号停车场', [], ['十三行周边停车场荔湾路125号停车场'], { confidence: 'low' }),
      parking('十三行博物馆', '领展广场地下停车场', '6元/30分钟；已记录一次停留6小时实付36元，实付金额不作为标准费率，优惠和当日计费以现场为准。', '导航领展广场地下停车场，从P7方向进出；停车后步行约1.2公里到博物馆，片区道路较窄且人流多，高峰期可能拥堵。', '广州荔湾领展广场地下停车场', [minute(6, 30, '基础收费：6元/30分钟')], ['广州十三行🛍️自驾停车攻略'])
    ]
  },
  '黄埔古港': {
    category: '景点', address: '广州市海珠区新港东路石基村黄埔古港', district: '海珠区',
    summary: '黄埔古港保留古村、码头和海丝文化遗迹，片区适合步行游览。',
    area_tips: '黄埔古港周边以露天或地面车位为主，长期车位和临停价格差异较大；珠投一横路停车场距古港和黄埔村较近，渔民新村及核心区地面车位可作长期停车备选，临停前都应核对入口和当日余位。',
    parkings: [
      parking('黄埔古港', '珠投一横路停车场', '2元/30分钟；24小时封顶30元；月租450元/月。', '可导航珠投一横路停车场，步行可到黄埔村、黄埔古港和周边创意园；靠近新化快速及新洲出口，适合游客和长期停车。', '珠投一横路停车场', [minute(2, 30, '临停收费：2元/30分钟'), day(30, '24小时封顶30元'), month(450, '月租450元/月')], ['【黄埔村】琶洲会展、黄埔古港旁的宝藏停车场']),
      parking('黄埔古港', '新化北路旁停车场', '5元/小时；月保300元/月，名额和办理条件以管理方为准。', '位于新化北路边，靠近黄埔古港和新化快速入口；地面进出方便，车位先到先得，长期停车需提前确认。', '新化北路旁停车场', [hour(5, '临停收费：5元/小时'), month(300, '月保300元/月')], ['🅿️ 黄埔古港旁挖到“停车自由”神位！'], { confidence: 'low' }),
      parking('黄埔古港', '渔民新村地面停车场', '全天月卡230元/月，随进随出；需提前办理，临停收费未完整记录。', '地面车位，适合周末或长期停放；办理通常需要提前准备，临停车辆到场前确认是否接待。', '海珠区渔民新村地面停车场', [month(230, '全天月卡230元/月')], ['广州黄埔古港地铁附近地面停车场月付230'], { confidence: 'low' }),
      parking('黄埔古港', '黄埔古港核心区旁固定地面车位', '月租400元/月；老租客或季度方案350元级别，具体办理条件以管理方为准。', '靠近古港码头和美食街，固定地面车位即停即走，步行可到景区；车位数量有限，长期需求建议先确认余位。', '黄埔古港核心区旁固定地面车位', [month(400, '月租400元/月', { confidence: 'low' })], ['黄埔古港·地面车位直租'], { confidence: 'low' })
    ]
  },
  '太古仓': {
    category: '景点', address: '广州市海珠区革新路124号', district: '海珠区',
    summary: '太古仓是珠江沿岸的历史码头和文旅街区，夜间及周末客流较集中。',
    area_tips: '太古仓周末傍晚进场车流集中，沙渡路一带可能排队；太古仓停车场消费后可向商户登记车牌申请免停时长，基础收费需现场确认，长期停车可另行咨询室内车库。',
    parkings: [
      parking('太古仓', '太古仓停车场', '到场基础收费未完整记录；在场内消费可向商户登记车牌，享有4小时免停的反馈，适用条件以现场为准。', '导航太古仓电影库或太古仓停车场；周末傍晚沙渡路可能拥堵并排队进场，车位可能未满但入口放行较慢，建议错峰。', '太古仓停车场', [free('场内消费登记车牌后4小时免停', 240, { confidence: 'low' })], ['🅿️关于太古仓停车，想说两句'], { confidence: 'low' }),
      parking('太古仓', '太古仓电影库门前停车位', '收费信息未完整记录，按现场公示结算。', '可导航太古仓电影库，门前一带有停车位；周末及晚餐时段车位和道路通行情况变化较大，优先服从现场管理。', '太古仓电影库门前停车位', [], ['【广州太古仓码头】详细攻略（自驾）'], { confidence: 'low' })
    ]
  },
  '东山口': {
    category: '商圈', address: '广州市越秀区东山口片区', district: '越秀区',
    summary: '东山口是老城区街区与历史建筑集中的步行游览片区，街巷较窄。',
    area_tips: '东山口道路窄、单行线多且人流密集，周末午后车位更紧张；金城宾馆和锦轩现代城位置较近，德心轩价格相对低但车位及收费存在差异，一方东山和启明社区车位少，建议错峰并准备备选。',
    parkings: [
      parking('东山口', '金城宾馆停车场', '16元/小时；22:00-次日08:00为20元/次；24小时封顶128元。', '导航越秀区东华北路168号金城宾馆，停车后步行约3分钟到庙前直街；位置较近，周末好天气时仍可能满位。', '越秀区东华北路168号金城宾馆停车场', [hour(16, '基础收费：16元/小时'), time(20, '22:00-次日08:00单次收费', { time_start: '22:00', time_end: '08:00' }), day(128, '24小时封顶128元')], ['低至6元/h！东山口附近5个停车场攻略']),
      parking('东山口', '锦轩现代城停车场', '12元/小时。', '位于农林下路4-6号、东山口地铁站上盖，位置较好找；停车后可通过地下通道前往东山口街区，适合停留2至4小时。', '农林下路4-6号锦轩现代城停车场', [hour(12, '基础收费：12元/小时')], ['低至6元/h！东山口附近5个停车场攻略']),
      parking('东山口', '德心轩地下停车场', '8元/小时；存在12小时封顶24元与48元封顶的不同收费反馈，入口和当日封顶规则以现场公示为准。', '位于越秀区庙前西街15-17号一带，车库较小、车位紧凑，入口可能标注不对外；周末午后车位更紧张，进场前确认是否接待临时车辆。', '越秀区庙前西街15-17号德心轩地下停车场', [hour(8, '基础收费：8元/小时'), day(24, '12小时封顶24元', { confidence: 'low' }), day(48, '封顶48元', { confidence: 'low' })], ['🔥东山口停车刺客退！亲测8元/h宝藏停车场', '广州东山口停车攻略', '广州东山口停车的两个地方可以参考下'], { conflict_flag: true, confidence: 'medium' }),
      parking('东山口', '一方东山停车场', '4元/15分钟；另有16元/小时的收费反馈，近期收费可能存在差异，现场以入口公示为准。', '位于越秀区庙前西街48号创意园内，露天车位约50个；距离东山口核心街区近，但周末车位紧张，可能需要等位。', '越秀区庙前西街48号一方东山停车场', [minute(4, 15, '基础收费：4元/15分钟'), hour(16, '另一收费口径：16元/小时', { confidence: 'low' })], ['低至6元/h！东山口附近5个停车场攻略', '东山口停车攻略'], { total_spots: 50, conflict_flag: true }),
      parking('东山口', '启明社区地上停车场', '3元/30分钟；车位约30个，数量有限。', '位于启明大马路与庙前西街交叉口社区内，步行到东山口核心街区约5分钟；车位少且车位较窄，新手进场前应确认是否有临时车位。', '越秀区启明大马路与庙前西街交叉口启明社区地上停车场', [minute(3, 30, '基础收费：3元/30分钟')], ['低至6元/h！东山口附近5个停车场攻略', '广州东山口停车的两个地方可以参考下'], { total_spots: 30 })
    ]
  },
  '南沙天后宫': {
    category: '景点', address: '广州市南沙区天后路88号', district: '南沙区',
    summary: '南沙天后宫位于南沙滨海景区，周末和活动期间游客集中。',
    area_tips: '天后宫不同入口和外围车场的步行距离、开放状态与收费差异明显；官方停车区域更靠近景区，但部分停车区曾处于修缮或临时调整状态，外围车场需确认入口和总价，避免被非正式引导带入高价车场。',
    parkings: [
      parking('南沙天后宫', '天后宫西北门停车场', '30分钟内免费；10元/次（5小时）为活动期间记录，当前开放和收费以入口公示为准。', '西北门有景区大门外和大门内两处停车区域，外侧车位较少，内侧车位相对多但需尽早到达；停车后步行到天后宫主入口。', '天后宫西北门停车场', [free('30分钟内免费'), time(10, '5小时内单次收费', { confidence: 'low' })], ['广州南沙天后宫自驾祈福超详细攻略（一）', '南沙天后宫沙滩停车&省钱遛娃攻略✨', '南沙天后宫停车攻略'], { confidence: 'low' }),
      parking('南沙天后宫', '广州市公交站北面停车场', '30分钟内免费；10元/次（5小时）。', '适合前往蒲州花园和天后宫沙滩，停车后步行约15分钟；带儿童或推车建议预留步行时间，入场前确认是否仍对外开放。', '广州市公交站北面停车场', [free('30分钟内免费'), time(10, '5小时内单次收费')], ['南沙天后宫沙滩停车&省钱遛娃攻略✨']),
      parking('南沙天后宫', '天后宫外围停车场', '25元/次；另有20元/2小时、超出后10元/小时的收费口径，场地与时段可能不同，现场确认后再入场。', '位于景区入口外围，部分车场距离入口约200米，外围车场步行可能超过10分钟；不要仅凭现场人员指引入场，先核对停车场名称和收费牌。', '南沙天后宫景区入口外围停车场', [time(25, '外围停车场单次收费', { confidence: 'low' }), hour(20, '2小时收费口径', { confidence: 'low' }), hour(10, '超过2小时收费口径', { confidence: 'low' })], ['南沙天后宫停车攻略', '南沙天后宫停车'], { conflict_flag: true, confidence: 'low' })
    ]
  },
  '白水寨': {
    category: '景点', address: '广州市增城区派潭镇白水寨大道', district: '增城区',
    summary: '白水寨是增城北部的山地景区，景区入口与停车区域存在步行距离差异。',
    area_tips: '白水寨青年营地停车场距景区大门约80米，路线相对直接；景区内停车也有单次收费记录，但当前收费标准可能已调整，建议到场分别确认入口开放和收费牌。',
    parkings: [
      parking('白水寨', '白水寨青年营地停车场', '收费信息未完整记录，按现场公示结算。', '导航白水寨青年营地，停车后步行约80米到白水寨景区大门；路线有分流，导航接近景区时留意现场指引。', '白水寨青年营地停车场', [], ['五一劳动节广州增城白水寨景区停车攻略'], { confidence: 'low' }),
      parking('白水寨', '白水寨景区内停车场', '10元/次；收费标准可能调整，当前以现场公示为准。', '可在景区入口确认是否允许车辆进入；车多人多时可能无位，新能源车辆充电位存在被占用的情况，进场前确认可用车位。', '白水寨景区内停车场', [time(10, '单次收费', { confidence: 'low' })], ['自驾白水寨一日游', '番禺沙湾宝墨园充电停车攻略'], { confidence: 'low' })
    ]
  },
  '流溪河国家森林公园': {
    category: '景点', address: '广州市从化区良口镇流溪河林场', district: '从化区',
    summary: '流溪河国家森林公园以湖泊、山林和森林步道为主要游览内容，景区范围较大。',
    area_tips: '流溪河国家森林公园停车点分布在山门、园内和山顶路线，停车后可步行或继续驾车上山；园内停车收费存在不同记录，长距离山路和陡楼梯不适合行动不便人群，入场先确认当天停车规则。',
    parkings: [
      parking('流溪河国家森林公园', '流溪河国家森林公园入口停车场', '有园内免费停车记录；另有10元/次的停车费记录，当前以山门和停车场公示为准。', '位于山门进入后的左侧，适合停车后步行或前往湖边；景区范围大，前往山顶前确认道路和停车点开放情况。', '流溪河国家森林公园山门入口停车场', [free('园内停车免费', null, { confidence: 'low' }), time(10, '单次收费口径', { confidence: 'low' })], ['广州流溪河森林公园自驾游攻略（一）', '广州自驾游｜从化流溪河森林公园'], { conflict_flag: true, confidence: 'low' }),
      parking('流溪河国家森林公园', '流溪河森林公园山顶停车点', '收费信息未完整记录，按现场公示结算。', '可继续驾车沿园内道路前往山顶路线，停车后按景区步道游览；山路和长台阶较多，老人及低龄儿童应评估体力。', '流溪河国家森林公园山顶停车点', [], ['广州流溪河森林公园自驾游攻略（一）'], { confidence: 'low' })
    ]
  },
  '宝墨园': {
    category: '景点', address: '广州市番禺区沙湾镇紫坭村大桥头', district: '番禺区',
    summary: '宝墨园是番禺沙湾片区的岭南园林景区，适合亲子和家庭游览。',
    area_tips: '宝墨园正门停车场距离检票口近且车位较多，但周末和花期可能满位；南粤苑方向有备用停车空地，步行约8分钟，新能源充电车位需以现场可用情况为准。',
    parkings: [
      parking('宝墨园', '宝墨园正门停车场', '10元/次。', '导航宝墨园正门，停车后过马路即可到检票处；从景区牌坊方向进入还会经过较长一段停车区域，建议以正门为目的地。', '宝墨园正门停车场', [time(10, '单次收费')], ['宝墨园避坑帖⚠️含停车🅿️捞鱼🐟餐饮攻略❗️']),
      parking('宝墨园', '南粤苑方向停车空地', '收费信息未完整记录，按现场公示结算。', '从宝墨园方向继续前行，停车后步行约8分钟；花期和周末车流大，新能源充电位可能被燃油车占用，进场前确认可用车位。', '宝墨园南粤苑方向停车空地', [], ['番禺沙湾宝墨园充电停车攻略'], { confidence: 'low' })
    ]
  },
  '广州美术馆': {
    category: '景点', address: '广州市海珠区艺苑路198号', district: '海珠区',
    summary: '广州美术馆（广州艺术博物院）位于海珠区艺苑路，周边为广州塔和商圈。',
    area_tips: '广州美术馆官方停车场从东2门进入，位置最近且有封顶价；四季天地和TIT创意园可作为周边备选，但步行距离、遮阳和收费不同，周末建议提前到达并按现场入口指引。',
    parkings: [
      parking('广州美术馆', '广州艺术博物院东2门停车场', '5元/小时；45元封顶。', '社会车辆认准东2门进入，东1门不对外；目前以地面停车区域为主，地下区域是否开放以现场指引为准，周末上午或中午前车位更宽裕。', '广州艺术博物院东2门停车场', [hour(5, '基础收费：5元/小时'), day(45, '封顶45元')], ['广州艺术博物院停车攻略（2026）']),
      parking('广州美术馆', '明心路停车场', '收费信息未完整记录，按现场公示结算。', '明心路停车场距离白鹅潭艺术中心较近，步行距离短且遮阳条件相对好；到场后确认停车场入口和当日收费。', '明心路停车场', [], ['白鹅潭美术馆停车踩坑了'], { confidence: 'low' }),
      parking('广州美术馆', '四季天地停车场', '12元/小时；80元封顶；另有8至10元/小时的收费反馈，现场以当日公示为准。', '导航四季天地，北门入口道路相对宽，地面车位满后可按指引前往室内楼层；过马路步行约1分钟到美术馆。', '四季天地停车场', [hour(12, '基础收费：12元/小时'), day(80, '封顶80元'), hour(8, '另一收费口径：8至10元/小时', { confidence: 'low' })], ['广州艺术博物院停车攻略（2026）', '广州美术馆（广州艺术博物院）停车攻略'], { conflict_flag: true }),
      parking('广州美术馆', 'TIT创意园停车场', '16元/小时；128元封顶。', '作为广州美术馆周边备选停车场，停车后步行前往场馆；活动或展览高峰期先确认余位和步行路线。', 'TIT创意园停车场', [hour(16, '基础收费：16元/小时'), day(128, '封顶128元')], ['广州艺术博物院停车攻略（2026）'])
    ]
  },
  '广州大剧院': {
    category: '景点', address: '广州市天河区珠江西路1号', district: '天河区',
    summary: '广州大剧院位于珠江新城文化场馆集中区域，演出前后车流会明显增加。',
    area_tips: '广州大剧院可从花城汇地下停车场P13进入，E20电梯或楼梯方向更方便到达剧院；演出前提前到场更容易找到车位，剧院本身没有独立停车码，具体收费按车场当日公示。',
    parkings: [
      parking('广州大剧院', '花城汇地下停车场P13', '基础收费信息未完整记录，按现场公示结算。', '导航花城汇地下停车场P13，停车后寻找大剧院方向的电梯或楼梯，E20电梯到花城汇南区18号出口，出地面后沿斜坡步行到剧院；演出前建议提前到场。', '花城汇地下停车场P13', [], ['MDGZ 阿信公仔🥕 广州大剧院自驾停车攻略', '停车记录｜广州大剧院'], { confidence: 'low' })
    ]
  },
  '星海音乐厅': {
    category: '景点', address: '广州市越秀区二沙岛晴波路33号', district: '越秀区',
    summary: '星海音乐厅位于二沙岛文化场馆片区，演出时段停车需求集中。',
    area_tips: '星海音乐厅演出日优先考虑带当日门票的地下停车场，但车位有限且只在演出前后开放；外围文立方、亚洲羽毛球馆、新创举中心和二沙岛体育公园可作备选，路边限时区域必须按现场标线和时段停放。',
    parkings: [
      parking('星海音乐厅', '星海音乐厅地下停车场', '持当日音乐会门票可免费停车；车位有限，适用时段为演出前2小时开放、演出结束后1小时关闭，具体以现场为准。', '演出日优先导航星海音乐厅地下停车场，需尽早到达；离场时间受演出结束后开放时段限制，结束后应尽快驶离。', '星海音乐厅地下停车场', [free('持当日音乐会门票免费停车', null, { confidence: 'medium' })], ['星海音乐厅看演出停车指南，速收藏！']),
      parking('星海音乐厅', '文立方广场停车场', '08:00-22:00 16元/小时；22:00-次日08:00 10元/次。', '二沙岛商场车库备选，适合音乐厅车位不足时使用；停车后步行前往音乐厅，演出散场时预留步行和出场时间。', '文立方广场停车场', [hour(16, '08:00-22:00收费：16元/小时', { time_start: '08:00', time_end: '22:00' }), time(10, '22:00-次日08:00单次收费', { time_start: '22:00', time_end: '08:00' })], ['星海音乐厅看演出停车指南，速收藏！']),
      parking('星海音乐厅', '亚洲羽毛球馆停车场', '08:00-19:00 10元/小时；19:00-次日08:00 10元/次。', '音乐厅周边付费备选，适合核心车场满位时使用；晚间按单次口径结算，入场前确认步行路线和开放状态。', '亚洲羽毛球馆停车场', [hour(10, '08:00-19:00收费：10元/小时', { time_start: '08:00', time_end: '19:00' }), time(10, '19:00-次日08:00单次收费', { time_start: '19:00', time_end: '08:00' })], ['星海音乐厅看演出停车指南，速收藏！']),
      parking('星海音乐厅', '新创举中心停车场', '08:00-22:00 16元/小时；22:00-次日08:00 10元/次。', '二沙岛周边付费备选，进场后按车库指引停车；晚间演出散场时确认出口是否拥堵。', '新创举中心停车场', [hour(16, '08:00-22:00收费：16元/小时', { time_start: '08:00', time_end: '22:00' }), time(10, '22:00-次日08:00单次收费', { time_start: '22:00', time_end: '08:00' })], ['星海音乐厅看演出停车指南，速收藏！']),
      parking('星海音乐厅', '二沙岛体育公园停车场', '07:30-21:30：3小时内2.5元/30分钟，超过3小时5元/30分钟；21:30-次日07:30 1元/30分钟；夜间最高10元，24小时最高45元。', '车场距离二沙岛场馆和公园较近，但容量有限；活动和周末时段建议提前到场，按入口和现场分流指引停车。', '二沙岛体育公园停车场', [minute(2.5, 30, '07:30-21:30前3小时收费', { time_start: '07:30', time_end: '21:30' }), minute(5, 30, '07:30-21:30超过3小时收费', { time_start: '07:30', time_end: '21:30' }), minute(1, 30, '21:30-次日07:30收费', { time_start: '21:30', time_end: '07:30' }), day(10, '夜间最高10元'), day(45, '24小时最高45元')], ['星海音乐厅看演出停车指南，速收藏！'])
    ]
  },
  '广东科学中心': {
    category: '景点', address: '广州市番禺区大学城西六路168号', district: '番禺区',
    summary: '广东科学中心位于广州大学城，适合亲子和科普主题游览。',
    area_tips: '广东科学中心停车费曾发生调整，现有抓取内容未形成完整的当前收费表；周末和节假日可能出现绕行及长时间等位，建议尽量提前到达并以入口公示为准。',
    parkings: [
      parking('广东科学中心', '广东科学中心停车场', '最新收费标准未完整记录，按现场公示结算；过往存在4.5元/天的旧收费记录，不作为当前标准。', '车流高峰时可能绕行较久仍无法进场，周末和节假日建议提前到达；入场后按工作人员指引选择可用车位。', '广东科学中心停车场', [], ['广东科学中心停车费不再是4.5元停一天了🥹', '5.2广东科学中心停车难🅿️'], { confidence: 'low' })
    ]
  },
  '广州文化馆': {
    category: '景点', address: '广州市海珠区新滘中路288号', district: '海珠区',
    summary: '广州文化馆位于海珠区新滘中路，馆区与海珠湖相邻。',
    area_tips: '广州文化馆停车服务和外围临时停车场的开放、收费口径不同；馆内负一层停车场按公告时段开放，外侧新滘中路36号一带曾有5至8元/小时的不同反馈且可能临时调整，入场前确认当前入口和收费牌。',
    parkings: [
      parking('广州文化馆', '广州市文化馆负一层停车场', '每日07:30-21:30对外提供计时收费；具体价格以现场公示和当日管理要求为准。', '从文化馆出入口按指引进出，车辆停放后需按预约和安检要求进入馆区；开放时段以馆方现场公告为准。', '广州市文化馆负一层停车场', [], ['广州市文化馆对外提供收费停车服务的通知'], { open_hours: '07:30-21:30', confidence: 'medium' }),
      parking('广州文化馆', '新滘中路36号文化馆外侧停车场', '5元/小时；另有8元/小时的收费反馈，停车场可能临时调整或缩减，当前以现场公示为准。', '位于新滘中路36号、文化馆和海珠湖之间一带，入口有时不明显，停车后步行约5分钟到文化馆；外围道路施工或围挡变化时应按现场指引绕行。', '新滘中路36号文化馆外侧停车场', [hour(5, '基础收费口径：5元/小时', { confidence: 'low' }), hour(8, '另一收费口径：8元/小时', { confidence: 'low' })], ['广州文化馆停车', '2024广州文化馆新馆停车场', '广州市文化馆……停车攻略', '停车避雷广州市文化馆和海珠公园'], { conflict_flag: true, confidence: 'low' })
    ]
  }
};

function minPriceHour(rules) {
  const values = (rules || []).filter(row => ['first', 'normal'].includes(row.rule_type) && Number(row.price) > 0).map(row => {
    if (row.unit === 'hour') return Number(row.price);
    if (row.unit === 'minute') return Number(row.price) * 60 / Number(row.unit_minutes || 30);
    return null;
  }).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function priceDisplay(rows) {
  const values = rows.map(row => row.min_price_hour).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return '价格待补充';
  const fmt = value => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return values.every(value => value === values[0]) ? `¥${fmt(values[0])}/h` : `¥${fmt(values[0])}/h起`;
}

function placeRow(name, definition) {
  const parkings = definition.parkings.map(row => ({ ...row, min_price_hour: minPriceHour(row.fee_rules) }));
  const priced = parkings.map(row => row.min_price_hour).filter(Number.isFinite);
  return {
    name, category: definition.category, city_code: '440100', address: definition.address,
    district: definition.district, summary: definition.summary, area_tips: definition.area_tips,
    tags: ['自驾', '停车攻略'], ...nulls(), parkings,
    min_price: priced.length ? Math.min(...priced) : null,
    min_price_display: priceDisplay(parkings), heat: 50
  };
}

const included = Object.entries(defs).map(([name, definition]) => placeRow(name, definition));
const allCaptured = [...new Set((capture || []).map(row => row.target_place).filter(Boolean))];
const excluded = allCaptured.filter(name => !defs[name]).map(name => ({
  place: name, reason: '原始搜索页或详情页没有形成可落到具体停车点的有效停车事实，本轮不凑建泛称车场。',
  raw_files: (byPlace.get(name)?.notes || []).map(note => note.raw_file).filter(Boolean)
}));
const audit = {
  generated_at: new Date().toISOString(), input: path.relative(root, inputPath).replaceAll('\\', '/'), capture: path.relative(root, capturePath).replaceAll('\\', '/'),
  captured_places: allCaptured.length, included_places: included.length,
  excluded_places: excluded.length, included_parkings: included.reduce((n, row) => n + row.parkings.length, 0),
  included_fee_rules: included.flatMap(row => row.parkings).reduce((n, row) => n + row.fee_rules.length, 0),
  pending_place_coordinates: included.length,
  pending_parking_coordinates: included.reduce((n, row) => n + row.parkings.length, 0),
  conflict_parkings: included.flatMap(row => row.parkings).filter(row => row.conflict_flag).length,
  excluded
};

fs.writeFileSync(outputPath, JSON.stringify({ places: included }, null, 2), 'utf8');
fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, audit: auditPath, ...audit }, null, 2));
