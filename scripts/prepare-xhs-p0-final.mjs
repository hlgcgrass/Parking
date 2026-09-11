import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputPath = path.join(root, 'server', 'xhs-p0-import-41-geocoded.json');
const outputPath = path.join(root, 'server', 'xhs-p0-import-41-final.json');
const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const parkingFields = [
  'id', 'name', 'address', 'type', 'total_spots', 'free_minutes', 'daily_cap',
  'night_flat', 'open_hours', 'payment', 'min_price_hour', 'tips', 'source',
  'confidence', 'verified_at', 'status', 'conflict_flag', 'fee_rules', 'lng',
  'lat', 'coordinate_status', 'navigation_available'
];

for (const rows of Object.values(data.parkingsByPlace || {})) {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!parkingFields.includes(key)) delete row[key];
    }
    if (row.coordinate_status !== '已核验') {
      row.lng = null;
      row.lat = null;
      row.navigation_available = false;
      row.coordinate_status = '待补充';
    }
  }
}

data.meta = {
  city: '广州',
  city_code: '440100',
  dataset_id: 'xhs-p0-41-20260911',
  replace_static_data: true,
  exported_at: new Date().toISOString(),
  places: data.places?.length || 0,
  parkings: Object.values(data.parkingsByPlace || {}).flat().length,
  fee_rules: Object.values(data.parkingsByPlace || {}).flat().reduce((n, row) => n + (row.fee_rules || []).length, 0),
  source: '编辑整理',
  coordinate_ready: Object.values(data.parkingsByPlace || {}).flat().filter(row => row.coordinate_status === '已核验').length,
  coordinate_pending: Object.values(data.parkingsByPlace || {}).flat().filter(row => row.coordinate_status !== '已核验').length
};

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, places: data.meta.places, parkings: data.meta.parkings, fee_rules: data.meta.fee_rules, coordinate_ready: data.meta.coordinate_ready, coordinate_pending: data.meta.coordinate_pending }, null, 2));
