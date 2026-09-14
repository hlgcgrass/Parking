import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const candidatePath = path.resolve(process.env.XHS_CANDIDATE_PATH || path.join(root, 'server', 'xhs-p0-candidates-41.json'));
const legacyPath = path.join(root, 'parking-miniapp', 'cloudfunctions', 'parking', 'data.json');
const outputPath = path.resolve(process.env.XHS_OUTPUT_PATH || path.join(root, 'server', 'xhs-p0-import-41.json'));

const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));

const rejectParkingName = name => {
  const s = String(name || '');
  if (/^(?:广州停车场|特定路|东门有|西门都有|凭预约|公园停车场|管理停车场|室外停车场|核心停车场|正门停车场|地下停车场|地面停车场|医院停车场|第\d+个|第\d+|以上两个|左右两边各有|隔壁也有|停车优先|度假区内|排队进|侨鑫过个马路|号）|去社区医院|有免费|一般天河|在动不动|相比|且为|发现了|沙面本身|里面两个|这边停车场|一个超低调|神级停车场|可直接进|景区有|大雄宝殿|名字叫|直到找到|当你看到|停东区|\(华新汇\)|号\)院内|广州白云区n|P\d+停车场$)/.test(s)) return true;
  if (/停车场$/.test(s) && !/[\u4e00-\u9fff]{3,}(?:停车场|车库)$/.test(s)) return true;
  return false;
};

const normalize = s => String(s || '').replace(/[（）()\s·、，,。/\\-]/g, '').toLowerCase();
const stripChrome = s => String(s || '')
  .replace(/首页.*?LIVE(?: LIVE)* /, '')
  .replace(/^.*?\d+\/\d+\s+[^ ]+\s+关注\s+/, '')
  .replace(/猜你想搜.*?(?:评论：|$)/, '评论：')
  .replace(/说点什么\.\.\..*$/, '')
  .trim();
const splitSentences = s => String(s || '')
  .replace(/\r?\n/g, '。')
  .split(/(?<=[。！？；!?;])/)
  .flatMap(x => x.split(/，|,/))
  .map(x => x.replace(/\s+/g, ' ').trim())
  .filter(Boolean);
const unique = a => [...new Set(a.map(x => x.trim()).filter(Boolean))];
function focus(text, keywords, max = 180) {
  let x = String(text || '').replace(/\s+/g, ' ').replace(/#[^ ]+/g, '').trim();
  if (x.length <= max) return x;
  const indexes = keywords.map(k => x.indexOf(k)).filter(i => i >= 0);
  if (!indexes.length) return x.slice(0, max);
  const at = Math.min(...indexes);
  const start = Math.max(0, at - 55);
  return x.slice(start, start + max).replace(/^[，。；：:、\s]+/, '').trim();
}

function cleanClause(s) {
  return String(s || '')
    .replace(/^[\s:：|｜•·\-—]+/, '')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/编辑于\s*\d{2}-\d{2}/g, '')
    .replace(/^(?:停车🅿️?|停车费|收费标准|收费|价格|费用)\s*[:：]?\s*/i, '')
    .trim();
}

function isNoise(s) {
  return /首页|点点\s*ai|沪ICP备|营业执照|公网安备|增值电信|违法不良|网络文化|猜你想搜|说点什么|小红书|LIVE|点击立即购买|联系商品客服|停车代缴|发车牌|门票|人均|吃饭|餐厅|美食|租车|骑行|露营|游玩亮点|最佳机位|拍照/.test(s);
}

function findLegacyPlace(place) {
  const n = normalize(place);
  return (legacy.places || []).find(p => {
    const q = normalize(p.name);
    return q.includes(n) || n.includes(q) || (n === '长隆' && q.includes('长隆')) || (n === '沙面' && q.includes('沙面'));
  }) || null;
}

function inferParkingName(sentence, place) {
  const quoted = sentence.match(/[“"「]([^”"」]{2,40})[”"」]/g)?.map(x => x.slice(1, -1)) || [];
  const endings = '(?:停车场|车库|广场|大厦|中心|汽配城|花园|公园|商场|医院|码头|路|街|村|P\\d+)';
  const named = sentence.match(new RegExp(`(?:选择|导航|定位|停在|停到|停车在|停车场为|停车场是)\\s*[“"「]?([^。；，,]{2,35}?${endings})`, 'g')) || [];
  const shortNamed = sentence.match(new RegExp(`[\\u4e00-\\u9fffA-Za-z0-9·（）()\\-]{2,22}${endings}`, 'g')) || [];
  const candidates = [...quoted, ...named]
    .concat(shortNamed)
    .map(x => x.replace(/[“"「”"」]/g, '').replace(/^(导航|定位|搜|导到|选择|停在|停到|停车在|停车场为|停车场是)[:：]?\s*/, '').trim())
    .map(x => x.replace(/^.*?选择\s*/, '').replace(/的停车场$/, '停车场').trim())
    .filter(x => x.length >= 2 && !/门票|收费标准|停车攻略|停车收费|小红薯|大家|整理|实惠|找不到|可以选择|附近|周边|这里|推荐停车点|停车位置|停车位$/.test(x))
    .filter(x => !new RegExp(`^(?:去|到|前往)?${place}`).test(x) || /停车场|车库|汽配城|商场/.test(x));
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
  return null;
}

function feeSentences(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const re = /\d+(?:\.\d+)?\s*(?:元|块|蚊|💰)|¥\s*\d+|免费|不收费|限价|封顶/g;
  const boundaries = /[。；;！？!?，,\n]|[🅿️📍]|\d+[️⃣、.)]/gu;
  for (const m of source.matchAll(re)) {
    const at = m.index ?? 0;
    const before = source.slice(0, at);
    const after = source.slice(at + m[0].length);
    const starts = [...before.matchAll(boundaries)].map(x => (x.index ?? 0) + x[0].length);
    const next = after.search(boundaries);
    const start = starts.length ? starts[starts.length - 1] : Math.max(0, at - 75);
    const end = next >= 0 ? at + m[0].length + next : Math.min(source.length, at + m[0].length + 45);
    const s = cleanClause(source.slice(start, end));
    if (isNoise(s) || !/(\d+(?:\.\d+)?\s*(?:元|块|蚊|💰)|¥\s*\d+|免费|不收费|限价|封顶)/.test(s)) continue;
    if (/门票|餐|吃饭|租车|鱼食|讲解器|消费满/.test(s) && !/停车|车位|收费|停车场|车库/.test(s)) continue;
    if (!/(停车|车位|收费|封顶|免费|停车场|车库|导航|定位)/.test(s)) continue;
    out.push(s);
  }
  return unique(out).slice(0, 10);
}

function routeSentences(text) {
  return splitSentences(text).map(cleanClause).map(s => focus(s, ['步行', '走到', '距离', '米', '公里', '分钟', '入口', '出口'], 150)).filter(s => /步行|走到|走过去|距离|米|公里|分钟|入口|出口/.test(s) && !isNoise(s) && !/门票|游览|路线：因为|骑行路线/.test(s));
}

function warningSentences(text) {
  return splitSentences(text).map(cleanClause).filter(s => /排队|堵|拥堵|路窄|入口窄|限高|抄牌|贴条|满位|车位紧张|不让停|交通管制|早到|高峰|位置少|车位少|难停|排长队/.test(s) && !isNoise(s)).map(s => focus(s, ['排队', '堵', '拥堵', '路窄', '限高', '抄牌', '贴条', '满位', '车位紧张', '不让停', '交通管制', '高峰', '难停'], 150));
}

function placeParkingSummary(parkingRows) {
  if (!parkingRows.length) return '本轮未提取到可确认的停车信息。';
  const routes = [];
  const warnings = [];
  for (const parking of parkingRows) {
    for (const line of String(parking.tips || '').split(/\r?\n/)) {
      const value = cleanClause(line).replace(/^\d+[、.)]\s*/, '').trim();
      if (!value || isNoise(value) || /[?？]|(?:吗|呢|吧)[。.!！]*$/.test(value)) continue;
      if (/^路线[:：]/.test(value)) routes.push(value.replace(/^路线[:：]\s*/, ''));
      if (/^注意[:：]/.test(value)) warnings.push(value.replace(/^注意[:：]\s*/, ''));
    }
  }
  const parts = [`该地点已整理${parkingRows.length}个停车点`];
  const routeText = unique(routes).slice(0, 4).join('；');
  const warningText = unique(warnings).slice(0, 4).join('；');
  if (routeText) parts.push(`步行与入口：${routeText}`);
  if (warningText) parts.push(`停车注意：${warningText}`);
  return parts.join('。');
}

function sanitizeComment(s) {
  let x = s.replace(/^评论：/, '').replace(/\s+/g, ' ').trim();
  if (x.includes('作者')) x = x.slice(x.indexOf('作者') + 2);
  x = x.replace(/^[^：:]{1,24}[：:]/, '').trim();
  x = x.replace(/\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|广东|赞|回复|展开\s*\d*\s*条回复|\d+\s*\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return x;
}

function commentSentences(text) {
  const cues = ['4元', '5元', '10元', '停车费', '收费', '免费', '排队', '堵', '拥堵', '路窄', '限高', '抄牌', '贴条', '满位', '不让停', '不给停', '管制'];
  const warningCues = ['排队', '堵', '拥堵', '路窄', '限高', '抄牌', '贴条', '满位', '不让停', '不给停', '管制'];
  const out = [];
  for (const s of splitSentences(text)) {
    if (!cues.some(k => s.includes(k))) continue;
    const clean = sanitizeComment(s);
    const hits = cues.map(k => clean.indexOf(k)).filter(i => i >= 0);
    if (!hits.length) continue;
    const at = Math.min(...hits);
    const isWarning = warningCues.some(k => clean.includes(k));
    const start = isWarning ? at : Math.max(0, at - 25);
    const x = clean.slice(start, at + (isWarning ? 80 : 65))
      .split(/\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|广东|赞|回复|展开|@|红薯\S*/)[0]
      .replace(/^[^\u4e00-\u9fff]{0,20}/, '').replace(/\s+/g, ' ').trim();
    if (!/作者|回复|展开|条评论|小红薯|沪ICP备|LIVE|说点什么|请问|求问/.test(x) && !isNoise(x) && x.length >= 4 && x.length <= 100) out.push(x);
  }
  return out;
}

function exactFeeText(rows) {
  const out = [];
  for (const s of rows) {
    const x = s.replace(/^[^：:]{0,24}[：:]/, '').trim();
    if (/实付|花了|支付了|付了/.test(x) && !/收费标准|停车费是|停车收费/.test(x)) continue;
    if (!isNoise(x)) out.push(x);
  }
  return unique(out).slice(0, 8).join('；');
}

function actualPaymentText(rows) {
  return unique(rows.filter(s => /实付|花了|支付了|付了|停了.*收/.test(s)).map(s => s.replace(/^[^：:]{0,24}[：:]/, '').trim())).slice(0, 4).join('；');
}

function conflictFlag(text) {
  const values = [...String(text || '').matchAll(/(\d+(?:\.\d+)?)\s*元(?:\/|每)(?:小时|半小时|天|次)|(?:封顶|限价)[^\d]{0,8}(\d+(?:\.\d+)?)\s*元/g)].map(m => Number(m[1] || m[2]));
  return new Set(values).size > 1;
}

function buildFeeRules(feeText) {
  const rules = [];
  const pieces = String(feeText || '').split(/[；;]/).filter(Boolean);
  for (const s of pieces) {
    const nums = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:元|块|蚊|💰|¥)/g)].map(m => Number(m[1]));
    if (!nums.length) continue;
    const price = nums[nums.length - 1];
    const unit = /半小时|30分钟/.test(s) ? 'time' : /天|日/.test(s) ? 'day' : 'hour';
    const ruleType = /封顶|限价|最高/.test(s) ? 'cap' : (nums.length === 0 && /免费|不收费/.test(s)) ? 'free' : 'normal';
    rules.push({ rule_type: ruleType, start_minute: null, end_minute: null, time_start: null, time_end: null, price: ruleType === 'free' ? 0 : price, unit, unit_minutes: unit === 'time' ? 30 : 60, description: s, confidence: 'low', priority: ruleType === 'cap' ? 100 : 50 });
  }
  if (!rules.length && /免费|不收费/.test(feeText)) rules.push({ rule_type: 'free', start_minute: null, end_minute: null, time_start: null, time_end: null, price: 0, unit: 'hour', unit_minutes: 60, description: '免费停车', confidence: 'low', priority: 50 });
  return rules;
}

function parkingCandidates(text, place) {
  const source = String(text || '');
  const out = [];
  const add = (value, strict = false) => {
    let x = String(value || '').replace(/[“"「”"」]/g, '').replace(/^[\s:：、，,]+|[\s。；;，,]+$/g, '').trim();
    x = x.replace(/^(?:导航|定位|搜|导到|选择|停在|停到|停车在|停车点|推荐停车点)\s*[:：]?\s*/, '').trim();
    x = x.replace(/^(?:到|去|前往)\s*/, '').trim();
    if (!x || x.length < 2 || x.length > 40 || isNoise(x) || /�|🅿|📍|✅|❗|•|🚗|停车费|收费标准|价格/.test(x)) return;
    if (strict && (/\s|绕着|回到|第\d|左右|有个|那个|内容|停车优先|室外|露天|核心|一般|仅|两层|下面|真心|偶然|精心|官方|小区里|游玩|攻略/.test(x) || x.length > 25)) return;
    if (/^(?:白云山|陈家祠|大夫山|二沙岛|广东省博物馆|广州塔|北京路|沙面|永庆坊|越秀公园|长隆|西门|南门|北门|东门)(?:附近|周边)?$/.test(x)) return;
    if (/附近|周边|最佳停车位|停车攻略|停车收费|停车推荐$|停车位置$/.test(x)) return;
    if (/^(?:去|到|前往|比|可以|停好|从|走|直接|不用|后|这里|旁边|看|将|经过|有|是|在|距离|值得|动不动|按图|可|但|因为|如果|根据|发现|选择|推荐|适合|优先|一般|这|那|一个|两个|共|大家|相比)/.test(x)) return;
    if (/(?:的|不知道|我们|周围|外的|出停车场|停车后|步行|走到|找不到|搜索|导航|定位|开到|时候|位置少|车位少|划算|便宜的|新开|这类|任意|封顶|收费|价格)/.test(x)) return;
    if (!/(停车场|车库|汽配城|会堂|P\d+|码头(?:停车)?$|门(?:停车场)?$)/.test(x)) return;
    if (/^(?:广州|一般天河|特定路|东门有|西门都有|凭预约|公园|管理|室外|核心|正门|地下|地面|医院|第\d+个|第\d+|以上两个|左右两边各有|隔壁也有|停车优先|度假区内|排队进|侨鑫过个马路|号）|去社区医院|有免费)/.test(x)) return;
    if (/(?:停车场|车库)$/.test(x) && /(?:过个马路|通过|有个|这边|那个|这个|只是|最后|其实|刚被|没去|比较大|无论|走一圈)/.test(x)) return;
    if (/(?:门|码头|花园|公园|大厦|中心|广场)）?$/.test(x) && !/停车场|车库/.test(x)) x += '停车场';
    out.push(x);
  };
  for (const m of source.matchAll(/[“"「]([^”"」]{2,40})[”"」]/g)) {
    if (/停车|车库|汽配城|商场|中心|广场|大厦|医院|花园|公园|会堂|码头|路|门/.test(m[1])) add(m[1]);
  }
  for (const m of source.matchAll(/(?:导航|定位|停在|停到|停车点|推荐停车点)\s*[：:]?\s*([^。；，,!?！？\n]{2,40}?)(?=\s*(?:经过|停车费|停车|收费|优点|缺点|步骤|✅|❗|$)|[，,。；!?！？\n])/g)) add(m[1]);
  for (const m of source.matchAll(/[\u4e00-\u9fffA-Za-z0-9·（）()\-]{2,35}(?:停车场|车库|汽配城|商场停车场|国际会堂|体育公园)/g)) add(m[0], true);
  return unique(out).filter(x => !/^(?:停车|收费|标准|价格|费用)/.test(x));
}

function contextAround(text, name) {
  const source = String(text || '');
  const index = source.indexOf(name);
  if (index < 0) return source;
  return source.slice(Math.max(0, index - 220), Math.min(source.length, index + name.length + 300));
}

function contextForName(text, name, names) {
  const source = String(text || '');
  const variants = [name, name.replace(/停车场$/, ''), name.replace(/车库$/, '')].filter(Boolean);
  let index = -1;
  let matched = '';
  for (const v of variants) {
    index = source.indexOf(v);
    if (index >= 0) { matched = v; break; }
  }
  if (index < 0) return contextAround(source, name);
  const later = names.map(n => {
    const i = source.indexOf(n.replace(/停车场$/, ''));
    return i > index ? i : Infinity;
  }).filter(Number.isFinite);
  const nextMarker = source.slice(index + matched.length).search(/🅿️?\s*\d|(?:停车点|推荐停车点|收费标准|停车费)\s*[:：]/);
  const end = Math.min(
    later.length ? Math.min(...later) : source.length,
    nextMarker >= 0 ? index + matched.length + nextMarker : source.length,
    index + matched.length + 260
  );
  return source.slice(Math.max(0, index - 100), Math.max(index + matched.length + 40, end));
}

const places = [];
const parkingsByPlace = {};
const tipsByPlace = {};
let nextParkingId = 1001;

for (const p of candidate.places) {
  const legacyPlace = findLegacyPlace(p.place);
  const placeId = legacyPlace?.id || (places.length + 100);
  const parkingGroups = new Map();
  const allRoutes = [];
  const allWarnings = [];
  const sourceRecords = [];

  for (const note of p.notes) {
    const body = String(note.body || '');
    const comments = String(note.comments || '');
    const commentRows = commentSentences(comments);
    const names = parkingCandidates(body, p.place);
    if (!names.length) {
      const fees = feeSentences(body);
      const name = fees.length ? inferParkingName(fees[0], p.place) : null;
      if (name) names.push(name);
    }
    for (const name of names) {
    const context = contextForName(body, name, names);
      const fees = feeSentences(context);
      if (!fees.length) continue;
      const routes = routeSentences(context);
      const warnings = warningSentences(`${context} ${commentRows.join('；')}`);
      const group = parkingGroups.get(name) || { name, fees: [], routes: [], warnings: [], comments: [], payments: [], noteCount: 0, source_records: [] };
      group.fees.push(...fees);
      group.routes.push(...routes);
      group.warnings.push(...warnings, ...commentRows);
      group.payments.push(actualPaymentText(fees));
      group.noteCount++;
      group.source_records.push({ source_type: 'xiaohongshu', source_url: note.url, source_title: note.title, source_author: note.author || null, source_published_at: note.published_at || null, rank: note.rank, raw_file: note.raw_file || null });
      parkingGroups.set(name, group);
    }
  }

  const parkingRows = [];
  for (const group of parkingGroups.values()) {
    if (rejectParkingName(group.name)) continue;
    const feeText = exactFeeText(group.fees);
    if (!feeText) continue;
    const routeText = unique(group.routes).filter(x => !isNoise(x)).slice(0, 4).join('；');
    const warningText = unique(group.warnings).filter(x => !isNoise(x)).slice(0, 8).join('；');
    const paymentText = unique(group.payments).filter(Boolean).join('；');
    const noteParts = [`1、收费：${feeText}`];
    if (paymentText) noteParts.push(`2、实付记录：${paymentText}`);
    if (routeText) noteParts.push(`${noteParts.length + 1}、路线：${routeText}`);
    if (warningText) noteParts.push(`${noteParts.length + 1}、注意：${warningText}`);
    const conflict = conflictFlag(`${feeText} ${warningText}`);
    const feeRules = buildFeeRules(feeText);
    if (!feeRules.length) continue;
    parkingRows.push({
      id: nextParkingId++, name: group.name, address: null, type: /机械|立体/.test(group.name + feeText) ? '立体车库' : '停车场', total_spots: null,
      lng: null, lat: null, coordinate_status: '待补充', navigation_available: false,
      free_minutes: /免费/.test(feeText) ? 0 : null, daily_cap: null, night_flat: null, open_hours: null, payment: [], min_price_hour: null,
      tips: noteParts.join('\n'), source: '编辑整理（公开信息）', confidence: group.noteCount >= 2 && !conflict ? 'medium' : 'low', verified_at: new Date().toISOString().slice(0, 10), status: 1,
      conflict_flag: conflict, source_records: group.source_records, fee_rules: feeRules
    });
    allRoutes.push(...group.routes); allWarnings.push(...group.warnings);
    sourceRecords.push(...group.source_records);
  }
  if (parkingRows.length) parkingsByPlace[placeId] = parkingRows;
  const areaTips = placeParkingSummary(parkingRows);
  const base = legacyPlace || { id: placeId, name: p.place, category: '景点', address: null, lng: null, lat: null, heat: 50, summary: '', tags: [], search_text: '' };
  places.push({ ...base, id: placeId, name: base.name || p.place, parking_count: parkingRows.length, area_tips: areaTips, updated_at: new Date().toISOString() });
  tipsByPlace[placeId] = [{ category: '攻略', content: areaTips || '本轮笔记未提取到可确认的停车信息。', source: '编辑整理（公开信息）' }];
}

const meta = { city: '广州', city_code: '440100', exported_at: new Date().toISOString(), places: places.length, parkings: Object.values(parkingsByPlace).reduce((n, a) => n + a.length, 0), fee_rules: Object.values(parkingsByPlace).flat().reduce((n, p) => n + p.fee_rules.length, 0), source: '小红书最多收藏排序前10条笔记的保守整理' };
fs.writeFileSync(outputPath, JSON.stringify({ meta, cities: legacy.cities || [], categories: legacy.categories || [], places, parkingsByPlace, tipsByPlace }, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, places: places.length, parkings: meta.parkings, fee_rules: meta.fee_rules, coordinates_ready: 0, coordinates_pending: meta.parkings }, null, 2));
