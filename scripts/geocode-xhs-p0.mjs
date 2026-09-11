import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.join(root, 'server', 'xhs-p0-import-41.json');
const outputPath = path.join(root, 'server', 'xhs-p0-import-41-geocoded.json');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = s => String(s || '').toLowerCase().replace(/[（）()\s·、，,。/\\\-]/g, '');
const generic = /^(?:地下停车场|地面停车场|医院停车场|广州停车场|停车场|体育公园停车场|沙面停车场|公园停车场|村民停车场|官方停车场|本院停车场|本部停车场)$/;

async function search(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&accept-language=zh-CN&countrycodes=cn&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'ParkingMiniappCoordinateReview/1.0 (local task)' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function choose(name, results) {
  const n = normalize(name);
  if (!results.length || generic.test(name)) return null;
  const tokens = String(name).replace(/停车场|地下车库|地面车库|车库|停车位/g, '').split(/[（）()\s·、，,。/\\\-]/).filter(x => x.length >= 2);
  const scored = results.map(r => {
    const d = normalize(r.display_name);
    const hits = tokens.filter(t => d.includes(normalize(t))).length;
    const exact = d.includes(n) ? 4 : 0;
    return { r, score: hits + exact };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 1) return null;
  return { lng: Number(top.r.lon), lat: Number(top.r.lat), coordinate_status: '已核验', navigation_available: true, coordinate_source: 'OpenStreetMap Nominatim 名称检索', coordinate_address: top.r.display_name, coordinate_verified_at: new Date().toISOString() };
}

const out = structuredClone(input);
let total = 0; let ready = 0; let pending = 0; let errors = 0;
for (const rows of Object.values(out.parkingsByPlace || {})) {
  for (const row of rows) {
    total++;
    const query = `广州 ${row.name}`;
    try {
      const result = choose(row.name, await search(query));
      if (result) { Object.assign(row, result); ready++; }
      else { row.coordinate_status = '待补充'; row.navigation_available = false; pending++; }
    } catch (error) {
      row.coordinate_status = '待补充'; row.navigation_available = false; row.coordinate_error = String(error.message || error); pending++; errors++;
    }
    if (total % 10 === 0) console.log(JSON.stringify({ processed: total, total: Object.values(out.parkingsByPlace).flat().length, ready, pending, errors }));
    await sleep(1100);
  }
}
out.meta = { ...out.meta, coordinate_run_at: new Date().toISOString(), coordinates_ready: ready, coordinates_pending: pending, coordinate_errors: errors };
fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, total, ready, pending, errors }, null, 2));
