import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const capturePaths = [
  path.resolve('server/xhs-captures-p1-33-direct-relevance2-20260914.json'),
  path.resolve('server/xhs-captures-p1-34-direct-relevance1-20260914.json')
];
const outputPath = path.resolve(process.env.XHS_33_34_OUTPUT_PATH || 'server/xhs-p1-33-34-import-20260914.json');
const auditPath = path.resolve(process.env.XHS_33_34_AUDIT_PATH || 'server/xhs-p1-33-34-audit-20260914.json');
const finalPath = path.resolve(process.env.XHS_33_34_FINAL_PATH || 'server/xhs-p1-33-34-final-20260914.md');
const key = process.env.TENCENT_MAP_KEY;
if (!key) throw new Error('缺少 TENCENT_MAP_KEY；请只通过本机环境变量提供，不要写入文件');

const captures = capturePaths.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')));
const captureByPlace = new Map(captures.map(row => [row.target_place, row]));

const place = (category, district, address, summary, area_tips, parking = []) => ({ category, district, address, summary, area_tips, parking });
const p = (name, location, guide, needles) => ({ name, location, guide, needles });

// 标题只用于确认停车点名称/导航词；标题中的价格不直接升级为正式收费。
const defs = {
  '白云机场': place('交通枢纽', '白云区', '广州市白云区人和镇白云国际机场', '广州白云国际机场，包含多个航站楼和接送客区域。', '航站楼接送和长时间停车的入口、开放状态与收费差异较大；本批只保留能明确对应到具体停车区域的记录，入场前按现场指引确认。', [p('白云机场T3 P11停车场', '白云机场T3 P11停车场', '前往T3接送旅客可搜索该停车区域，进场后按航站楼和车库指引通行；具体开放与收费以现场公示为准。', ['P11'])]),
  '广州南站': place('交通枢纽', '番禺区', '广州市番禺区石壁街道石山大道南', '广州南站是广州南部主要高铁枢纽，接送客高峰车流集中。', 'P6、P10等停车区域对应不同接送路线；节假日和列车集中到达时段应预留进场及步行时间，具体收费和开放入口以现场指引为准。', [p('广州南站P6地下停车场', '广州南站P6地下停车场', '接送旅客可搜索P6地下停车场，进入后按站内指引前往对应出站层；高峰期预留排队时间。', ['P6']), p('广州南站P10停车场', '广州南站P10停车场', '可作为广州南站接送和短时停车的备选，进出路线及现场余位以站区指引为准。', ['P10'])]),
  '广州站': place('交通枢纽', '越秀区', '广州市越秀区环市西路159号', '广州站位于老城区北部，是广州重要铁路客运站。', '车站周边道路和站区入口较复杂，演出、节假日及列车到发集中时段容易拥堵；停车后按车站方向指引步行，收费以现场公示为准。', [p('汇美国际停车场', '汇美国际停车场', '可搜索汇美国际停车场作为广州站西侧停车选择，进出及步行路线以现场指引为准。', ['汇美国际停车'])]),
  '广州东站': place('交通枢纽', '天河区', '广州市天河区林和中路1号', '广州东站位于天河核心区，周边商业和铁路客流叠加。', '地下停车场与站房出入口方向不同，接送客应提前确认进站层和离场路线；高峰时段预留排队时间，收费以现场公示为准。', [p('广州东站地下停车场', '广州东站地下停车场', '可搜索广州东站地下停车场，进场后按站房和接送层指引通行；具体开放与收费以现场为准。', ['地下停车场'])]),
  '白云站': place('交通枢纽', '白云区', '广州市白云区石井街道石潭西路', '白云站是广州北部大型铁路枢纽，站区范围较大。', '送站和接站应先确认对应进站口及车辆放行路线；P6停车区域为本批可明确识别的停车点，高峰期应预留绕行时间。', [p('白云站P6停车场', '白云站P6停车场', '送站或接人可搜索白云站P6停车场，进入后按站区指引前往对应进站口；开放及收费以现场为准。', ['P6停车场'])]),
  '广州北站': place('交通枢纽', '花都区', '广州市花都区站前路1号', '广州北站位于花都区，是广州北部铁路客运站。', '站前道路和花都站片区入口需按现场交通组织通行；本批停车记录未形成完整收费表，进场前确认余位和收费公示。', [p('广州北站停车场', '广州北站停车场', '可搜索广州北站停车场，按站前道路和现场指引进入；接送高峰预留进出时间。', ['停车场'])]),
  '庆盛站': place('交通枢纽', '南沙区', '广州市南沙区庆盛枢纽片区', '庆盛站是南沙片区重要铁路枢纽。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '新塘站': place('交通枢纽', '增城区', '广州市增城区新塘镇新塘站片区', '新塘站服务增城及东部片区铁路出行。', '站区停车存在临时停车和站房车库等不同选择，开放状态和收费可能随客流调整，进场前确认北侧入口及现场公示。', [p('新塘站北侧临时停车场', '新塘站北侧临时停车场', '可搜索新塘站北侧临时停车场，按现场指引进出；临时车场的开放和余位需到场确认。', ['北侧临时停车场'])]),
  '琶洲站': place('交通枢纽', '海珠区', '广州市海珠区新港东路琶洲片区', '琶洲站服务会展和东部城区通勤客流。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '滘口客运站': place('交通枢纽', '荔湾区', '广州市荔湾区芳村大道西533号', '滘口客运站是广州西部重要公路客运枢纽。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '天河客运站': place('交通枢纽', '天河区', '广州市天河区燕岭路633号', '天河客运站服务广州东北方向公路客运。', '车站内部停车场和新天地停车场对应不同停车需求；站区周边道路高峰期可能拥堵，长期停车需单独确认办理条件。', [p('天河客运站内部停车场', '天河客运站内部停车场', '可搜索天河客运站内部停车场，进场后按站区指引停车；开放和收费以现场为准。', ['内部停车场']), p('新天地停车场', '新天地停车场', '可搜索新天地停车场作为车站周边备选，停车后按步行路线前往客运站，入口和余位以现场为准。', ['新天地停车场'])]),
  '广州汽车站': place('交通枢纽', '越秀区', '广州市越秀区环市西路158号', '广州汽车站位于广州站商圈附近，是市区主要公路客运站。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '黄埔客运站': place('交通枢纽', '黄埔区', '广州市黄埔区黄埔东路', '黄埔客运站服务黄埔及广州东部公路客运。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '南沙客运港': place('交通枢纽', '南沙区', '广州市南沙区龙穴大道南', '南沙客运港承担南沙与港澳等方向的水路客运。', '客运港停车与登船时间需要衔接，建议提前确认停车区域、步行路线和长时间停放条件；本批收费信息未形成完整表格。', [p('南沙客运港停车场', '南沙客运港停车场', '前往港口乘船可搜索南沙客运港停车场，停车后按码头方向指引步行；登船高峰预留进场时间。', ['停车'])]),
  '广交会展馆': place('大型场馆与展馆', '海珠区', '广州市海珠区阅江中路380号', '广交会展馆位于琶洲会展片区，展会期间客流和车流集中。', '展会期间需按临时交通组织和展馆入口分流行驶，停车后确认对应展馆入口；收费和预约要求以现场及当期公告为准。', [p('广交会展馆停车场', '广交会展馆停车场', '可搜索广交会展馆停车场，展会期间按现场分流和展馆入口指引进出；建议提前到场。', ['停车'])]),
  '保利世贸博览馆': place('大型场馆与展馆', '海珠区', '广州市海珠区新港东路1000号', '保利世贸博览馆位于琶洲会展核心区。', '展会日停车需求集中，进场后按展馆和电梯方向指引通行；优惠、预约及开放状态以当期现场规则为准。', [p('保利世贸博览馆停车场', '保利世贸博览馆停车场', '可搜索保利世贸博览馆停车场，停车后按展馆入口及电梯指引步行；展会高峰建议提前到场。', ['停车优惠'])]),
  '广州国际采购中心': place('大型场馆与展馆', '海珠区', '广州市海珠区琶洲大道东2号', '广州国际采购中心位于琶洲会展片区。', '展会及周末时段车流集中，地下车库入口和展馆入口需按现场标识通行；收费及开放状态以现场公示为准。', [p('广州国际采购中心负一层停车场', '广州国际采购中心负一层停车场', '可搜索广州国际采购中心负一层停车场，进入后按展馆方向指引停车和步行。', ['负一层停车场'])]),
  '天河体育中心': place('大型场馆与展馆', '天河区', '广州市天河区天河路299号', '天河体育中心是广州中心城区大型体育和演艺场馆。', '比赛和演出日车流、排队及临时管制会明显增加，停车后要确认体育场馆方向和离场出口；开放及收费按当日现场规则执行。', [p('天河体育中心停车场', '天河体育中心停车场', '可搜索天河体育中心停车场，活动日建议提前到场并按现场分流进入；散场时预留离场时间。', ['停车场'])]),
  '广州体育馆': place('大型场馆与展馆', '白云区', '广州市白云区白云大道南783号', '广州体育馆位于白云新城，是大型体育和演艺活动场馆。', '演出日停车需求集中，1号馆与其他场馆入口方向不同；入场前确认活动分流和停车开放状态，散场时按现场指引离场。', [p('广州体育馆1号馆停车场', '广州体育馆1号馆停车场', '前往1号馆活动可搜索对应停车场，停车后按馆区指引步行；演出日建议提前到场。', ['1号馆停车'])]),
  '广州大学城体育中心': place('大型场馆与展馆', '番禺区', '广州市番禺区广州大学城中心区', '广州大学城体育中心服务大学城体育赛事和演艺活动。', '演唱会和大型活动时停车需求集中，场馆周边可能临时分流；停车后按体育场方向步行，开放与优惠以当日现场为准。', [p('广州大学城体育中心停车场', '广州大学城体育中心停车场', '可搜索广州大学城体育中心停车场，活动日按现场分流进入并预留散场时间。', ['停车'])]),
  '宝能广州国际体育演艺文化中心': place('大型场馆与展馆', '黄埔区', '广州市黄埔区开创大道附近', '宝能广州国际体育演艺文化中心是广州东部大型体育演艺场馆。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。'),
  '广州亚运城': place('大型场馆与展馆', '番禺区', '广州市番禺区亚运城片区', '广州亚运城包含体育场馆、居住和商业配套。', '大型演出日应提前确认体育馆地面停车区域和离场路线，散场时按临时交通组织行驶；收费和开放状态以现场为准。', [p('广州亚运城综合体育馆地面停车场', '广州亚运城综合体育馆地面停车场', '可搜索广州亚运城综合体育馆地面停车场，活动日按现场分流进入，散场时预留离场时间。', ['综合体育馆地面停车场'])]),
  '南沙体育馆': place('大型场馆与展馆', '南沙区', '广州市南沙区南沙体育馆片区', '南沙体育馆服务南沙片区体育和演艺活动。', '活动日停车需求和道路管制可能变化，建议提前确认停车区域、入口和离场方向；本批收费信息未形成完整表格。', [p('南沙体育馆停车场', '南沙体育馆停车场', '可搜索南沙体育馆停车场，活动日按现场指引进出并预留散场时间；收费以现场为准。', ['停车费'])]),
  '番禺英东体育场': place('大型场馆与展馆', '番禺区', '广州市番禺区市桥街道英东体育场片区', '番禺英东体育场是番禺城区体育活动场馆。', '本批抓取未形成可确认的具体停车点，详情页保留地点并显示攻略完善中。')
};

const normalize = value => String(value ?? '').toLowerCase().replace(/[（）()\s·、，,。/\\\-号栋室]/g, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function search(keyword) {
  const url = new URL('https://apis.map.qq.com/ws/place/v1/search/');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('boundary', 'region(广州,0)');
  url.searchParams.set('page_size', '20');
  url.searchParams.set('page_index', '1');
  url.searchParams.set('orderby', '_distance');
  url.searchParams.set('key', key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`腾讯接口 HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 0) throw new Error(`腾讯接口 ${body.message || body.status}`);
  return Array.isArray(body.data) ? body.data : [];
}
function loc(candidate) {
  const lng = Number(candidate?.location?.lng); const lat = Number(candidate?.location?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}
function rankPlace(name, district, candidates) {
  const wanted = normalize(name);
  return candidates.map(candidate => {
    const title = normalize(candidate.title);
    let score = title === wanted ? 100 : (title.includes(wanted) || wanted.includes(title) ? 70 : 0);
    if (String(candidate.address || '').includes(district)) score += 20;
    if (/机场|车站|客运|体育|展馆|中心|馆|场/.test(candidate.title || '')) score += 5;
    return { candidate, location: loc(candidate), score };
  }).filter(row => row.location).sort((a, b) => b.score - a.score);
}
function rankParking(spec, placeDef, candidates) {
  const wanted = normalize(spec.name); const locationWanted = normalize(spec.location);
  return candidates.filter(c => /停车|车库|P\d/i.test(`${c.title || ''} ${c.category || ''}`)).map(candidate => {
    const title = normalize(candidate.title); const address = String(candidate.address || '');
    let score = Math.max(title === wanted ? 80 : 0, title === locationWanted ? 80 : 0);
    if (title.includes(wanted) || wanted.includes(title)) score = Math.max(score, 60);
    if (title.includes(locationWanted) || locationWanted.includes(title)) score = Math.max(score, 60);
    if (address.includes(placeDef.district)) score += 20;
    if (/入口|出入口/.test(candidate.title || '')) score += 10;
    return { candidate, location: loc(candidate), score };
  }).filter(row => row.location).sort((a, b) => b.score - a.score);
}
function sources(placeName, needles) {
  const row = captureByPlace.get(placeName); const notes = row?.notes || [];
  return notes.filter(note => needles.some(needle => `${note.title || ''} ${note.source_card || ''}`.includes(needle))).map(note => ({
    source_type: 'xiaohongshu', source_url: note.note_url || null, source_title: note.title || null,
    source_author: null, source_published_at: null, rank: note.search_rank || note.rank || null,
    evidence_type: '标题', raw_file: note.raw_file || null
  }));
}
function ruleFields() { return { rule_type: 'normal', price: null, unit: 'hour', unit_minutes: 60, start_minute: null, end_minute: null, time_start: null, time_end: null, description: '', confidence: 'low', priority: 50 }; }
function parkingRow(spec, placeName, placeDef) {
  return { name: spec.name, fee_detail: '收费待现场确认。', guide_text: spec.guide, location: spec.location, address: spec.location, type: '停车场', lng: null, lat: null, coordinate_status: '待补充', navigation_available: false, coordinate_source: null, coordinate_poi_name: null, coordinate_poi_id: null, coordinate_address: null, coordinate_verified_at: null, entrance_verified: false, fee_rules: [], daily_cap: null, night_flat: null, min_price_hour: null, confidence: 'low', conflict_flag: false, source_records: sources(placeName, spec.needles), source: '编辑整理（公开信息）', verified_at: null };
}
function formatPlaceRow(name, def) {
  return { name, category: def.category, city_code: '440100', address: def.address, district: def.district, summary: def.summary, area_tips: def.parking.length ? def.area_tips : '攻略完善中', tags: ['自驾', def.category], lng: null, lat: null, coordinate_status: '待补充', navigation_available: false, coordinate_source: null, coordinate_poi_name: null, coordinate_poi_id: null, coordinate_address: null, coordinate_verified_at: null, entrance_verified: false, min_price: null, min_price_display: '价格待补充', parkings: def.parking.map(spec => parkingRow(spec, name, def)) };
}

const output = { places: Object.entries(defs).map(([name, def]) => formatPlaceRow(name, def)) };
const review = [];
for (const row of output.places) {
  try {
    const candidates = await search(`广州 ${row.name}`); const ranked = rankPlace(row.name, row.district, candidates); const top = ranked[0];
    if (top) { Object.assign(row, { ...top.location, coordinate_status: '待核验', navigation_available: false, coordinate_source: '腾讯位置服务地点搜索 POI 坐标（待入口复核）', coordinate_poi_name: top.candidate.title || null, coordinate_poi_id: top.candidate.id || null, coordinate_address: top.candidate.address || null }); }
    review.push({ level: '地点', place: row.name, status: top ? '候选坐标待核验' : '待补充', score: top?.score || 0, poi: top?.candidate?.title || '', poi_id: top?.candidate?.id || '', address: top?.candidate?.address || '', location: top?.location || null, alternatives: ranked.slice(1, 4).map(x => ({ title: x.candidate.title, id: x.candidate.id, address: x.candidate.address, location: x.location, score: x.score })) });
    await sleep(100);
  } catch (error) { review.push({ level: '地点', place: row.name, status: '检索失败', error: error.message }); }
  for (const parking of row.parkings) {
    try {
      const spec = defs[row.name].parking.find(item => item.name === parking.name);
      const queries = [...new Set([`广州 ${spec.location} ${row.name}`, `广州 ${spec.location}`])]; const all = new Map();
      for (const query of queries) { for (const candidate of await search(query)) all.set(candidate.id, candidate); await sleep(70); }
      const ranked = rankParking(spec, defs[row.name], [...all.values()]); const top = ranked[0]; const second = ranked[1]; const gap = top && second ? top.score - second.score : 999;
      // 仅自动放入明确同名且同区的 POI；其余停车点仍可入库但定位待补充。
      const sameDistrict = Boolean(top && String(top.candidate.address || '').includes(row.district));
      const exact = Boolean(top && (normalize(top.candidate.title) === normalize(spec.name) || normalize(top.candidate.title).includes(normalize(spec.name)) || normalize(spec.name).includes(normalize(top.candidate.title))));
      const accepted = Boolean(top && sameDistrict && exact && top.score >= 60);
      if (accepted) Object.assign(parking, { ...top.location, coordinate_status: '待核验', navigation_available: false, coordinate_source: '腾讯位置服务地点搜索 POI 坐标（停车场入口待核验）', coordinate_poi_name: top.candidate.title || null, coordinate_poi_id: top.candidate.id || null, coordinate_address: top.candidate.address || null, entrance_verified: /入口|出入口/.test(top.candidate.title || '') });
      review.push({ level: '停车场', place: row.name, name: parking.name, status: accepted ? '候选坐标待核验' : '定位待补充', score: top?.score || 0, score_gap: gap, poi: top?.candidate?.title || '', poi_id: top?.candidate?.id || '', address: top?.candidate?.address || '', location: top?.location || null, alternatives: ranked.slice(1, 4).map(x => ({ title: x.candidate.title, id: x.candidate.id, address: x.candidate.address, location: x.location, score: x.score })) });
      await sleep(100);
    } catch (error) { review.push({ level: '停车场', place: row.name, name: parking.name, status: '检索失败', error: error.message }); }
  }
}
const generatedAt = new Date().toISOString();
const allParkings = output.places.flatMap(row => row.parkings);
const audit = { generated_at: generatedAt, source: capturePaths.map(file => path.relative(root, file).replaceAll('\\', '/')), captured_places: captures.length, included_places: output.places.length, included_parkings: allParkings.length, included_fee_rules: allParkings.reduce((n, row) => n + row.fee_rules.length, 0), missing_place_coordinates: output.places.filter(row => row.lng == null || row.lat == null).length, missing_parking_coordinates: allParkings.filter(row => row.lng == null || row.lat == null).length, missing_fee_details: allParkings.filter(row => !row.fee_detail || row.fee_detail === '收费待现场确认。').length, conflict_parkings: allParkings.filter(row => row.conflict_flag).length, review_file: path.relative(root, auditPath).replaceAll('\\', '/') };
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(auditPath, `${JSON.stringify({ ...audit, review }, null, 2)}\n`);
const md = ['# 3.3—3.4 停车攻略整理稿', '', `生成时间：${generatedAt}`, '', ...output.places.map(row => [`## ${row.name}`, `- 停车场：${row.parkings.length ? row.parkings.map(k => k.name).join('、') : '攻略完善中'}`, `- 收费：${row.parkings.length ? row.parkings.map(k => k.fee_detail).join('；') : '收费待现场确认'}`, `- 攻略正文：${row.area_tips}`, `- 地点定位：${row.coordinate_address || '位置待补充'}`, ''].join('\n'))].join('\n');
fs.writeFileSync(finalPath, md);
console.log(JSON.stringify({ output: outputPath, audit: auditPath, final: finalPath, ...audit, parking_coordinates: allParkings.filter(row => row.lng != null && row.lat != null).length }, null, 2));
