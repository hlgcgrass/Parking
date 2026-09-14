import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const rawRoot = path.join(root, 'server', 'xhs-raw');
const outputPath = process.env.CANDIDATES_OUTPUT
  ? path.resolve(root, process.env.CANDIDATES_OUTPUT)
  : path.join(root, 'server', 'xhs-p0-candidates-latest-20260914.json');

const selectedDirs = (process.env.RAW_DIRS ? process.env.RAW_DIRS.split(',') : [
  'p0-remaining-20260914-test2',
  'p0-remaining-20260914',
  'p0-cap20-20260914',
  'p0-cap20-cont-20260914'
]).map(s => s.trim()).filter(Boolean);

function extractText(note) {
  const raw = String(note.visible_text || '').replace(/\s+/g, ' ').trim();
  const title = String(note.title || '').replace(/\s+- 小红书$/, '').trim();
  const marker = raw.indexOf('关注');
  const titleAt = marker >= 0 ? raw.indexOf(title, marker) : -1;
  const start = titleAt >= 0 ? titleAt + title.length : Math.max(0, marker + 2);
  const tail = raw.slice(start).trim();
  const end = tail.search(/猜你想搜|\d{4}-\d{2}-\d{2} 共 \d+ 条评论|\s共 \d+ 条评论|说点什么\.\.\.|- THE END -/);
  const main = (end >= 0 ? tail.slice(0, end) : tail).trim();
  const commentMatch = tail.match(/(?:\d{4}-\d{2}-\d{2} )?共 \d+ 条评论/);
  const comments = commentMatch ? tail.slice(commentMatch.index).replace(/说点什么\.\.\..*$/, '').replace(/- THE END -.*$/, '').trim() : '';
  return { body: main, comments };
}

function parseCard(card) {
  const text = String(card || '');
  const m = text.match(/^(.*?)\s+(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d+天前|刚刚)\s+([\d.万]+)$/);
  return m ? { author: m[1], published_at: m[2], favorites: m[3] } : { card: text };
}

function placeFromKeyword(keyword) {
  return String(keyword || '').replace(/^广州\s+/, '').replace(/\s+停车攻略\s*$/, '').trim();
}

const byPlace = new Map();
for (const dir of selectedDirs) {
  const dirPath = path.join(rawRoot, dir);
  for (const file of fs.readdirSync(dirPath).filter(name => /^\d{8}T[^-]+-.*-note-\d{2}-.+\.json$/.test(name)).sort()) {
    const absolute = path.join(dirPath, file);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { continue; }
    if (raw.blocked_or_incomplete) continue;
    const place = placeFromKeyword(raw.keyword);
    // p0-remaining 中的广州图书馆是主批次已保存地点的重复续抓，不计入本轮20个地点。
    if (dir === 'p0-remaining-20260914' && place === '广州图书馆') continue;
    const row = byPlace.get(place) || { place, query: raw.keyword, sort_mode: '最多收藏', notes: [] };
    const parsed = parseCard(raw.source_card);
    row.notes.push({
      rank: Number(raw.rank) || row.notes.length + 1,
      ...parsed,
      title: String(raw.title || '').replace(/\s+- 小红书$/, ''),
      url: raw.note_url || raw.requested_url || null,
      raw_file: path.relative(root, absolute).replaceAll('\\', '/'),
      ...extractText(raw)
    });
    byPlace.set(place, row);
  }
}

const places = [...byPlace.values()].sort((a, b) => a.notes[0]?.raw_file.localeCompare(b.notes[0]?.raw_file));
const payload = {
  version: 1,
  generated_at: new Date().toISOString(),
  purpose: '2026-09-14本轮P0原始JSON的入库前候选整理中间产物，不得直接作为正式停车数据使用',
  places
};
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, places: places.length, notes: places.reduce((n, p) => n + p.notes.length, 0), byPlace: places.map(p => ({ place: p.place, notes: p.notes.length })) }, null, 2));
