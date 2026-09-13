import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] ?? 'server/xhs-processed-selected-20260913-import.json';
const filePath = path.resolve(input);
const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/^(?:null|undefined)$/i.test(value.trim());
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function checkVisibleText(value, label) {
  if (!isNonEmpty(value)) return;
  const sourceNoise = /小红书|笔记中|评论中|原文|作者回复|有网友提到|有人提到|有人说|用户名|猜你喜欢|说点什么/;
  const questionOnly = /(?:停车费是多少钱|哪里可以停车|需要预约吗|怎么约|开放吗|求问|求推荐)[？?。.!！]*$/;
  const genericLocation = /^(?:附近|周边|附近停车场|周边停车场|某个停车场)$/;
  if (sourceNoise.test(value)) error(`${label}含来源或平台噪声：${value}`);
  if (questionOnly.test(value.trim())) error(`${label}疑问句没有信息量：${value}`);
  if (genericLocation.test(value.trim())) error(`${label}是泛化定位，无法导航：${value}`);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (err) {
  console.error(`无法读取或解析 JSON：${filePath}`);
  console.error(err.message);
  process.exit(1);
}

if (!data || !Array.isArray(data.places) || data.places.length === 0) {
  error('顶层 places 必须是非空数组');
}

const placeNames = new Set();
const parkingNames = new Set();
const ruleTypes = new Set(['first', 'normal', 'cap', 'free', 'night']);
const units = new Set(['hour', 'minute', 'day', 'time']);

for (const [placeIndex, place] of (data.places ?? []).entries()) {
  const placeLabel = `places[${placeIndex}]`;
  if (!isNonEmpty(place?.name)) error(`${placeLabel}.name 不能为空`);
  if (placeNames.has(place?.name)) error(`地点名称重复：${place?.name}`);
  placeNames.add(place?.name);
  if (!isNonEmpty(place?.category)) error(`${placeLabel}.category 不能为空`);
  if (!isNonEmpty(place?.city_code)) error(`${placeLabel}.city_code 不能为空`);
  if (!isNonEmpty(place?.address)) error(`${placeLabel}.address 不能为空，最终入库不得保留 null/undefined`);
  if (!isNonEmpty(place?.district)) error(`${placeLabel}.district 不能为空，最终入库不得保留 null/undefined`);
  if (!isNonEmpty(place?.summary)) error(`${placeLabel}.summary 不能为空，最终入库不得保留 null/undefined`);
  if (!isNonEmpty(place?.area_tips)) error(`${placeLabel}.area_tips 不能为空，必须包含该地点全部停车场的汇总攻略`);
  checkVisibleText(place?.address, `${placeLabel}.address`);
  checkVisibleText(place?.district, `${placeLabel}.district`);
  checkVisibleText(place?.summary, `${placeLabel}.summary`);
  checkVisibleText(place?.area_tips, `${placeLabel}.area_tips`);
  const placeHasLng = place?.lng !== null && place?.lng !== undefined;
  const placeHasLat = place?.lat !== null && place?.lat !== undefined;
  if (!placeHasLng || !placeHasLat) error(`${placeLabel}地点经纬度不能为空，必须先完成目标地点定位`);
  if (placeHasLng !== placeHasLat) error(`${placeLabel}地点经纬度必须成对出现`);
  if (placeHasLng && (!Number.isFinite(place.lng) || place.lng < -180 || place.lng > 180)) error(`${placeLabel}.lng 范围不合法`);
  if (placeHasLat && (!Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90)) error(`${placeLabel}.lat 范围不合法`);
  if (place?.coordinate_status !== '已核验') error(`${placeLabel}.coordinate_status 必须为已核验`);
  if (place?.navigation_available !== true) error(`${placeLabel}.navigation_available 必须为 true`);
  if (!Array.isArray(place?.parkings) || place.parkings.length === 0) {
    error(`${placeLabel}.parkings 必须至少包含一条停车场`);
    continue;
  }

  const localParkingNames = new Set();
  for (const [parkingIndex, parking] of place.parkings.entries()) {
    const label = `${placeLabel}.parkings[${parkingIndex}]`;
    if (!isNonEmpty(parking?.name)) error(`${label}.name 不能为空`);
    if (localParkingNames.has(parking?.name)) error(`同一地点内停车场重复：${place?.name} / ${parking?.name}`);
    localParkingNames.add(parking?.name);
    if (parkingNames.has(parking?.name)) {
      error(`同一批次存在重复停车场，需先确定主地点：${parking?.name}`);
    }
    parkingNames.add(parking?.name);

    if (!isNonEmpty(parking?.fee_detail) && !Array.isArray(parking?.fee_rules)) {
      error(`${label}必须有 fee_detail 或 fee_rules`);
    }
    if (!isNonEmpty(parking?.guide_text)) error(`${label}.guide_text 不能为空`);
    if (!isNonEmpty(parking?.location)) error(`${label}.location 不能为空`);
    checkVisibleText(parking?.name, `${label}.name`);
    checkVisibleText(parking?.fee_detail, `${label}.fee_detail`);
    checkVisibleText(parking?.guide_text, `${label}.guide_text`);
    checkVisibleText(parking?.location, `${label}.location`);

    const rules = parking?.fee_rules ?? [];
    if (!Array.isArray(rules)) {
      error(`${label}.fee_rules 必须是数组`);
    } else {
      for (const [ruleIndex, rule] of rules.entries()) {
        const ruleLabel = `${label}.fee_rules[${ruleIndex}]`;
        if (!ruleTypes.has(rule?.rule_type)) error(`${ruleLabel}.rule_type 不合法`);
        if (!units.has(rule?.unit)) error(`${ruleLabel}.unit 不合法`);
        if (!isFiniteNonNegative(rule?.price)) error(`${ruleLabel}.price 必须是非负数字`);
        if (rule?.unit === 'minute' && (!Number.isInteger(rule?.unit_minutes) || rule.unit_minutes <= 0)) {
          error(`${ruleLabel}.unit_minutes 必须是正整数`);
        }
        if (rule?.time_start !== undefined && !/^\d{2}:\d{2}$/.test(rule.time_start)) error(`${ruleLabel}.time_start 格式不合法`);
        if (rule?.time_end !== undefined && !/^\d{2}:\d{2}$/.test(rule.time_end)) error(`${ruleLabel}.time_end 格式不合法`);
      }
    }

    const hasLng = parking?.lng !== null && parking?.lng !== undefined;
    const hasLat = parking?.lat !== null && parking?.lat !== undefined;
    if (hasLng !== hasLat) error(`${label}经纬度必须成对出现`);
    if (hasLng && (!Number.isFinite(parking.lng) || parking.lng < -180 || parking.lng > 180)) error(`${label}.lng 范围不合法`);
    if (hasLat && (!Number.isFinite(parking.lat) || parking.lat < -90 || parking.lat > 90)) error(`${label}.lat 范围不合法`);
    if (!hasLng) error(`${label}停车场经纬度不能为空，必须先完成停车场定位`);
    if (hasLng && parking?.coordinate_status !== '已核验') error(`${label}coordinate_status 必须为已核验`);
    if (parking?.navigation_available !== true) error(`${label}navigation_available 必须为 true`);
    if (parking?.conflict_flag === true && !isNonEmpty(parking?.fee_detail)) {
      warnings.push(`${label}标记收费冲突但缺少文字收费明细`);
    }
  }
}

if (errors.length > 0) {
  console.error(`校验失败：${filePath}`);
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`校验通过：${filePath}`);
console.log(`地点 ${data.places.length} 个，停车场 ${parkingNames.size} 个，收费规则 ${data.places.flatMap((place) => place.parkings).flatMap((parking) => parking.fee_rules ?? []).length} 条`);
if (warnings.length > 0) {
  console.log('提示：');
  for (const item of warnings) console.log(`- ${item}`);
}
