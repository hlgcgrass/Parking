const fs = require('fs');
const cp = require('child_process');

const round = value => Math.round(value * 100) / 100;
const original = file => JSON.parse(cp.execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));

function hourlyFromRules(rules) {
  const values = (Array.isArray(rules) ? rules : [])
    .filter(rule => Number(rule && rule.price) > 0 && ['first', 'normal'].includes(rule && rule.rule_type))
    .map(rule => {
      if (rule.unit === 'minute' && Number(rule.unit_minutes) > 0) {
        return Number(rule.price) * 60 / Number(rule.unit_minutes);
      }
      return rule.unit === 'hour' ? Number(rule.price) : null;
    })
    .filter(Number.isFinite);
  return values.length ? round(Math.min(...values)) : null;
}

function applyPlacePrice(place, rows) {
  const values = rows
    .map(row => row.min_price_hour == null ? null : Number(row.min_price_hour))
    .filter(Number.isFinite);
  const fallback = place.min_price == null ? null : Number(place.min_price);
  const min = values.length ? round(Math.min(...values)) : fallback;
  if (min == null || !Number.isFinite(min)) return;
  const max = values.length ? Math.max(...values) : min;
  place.min_price = min;
  place.min_price_display = `¥${min}/h${max > min ? '起' : ''}`;
}

function updateBundle(file, nested) {
  const data = original(file);
  let parkingFilled = 0;
  if (nested) {
    for (const place of data.places || []) {
      const rows = Array.isArray(place.parkings) ? place.parkings : [];
      for (const row of rows) {
        const min = hourlyFromRules(row.fee_rules);
        if (row.min_price_hour == null && min != null) {
          row.min_price_hour = min;
          parkingFilled++;
        }
      }
      applyPlacePrice(place, rows);
    }
  } else {
    for (const rows of Object.values(data.parkingsByPlace || {})) {
      for (const row of rows || []) {
        const min = hourlyFromRules(row.fee_rules);
        if (row.min_price_hour == null && min != null) {
          row.min_price_hour = min;
          parkingFilled++;
        }
      }
    }
    for (const place of data.places || []) applyPlacePrice(place, data.parkingsByPlace[place.id] || []);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(file, { parkingFilled });
}

updateBundle('parking-miniapp/cloudfunctions/parking/data.json', false);
updateBundle('parking-miniapp/cloudfunctions/parking/batch2-import.json', true);
