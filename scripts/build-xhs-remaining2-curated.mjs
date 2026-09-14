import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const candidatePath = path.join(root, 'server', 'xhs-p0-remaining2-candidates-20260914.json');
const legacyPath = path.join(root, 'parking-miniapp', 'cloudfunctions', 'parking', 'data.json');
const outputPath = path.join(root, 'server', 'xhs-p0-remaining2-curated-import-20260914.json');
const candidates = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
const byPlace = new Map(candidates.places.map(p => [p.place, p]));
const forbidden = /小红书|笔记|评论区|评论中|原文|作者回复|薯友|博主|帖子|扒数据/;

function noteFor(place, needle) {
  const notes = byPlace.get(place)?.notes || [];
  return notes.find(n => String(n.title || '').includes(needle)) || notes.find(n => String(n.body || '').includes(needle)) || null;
}

function sources(place, needles) {
  return needles.map(needle => noteFor(place, needle)).filter(Boolean).map(n => ({
    source_type: 'raw_capture', source_title: n.title, source_url: n.url || null,
    published_at: n.published_at || null, rank: n.rank || null, raw_file: n.raw_file
  }));
}

function rule(rule_type, price, unit, description, extra = {}) {
  return { rule_type, start_minute: null, end_minute: null, time_start: null, time_end: null,
    price, unit, unit_minutes: unit === 'minute' ? 30 : 60, description, confidence: 'low', priority: rule_type === 'cap' ? 100 : 50, ...extra };
}
const hour = (price, description) => rule('normal', price, 'hour', description);
const half = (price, description) => rule('normal', price, 'minute', description, { unit_minutes: 30 });
const duration = (price, minutes, description) => rule('normal', price, 'minute', description, { unit_minutes: minutes });
const day = (price, description) => rule('normal', price, 'day', description, { unit_minutes: 1440 });
const month = (price, description) => rule('normal', price, 'month', description, { unit_minutes: null });
const cap = (price, unit, description) => rule('cap', price, unit, description, { unit_minutes: unit === 'day' ? 1440 : unit === 'minute' ? 30 : 60 });
const free = description => rule('free', 0, 'hour', description);

function parking(place, name, fee_detail, guide_text, location, fee_rules, needles, extra = {}) {
  if ([name, fee_detail, guide_text, location].some(x => forbidden.test(String(x)))) throw new Error(`Forbidden source wording in ${place}/${name}`);
  const rules = fee_rules || [];
  const numeric = rules
    .filter(r => Number.isFinite(r.price) && r.price >= 0 && r.rule_type !== 'cap')
    .flatMap(r => {
      if (r.unit === 'minute' && Number(r.unit_minutes) > 0) return [r.price * 60 / Number(r.unit_minutes)];
      if (r.unit === 'hour') return [r.price];
      return [];
    });
  return {
    name, fee_detail, guide_text, location, fee_rules: rules,
    type: extra.type || '停车场', fee_summary: fee_detail, address: extra.address || location,
    lng: null, lat: null, coordinate_status: extra.coordinate_status || '待补充', navigation_available: false,
    min_price_hour: numeric.length ? Math.min(...numeric) : null, free_minutes: extra.free_minutes ?? null,
    daily_cap: extra.daily_cap ?? null, night_flat: extra.night_flat ?? null, open_hours: extra.open_hours || null,
    payment: [], confidence: extra.confidence || (rules.length ? 'low' : 'low'), conflict_flag: Boolean(extra.conflict_flag),
    source: '编辑整理（公开信息）', source_records: sources(place, needles)
  };
}

const defs = [
  {
    sourcePlace: '广州中医药大学第一附属医院', name: '广州中医药大学第一附属医院',
    area_tips: '本轮抓取内容未整理出可确认的停车场名称与收费口径，建议优先公共交通；驾车到院前请以现场入口和收费公示为准。', parkings: []
  },
  {
    sourcePlace: '南方医科大学南方医院', name: '南方医科大学南方医院',
    area_tips: '院内地下车库有明确的分时收费信息，周边还有太阳城和云景花园等备选；院内车道较窄，建议避开高峰并预留找位时间。',
    parkings: [
      parking('南方医科大学南方医院', '南方医院新外科大楼地下停车场', '前3小时2.5元/半小时；12小时封顶35元；24小时封顶45元。', '从医院入口按地下车库指引进入，车库分多层；地下通道局部较窄，转弯和会车时注意避让。', '南方医院新外科大楼地下停车场', [half(2.5, '前3小时每半小时2.5元'), cap(35, 'day', '12小时封顶35元'), cap(45, 'day', '24小时封顶45元')], ['广州南方医科大学南方医院停车费', '南方医院的新楼建好']),
      parking('南方医科大学南方医院', '嘉裕太阳城停车场', '3小时5元优惠；原价36元，优惠每天限用一次，优惠资格和办理方式以现场及当日规则为准。', '位于南方医院对面，过天桥可到医院；使用优惠后应尽快离场，避免再次计费。', '嘉裕太阳城停车场', [duration(5, 180, '优惠：3小时5元')], ['广州嘉裕太阳城停车代缴']),
      parking('南方医科大学南方医院', '云景花园周边停车位', '收费口径未完整记录，按现场公示或管理方要求结算。', '从云景路方向寻找入口；车位较少，能否停入取决于现场空位，勿占道停放。', '云景花园（云景路方向）', [], ['每天停车费真的承受不起。'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '中山大学附属第六医院', name: '中山大学附属第六医院',
    area_tips: '员村周边有临时停车和包月停车信息，但具体场地名称与入口不完整；医院车位和周边道路高峰期可能紧张，建议到场确认。',
    parkings: [
      parking('中山大学附属第六医院', '员村周边停车点', '临时停车6元/小时；包月价格未完整记录。', '停车点位于员村地铁站附近城中村一带，具体入口和空位以现场为准；到医院的步行路线需现场确认。', '员村地铁站周边城中村（具体入口待核验）', [hour(6, '临时停车6元/小时')], ['发现天河平价'])
    ]
  },
  {
    sourcePlace: '中山大学附属第三医院', name: '中山大学附属第三医院',
    area_tips: '天娱广场可作为就诊备选，凭就诊凭证有更低的限时收费口径；医院及周边车位紧张时应预留排队时间。',
    parkings: [
      parking('中山大学附属第三医院', '天娱广场停车场', '常规16元/小时；凭中山三院挂号记录或票据可按8元/小时，限3小时；具体优惠以客服台当日规则为准。', '停车后到3楼客服台办理就诊优惠；也可使用商场积分兑换部分停车时长，客服台开放时间需留意。', '天娱广场停车场', [hour(16, '常规收费16元/小时'), hour(8, '就诊凭证优惠8元/小时，限3小时')], ['广州天娱广场停车攻略']),
      parking('中山大学附属第三医院', '中山三院院内停车场', '符合就诊条件时可按门诊号或住院号办理优惠，参考收费10元/天；具体适用条件、入口和剩余车位以医院现场为准。', '进场及缴费时按要求输入门诊号或住院号；车位紧张时可能需要排队。', '中山大学附属第三医院院内停车场', [day(10, '就诊车辆参考收费10元/天')], ['谁懂！医院停车费为什么这么贵？'])
    ]
  },
  {
    sourcePlace: '中山大学附属第一医院', name: '中山大学附属第一医院',
    area_tips: '院内车位少且入口可能限流，周边汇隆大厦、中华广场和电信广场等可作替代；长时间停车可考虑环贸中心的预约方案。',
    parkings: [
      parking('中山大学附属第一医院', '中山一院院内停车场', '2.5元/半小时；社会车辆是否放行、剩余车位和最终收费以现场为准。', '院内车位较少，早到也可能无法进入；入口放行后按地下车库指引停车。', '中山大学附属第一医院院内停车场', [half(2.5, '2.5元/半小时')], ['广州中山一院停车指引🅿️']),
      parking('中山大学附属第一医院', '电信广场停车场', '3元/15分钟；进入时可能需要说明到附近办事，是否对外开放以现场管理为准。', '位于医院正对面一带，进入后可按车库指引下行；步行到医院较近。', '电信广场停车场', [rule('normal', 3, 'minute', '3元/15分钟', { unit_minutes: 15 })], ['中山一试管停车攻略']),
      parking('中山大学附属第一医院', '金城宾馆停车场', '4元/15分钟。', '位于医院周边，停车后过马路并沿下坡方向步行到院；入口位置建议用地图再次确认。', '金城宾馆停车场', [rule('normal', 4, 'minute', '4元/15分钟', { unit_minutes: 15 })], ['中山一试管停车攻略']),
      parking('中山大学附属第一医院', '广州环贸中心停车场', '预约长停38元/天；适合住院等多日停车，预约、续停和具体入口以当日平台规则为准。', '需提前预约；停车后再换乘地铁返回医院，适合对步行距离和换乘有接受度的用户。', '广州环贸中心停车场', [day(38, '预约长停38元/天')], ['广州中山大学附属第一医院停车38一天'], { confidence: 'low' }),
      parking('中山大学附属第一医院', '汇隆大厦停车场', '收费口径未完整记录，按现场公示结算。', '医院周边可作为就近备选，车位有限；注意甄别正规入口和收费渠道，不接受路边揽客带停。', '汇隆大厦停车场', [], ['中山大学附属第一医院，千万别乱找人停车！！！'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '中山大学孙逸仙纪念医院', name: '中山大学孙逸仙纪念医院（中山二院）',
    area_tips: '北院周边有私人停车场和划线车位信息，但明确收费及入口不完整；不要占道或接受不透明的带停收费，现场确认后再入场。',
    parkings: [
      parking('中山大学孙逸仙纪念医院', '北院周边私人停车场', '收费口径未完整记录，按现场公示结算。', '医院周边有多个小型停车点，位置和空位变化较快；优先选择有正规入口和收费公示的场地。', '中山大学孙逸仙纪念医院北院周边（入口待核验）', [], ['孙逸仙医院'], { confidence: 'low' }),
      parking('中山大学孙逸仙纪念医院', '北院周边划线停车位', '收费标准未完整记录，按现场泊位及管理要求结算。', '仅在明确划线和允许停车的位置停放，避免占用消防通道、出入口或无标线路段。', '中山大学孙逸仙纪念医院北院周边道路（位置待核验）', [], ['孙逸仙医院'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '中山大学肿瘤防治中心', name: '中山大学肿瘤防治中心',
    area_tips: '越秀院区楼栋密集、车位紧张，建议优先公共交通；黄埔院区场地宽阔且有免费停车口径，务必先核对挂号单上的院区，避免跑错。',
    parkings: [
      parking('中山大学肿瘤防治中心', '越秀院区周边公共停车位', '收费口径未完整记录，按现场公示结算。', '越秀院区车位紧张，建议优先地铁到区庄站后步行；驾车到场应预留排队和绕行时间。', '中山大学肿瘤防治中心越秀院区周边（位置待核验）', [], ['中肿保姆级攻略收藏起来！'], { confidence: 'low' }),
      parking('中山大学肿瘤防治中心', '黄埔院区停车场', '公开信息显示可免费停车；具体开放时段、车位和入场规则以现场为准。', '黄埔院区与越秀院区距离较远，只有在挂号或检查安排对应黄埔院区时使用；先核对院区地址。', '中山大学肿瘤防治中心黄埔院区（开阳五路1号）', [free('参考口径：免费停车')], ['中肿保姆级攻略收藏起来！'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '体育西路', name: '体育西路商圈',
    area_tips: '体育西商圈可按目的地在体育中心、天河城及周边写字楼停车场中选择；宏发、创展、财富、丰兴和佳兆业的分时口径已分别保留，夜间和周末价格差异明显。',
    parkings: [
      parking('体育西路', '宏发大厦停车场', '15分钟内免费；08:00-22:00 4元/15分钟；22:00-次日08:00 4元/15分钟，夜间最高限价32元，24小时最高限价128元。', '靠近万菱汇和天河南二路，按宏发大厦停车场入口进入；高峰期周边道路可能拥堵。', '宏发大厦停车场', [free('前15分钟免费'), duration(4, 15, '08:00-22:00 4元/15分钟'), duration(4, 15, '22:00-次日08:00 4元/15分钟'), cap(32, 'day', '夜间最高限价32元'), cap(128, 'day', '24小时最高限价128元')], ['体育西周边停车攻略3⃣️（共三篇）']),
      parking('体育西路', '创展中心停车场', '15分钟内免费；工作日08:00-18:00 16元/小时，18:00后 8元/小时；非工作日 8元/小时。', '靠近正佳广场、万菱汇和天河南二路，适合工作日晚间或非工作日停车；具体入口按创展中心指引。', '创展中心停车场', [free('前15分钟免费'), hour(16, '工作日08:00-18:00 16元/小时'), hour(8, '工作日18:00后及非工作日 8元/小时')], ['体育西周边停车攻略3⃣️（共三篇）']),
      parking('体育西路', '财富广场停车场', '08:00-22:00 4元/15分钟；22:00-次日08:00 1元/15分钟，夜间最高限价10元，24小时最高限价128元。', '靠近广州酒家、天河体育中心和时尚天河，适合按目的地选择入口；夜间停车相对更划算。', '财富广场停车场', [duration(4, 15, '08:00-22:00 4元/15分钟'), duration(1, 15, '22:00-次日08:00 1元/15分钟'), cap(10, 'day', '夜间最高限价10元'), cap(128, 'day', '24小时最高限价128元')], ['体育西周边停车攻略3⃣️（共三篇）']),
      parking('体育西路', '丰兴广场停车场', '收费10元/小时。', '靠近万菱汇和天河南二路，适合作为就近备选；入场前确认当日收费牌。', '丰兴广场停车场', [hour(10, '收费10元/小时')], ['体育西周边停车攻略3⃣️（共三篇）']),
      parking('体育西路', '佳兆业广场停车场', '08:00-22:00前15分钟免费，之后4元/15分钟；22:00-次日08:00前30分钟免费，之后4元/小时，夜间最高限价10元，24小时最高限价128元。', '按佳兆业广场入口进入，短停可利用免费时段；夜间规则与白天不同，离场前核对计费。', '佳兆业广场停车场', [free('白天前15分钟免费'), duration(4, 15, '08:00-22:00 4元/15分钟'), free('夜间前30分钟免费'), hour(4, '22:00-次日08:00 4元/小时'), cap(10, 'day', '夜间最高限价10元'), cap(128, 'day', '24小时最高限价128元')], ['体育西周边停车攻略3⃣️（共三篇）']),
      parking('体育西路', '天河路299号·天河体育中心停车场', '前15分钟免费；白天7:30-21:30前3小时5元/小时，超过3小时10元/小时；夜间21:30-次日7:30 2元/小时，夜间封顶10元，24小时最高35元。', '建议从天河体育中心东南门进入，西南门车位较少；可通过地下通道前往天河城、天环和正佳。', '天河路299号·天河体育中心停车场', [free('前15分钟免费'), hour(5, '白天前3小时5元/小时'), hour(10, '白天超过3小时10元/小时'), hour(2, '夜间2元/小时'), cap(10, 'day', '夜间封顶10元'), cap(35, 'day', '24小时最高35元')], ['天河体育中心停车收费方式变了', '正佳/天环/天河城，停车攻略‼️'])
    ]
  },
  {
    sourcePlace: '珠江新城', name: '珠江新城（花城汇/高德置地）',
    area_tips: '珠江新城车位少、价格差异大；眼科医院停车场适合妇儿中心方向短停，富力中心适合通勤月保，均需以现场或管理方最新规则为准。',
    parkings: [
      parking('珠江新城', '眼科医院停车场', '2.5元/半小时；具体收费按现场公示。', '从眼科医院蓝色指示牌进入，靠近妇儿中心后门一侧；地面停车，步行约3分钟到妇儿中心方向。', '眼科医院停车场（妇儿中心后门方向）', [half(2.5, '2.5元/半小时')], ['珠江新城带娃看病停车难？99%家长不知道的隐']),
      parking('珠江新城', '富力中心地下停车场', '月保900元/月，24小时不限时；首月优惠和办理条件以管理方当日规则为准。', '位于华夏路10号，地下负五层，步行到地铁站约5分钟；适合珠江新城通勤长停。', '富力中心地下停车场（华夏路10号）', [month(900, '月保900元/月')], ['在珠江新城停车，我每月省了 500 块'], { type: '地下停车场', confidence: 'low' })
    ]
  },
  {
    sourcePlace: '番禺万博', name: '番禺万博',
    area_tips: '万博商圈可优先比较华新汇、奥园和万达；华新汇和奥园有短时优惠口径，但地下环路和商场步行指引不够直观，建议提前确认出口。',
    parkings: [
      parking('番禺万博', '华新汇停车场', '约15分钟或半小时内免费，之后约5元/小时；派出所附近另有少量免费车位，数量有限。', '跟随华新汇停车指引开上坡道；到万博派出所办理业务时可优先看附近少量免费位。', '华新汇停车场（万博派出所旁）', [free('约15分钟或半小时内免费'), hour(5, '之后约5元/小时')], ['番禺万博派出所24小时营业有自助机']),
      parking('番禺万博', '奥园停车场', '1小时内免费，超出后按现场标准收费。', '从地下环路进入后按奥园停车指引；场内标识较少，建议记住电梯编号和出口方向。', '奥园停车场（番禺万博地下环路）', [free('1小时内免费')], ['番禺南村万博花市开啦～地下停车怎么去']),
      parking('番禺万博', '番禺万达停车场', '停留2小时19分钟实付18元；不同消费、影片和时段可能有优惠差异，按现场规则结算。', '适合前往万达广场及影院，离场前确认是否有消费减免或活动。', '番禺万达停车场', [], ['番禺万达，停车费这么高的吗'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '江南西', name: '江南西',
    area_tips: '江南西本轮可确认的停车信息较少，保留室内月租车位作为长停备选；具体小区、入口和临停费率仍需现场核实。',
    parkings: [
      parking('江南西', '江南西地铁上盖室内停车位', '月租约500元级别，临停收费未完整记录。', '步行到地铁站约3分钟；车位属于室内停车场，具体楼栋和办理入口待管理方确认。', '江南西地铁站周边室内停车场（具体入口待核验）', [month(500, '月租约500元/月')], ['5xx海珠区地铁上盖车位 停车🅿️！！'], { type: '地下停车场', confidence: 'low' })
    ]
  },
  {
    sourcePlace: '黄埔大沙地', name: '黄埔大沙地',
    area_tips: '大沙地保留雄资购物城、吉祥停车场和周边月租车位三类选择；部分车位供应和收费不稳定，进场前确认当日价格及余位。',
    parkings: [
      parking('黄埔大沙地', '雄资购物城停车场', '6元/半小时，12元/小时。', '适合到雄资购物城、影院和娱乐设施；按商场入口指引进入，现场确认是否有消费减免。', '雄资购物城停车场', [half(6, '6元/半小时'), hour(12, '12元/小时')], ['黄埔雄资购物城停车费']),
      parking('黄埔大沙地', '吉祥停车场', '临时停车收费口径未完整记录，按现场公示结算。', '有临时停车位，适合周边短时办事；入口和余位以现场为准。', '吉祥停车场（大沙地周边）', [], ['吉祥停车场🅿️'], { confidence: 'low' }),
      parking('黄埔大沙地', '大沙地周边室内月租车位', '室内月租200元/月；余位和办理条件以管理方为准。', '适合通勤或长期停放，具体楼栋和入口待确认；不要把月租信息当作临停价格。', '大沙地/夏园周边室内停车场（具体入口待核验）', [month(200, '室内月租200元/月')], ['找广州底价停车位必看'], { type: '地下停车场', confidence: 'low' })
    ]
  },
  {
    sourcePlace: '岗顶', name: '岗顶',
    area_tips: '岗顶本轮最明确的选择是天娱广场，常规收费较高，但可叠加积分或中山三院就诊优惠；兑换和优惠需到客服台办理。',
    parkings: [
      parking('岗顶', '天娱广场停车场', '常规16元/小时；永辉积分可兑换每100积分1小时，单车每天最多6小时；中山三院就诊凭证8元/小时，限3小时。', '到3楼客服台办理积分兑换或就诊优惠，客服台通常10:00后开放；先确认优惠资格再停车更稳妥。', '天娱广场停车场', [hour(16, '常规16元/小时'), free('积分兑换：100积分可抵1小时，单车每天最多6小时'), hour(8, '中山三院就诊优惠8元/小时，限3小时')], ['广州天娱广场停车攻略！永辉积分换停车'], { conflict_flag: true })
    ]
  },
  {
    sourcePlace: '五羊新城', name: '五羊新城',
    area_tips: '五羊新城周边可参考杨箕停车场和五羊地上车库；月租及夜间收费信息不完整，具体位置、余位和价格必须现场确认。',
    parkings: [
      parking('五羊新城', '杨箕停车场', '夜间约20:00-次日07:30，参考约20元封顶；也有约32元的夜间收费口径，按具体场地现场公示为准。', '适合夜间或过夜停车；杨箕一带场地较多，进入前确认停车场名称和收费牌。', '杨箕地铁站周边停车场（具体入口待核验）', [cap(20, 'day', '夜间参考约20元封顶'), cap(32, 'day', '另有夜间约32元封顶口径')], ['跪求杨箕地铁站附近便宜的停车场🅿️'], { conflict_flag: true, confidence: 'low' }),
      parking('五羊新城', '五羊地上车库', '月租价格未完整记录，按管理方报价办理。', '地上车库，具体楼栋、入口和是否仍有余位待确认；适合长期停车咨询。', '五羊新城周边地上车库（具体入口待核验）', [], ['🔥越秀｜五羊🈶️车位出租'], { confidence: 'low' })
    ]
  },
  {
    sourcePlace: '琶洲', name: '琶洲',
    area_tips: '琶洲保留中洲交易中心、海珠城中央和广州国际采购中心周边三类停车选择；月卡与日卡口径并存，广交会等活动期间务必重新确认价格。',
    parkings: [
      parking('琶洲', '中洲交易中心（六元素商场）停车场', '月卡368元/月；活动期间白天日卡39.9元；室内车库，配有充电设施，价格和活动以现场为准。', '适合琶洲、磨碟沙、万胜围和赤岗客村方向；可按中洲交易中心或六元素商场导航，入场后按地下车库指引。', '中洲交易中心（六元素商场）停车场', [month(368, '月卡368元/月'), day(39.9, '活动期间白天日卡39.9元')], ['什么？琶洲桥底停车都要几百上千？', '海珠琶洲停车']),
      parking('琶洲', '海珠城中央停车场', '月租598元/月；距磨碟沙地铁站约250米，临停价格未完整记录。', '地下车库，适合磨碟沙、琶洲及周边办公通勤；具体入口和临停价格以现场为准。', '海珠城中央停车场（磨碟沙地铁站附近）', [month(598, '月租598元/月')], ['磨碟沙300米，598元/月，地下五星停车'], { type: '地下停车场', confidence: 'low' }),
      parking('琶洲', '华南大桥下地面停车场', '月租约500-1000元级别的参考信息，临停收费和余位未完整记录。', '适合腾讯广州大厦、磨碟沙方向通勤，地面停车；到场确认是否仍对外开放及当日余位。', '华南大桥下地面停车场（磨碟沙方向）', [], ['腾讯广州大厦附近停车月费贵得起飞'], { confidence: 'low' }),
      parking('琶洲', '广州国际采购中心周边停车场', '月卡700元/月，半年500元/月，年卡折算450元/月；全天可进出，具体方案以管理方为准。', '位于广州国际采购中心、中洲中心和中洲交易中心一带，适合通勤长停；办理前确认车位是否仍有。', '广州国际采购中心周边停车场', [month(700, '月卡700元/月'), month(500, '半年方案折算500元/月'), month(450, '年卡折算450元/月')], ['广州琶洲地铁站附近停车场450/月'])
    ]
  }
];

function legacyFor(def) {
  return legacy.places.find(p => p.name === def.name) || null;
}

const outPlaces = defs.map((def, placeIndex) => {
  const old = legacyFor(def);
  const parkings = def.parkings.map((p, i) => ({ id: 2000 + placeIndex * 100 + i, ...p }));
  const cleanTips = def.area_tips.replace(/小红书|笔记|评论区|评论中|原文|作者回复|薯友|博主|帖子|扒数据/g, '').replace(/\s+/g, ' ').trim();
  return {
    id: old?.id || 1000 + placeIndex, name: def.name, city_code: '440100', category: old?.category || '商圈',
    address: old?.address || null, district: old?.district || null, lng: old?.lng ?? null, lat: old?.lat ?? null,
    heat: old?.heat ?? 50, summary: old?.summary || cleanTips, tags: old?.tags || ['停车'],
    area_tips: cleanTips, coordinate_status: old ? '待核验' : '待补充', navigation_available: false,
    parkings, parking_count: parkings.length, updated_at: new Date().toISOString()
  };
});

const forbiddenFields = outPlaces.flatMap(p => [p.area_tips, ...p.parkings.flatMap(k => [k.name, k.fee_detail, k.guide_text, k.location])]).filter(x => forbidden.test(String(x)));
if (forbiddenFields.length) throw new Error(`Forbidden wording count=${forbiddenFields.length}`);
const meta = { city: '广州', city_code: '440100', generated_at: new Date().toISOString(), source_dir: 'server/xhs-raw/p0-remaining2-20260914', places: outPlaces.length, parkings: outPlaces.reduce((n, p) => n + p.parkings.length, 0), fee_rules: outPlaces.reduce((n, p) => n + p.parkings.reduce((m, k) => m + k.fee_rules.length, 0), 0), notes_captured: 150 };
fs.writeFileSync(outputPath, JSON.stringify({ meta, places: outPlaces }, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, meta, byPlace: outPlaces.map(p => ({ name: p.name, parkings: p.parkings.length, pending_coordinates: p.parkings.filter(k => k.coordinate_status !== '已核验').length })) }, null, 2));
