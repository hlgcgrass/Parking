import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const inputDir = path.join(root, 'server', 'xhs-p0-all-serial-20260910');
const outputPath = path.join(root, 'server', 'xhs-p0-candidates-41.json');

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
  const m = String(card || '').match(/^(.*?)\s+(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d+天前|刚刚)\s+([\d.万]+)$/);
  return m ? { author: m[1], published_at: m[2], favorites: m[3] } : { card: String(card || '') };
}

const rows = [];
for (const file of fs.readdirSync(inputDir).filter(f => /^\d{2}-.+\.json$/.test(f)).sort()) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(inputDir, file), 'utf8')); }
  catch { continue; }
  if (raw.sort_mode !== '最多收藏' || raw.blocked_or_incomplete || !Array.isArray(raw.notes) || raw.notes.length < 10) continue;
  rows.push({
    place: file.replace(/^\d{2}-/, '').replace(/\.json$/, ''),
    query: raw.keyword,
    sort_mode: raw.sort_mode,
    notes: raw.notes.slice(0, 10).map((note, index) => ({
      rank: index + 1,
      ...parseCard(note.source_card),
      title: String(note.title || '').replace(/\s+- 小红书$/, ''),
      url: note.note_url || null,
      ...extractText(note)
    }))
  });
}

fs.writeFileSync(outputPath, JSON.stringify({
  version: 1,
  generated_at: new Date().toISOString(),
  purpose: '入库前候选整理中间产物，不得直接作为正式停车数据使用',
  places: rows
}, null, 2), 'utf8');
console.log(JSON.stringify({ output: outputPath, places: rows.length, notes: rows.reduce((n, p) => n + p.notes.length, 0) }, null, 2));
