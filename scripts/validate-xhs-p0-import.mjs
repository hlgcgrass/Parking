import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.join(root, 'server', 'xhs-p0-import-41.json');
const outputPath = path.join(root, 'server', 'xhs-p0-import-41-review.json');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const badName = /^(?:广州停车场|特定路|东门有|西门都有|凭预约|公园停车场|管理停车场|室外停车场|核心停车场|正门停车场|地下停车场|地面停车场|医院停车场|第\d+个|第\d+|以上两个|左右两边各有|隔壁也有|停车优先|度假区内|排队进|侨鑫过个马路|号）|去社区医院|有免费|一般天河|在动不动|相比|且为|发现了|沙面本身|里面两个|这边停车场|一个超低调|神级停车场|可直接进|景区有|大雄宝殿|名字叫|直到找到|当你看到|停东区|\(华新汇\)|号\)院内|广州白云区n)/;
const badText = /首页|沪ICP备|营业执照|公网安备|猜你想搜|说点什么|LIVE|小红书|作者|博主|用户|赞|回复|展开|联系商品客服|点击立即购买|停车代缴|发车牌|门票|免票|入园|小朋友|教育馆|游玩|自然讲解|公交|美食|吃饭|餐厅|租车|露营|最佳机位|经济划算|请问|没钱交停车费/;
const normalize = s => String(s || '').replace(/[（）()\s·、，,。/\\\-]/g, '').toLowerCase();

const failures = [];
const warnings = [];
const parkingRows = [];
for (const place of data.places || []) {
  const rows = data.parkingsByPlace[place.id] || [];
  const names = new Map();
  for (const row of rows) {
    const issues = [];
    if (!row.name || badName.test(row.name)) issues.push('名称疑似句子或泛称');
    if (badText.test(row.tips || '')) issues.push('备注混入页面/来源/游玩噪声');
    if (String(row.tips || '').length > 160 && !String(row.tips || '').includes('\n')) issues.push('长备注缺少分点换行');
    if (!Array.isArray(row.fee_rules) || row.fee_rules.length === 0) issues.push('没有可解析收费规则');
    if (!row.coordinate_status || typeof row.navigation_available !== 'boolean') issues.push('定位字段不完整');
    const key = normalize(row.name);
    if (names.has(key)) issues.push(`与${names.get(key)}重名`);
    else names.set(key, row.name);
    parkingRows.push({ place: place.name, name: row.name, issues });
    if (issues.length) failures.push({ place: place.name, parking_name: row.name, issues });
  }
  if (!rows.length) warnings.push({ place: place.name, issue: '本轮前10条中没有同时具备明确停车名称与收费的候选' });
}

const report = {
  generated_at: new Date().toISOString(),
  status: failures.length ? 'not_ready' : 'ready_for_coordinate_review',
  scope: { places: data.places?.length || 0, expected_places: 41, parking_rows: parkingRows.length },
  coordinate_status: { ready: parkingRows.filter(x => false).length, pending: parkingRows.length },
  failures,
  warnings,
  notes: [
    '本报告只校验结构与明显噪声，不替代人工核对原笔记。',
    '坐标全部为待补充，不能直接开启导航。',
    'not_ready 状态禁止清空旧库或写入正式云端数据。'
  ]
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, status: report.status, places: report.scope.places, parking_rows: report.scope.parking_rows, failures: failures.length, warnings: warnings.length }, null, 2));
