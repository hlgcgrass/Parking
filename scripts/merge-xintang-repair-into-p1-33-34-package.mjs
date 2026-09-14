import fs from 'node:fs';

const basePath = 'server/xhs-p1-33-34-import-20260914.json';
const repairPath = 'server/xhs-xintang-station-repair-import-20260914.json';
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const repair = JSON.parse(fs.readFileSync(repairPath, 'utf8'));
const repairedPlace = repair.places.find(row => row.name === '新塘站');
const index = base.places.findIndex(row => row.name === '新塘站');
if (!repairedPlace || index < 0) throw new Error('找不到新塘站整理记录');
base.places[index] = repairedPlace;
fs.writeFileSync(basePath, `${JSON.stringify(base, null, 2)}\n`);
console.log(JSON.stringify({ file: basePath, places: base.places.length, parkings: base.places.reduce((n, row) => n + row.parkings.length, 0), fee_rules: base.places.flatMap(row => row.parkings).reduce((n, row) => n + row.fee_rules.length, 0) }, null, 2));
