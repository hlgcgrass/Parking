import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('server/xhs-p0-candidates-latest-20260914.json', 'utf8'));
const re = /(停车|车库|车位|收费|免费|元|封顶|入口|排队|满位|堵|步行|导航|医院|公园|门)/;
for (const p of j.places) {
  console.log(`\n### ${p.place}`);
  for (const n of p.notes) {
    const chunks = String(n.body).split(/(?<=[。！？；!?.;])|\n/).map(x => x.trim()).filter(x => x && re.test(x));
    console.log(`\n[${n.rank}] ${n.title}`);
    console.log(chunks.slice(0, 25).join('\n'));
    const comments = String(n.comments || '').split(/(?<=[。！？；!?.;])|\n/).map(x => x.trim()).filter(x => x && re.test(x));
    if (comments.length) console.log(`COMMENTS: ${comments.slice(0, 10).join(' | ')}`);
  }
}
